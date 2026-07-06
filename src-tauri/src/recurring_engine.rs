//! Recurring task date calculations (ported from recurringTaskService.ts).

use chrono::{Datelike, Duration, NaiveDate, TimeZone, Timelike, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurringConfigInput {
    pub frequency: String,
    pub interval: i64,
    #[serde(default)]
    pub days_of_week: Vec<u32>,
    #[serde(default)]
    pub day_of_month: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NextOccurrenceResponse {
    pub iso: String,
    pub millis: i64,
}

pub fn calculate_next_occurrence(config: &RecurringConfigInput, from_ms: i64) -> NextOccurrenceResponse {
    let from = chrono::DateTime::<Utc>::from_timestamp_millis(from_ms)
        .unwrap_or_else(Utc::now);
    let mut next = from;

    match config.frequency.as_str() {
        "daily" => {
            next = next + Duration::days(config.interval);
        }
        "weekly" => {
            if !config.days_of_week.is_empty() {
                let current_day = from.weekday().num_days_from_sunday();
                let mut sorted: Vec<u32> = config.days_of_week.clone();
                sorted.sort_unstable();

                if let Some(&next_day) = sorted.iter().find(|&&d| d > current_day) {
                    let delta = (next_day - current_day) as i64 + (config.interval - 1) * 7;
                    next = from + Duration::days(delta);
                } else {
                    let first = sorted[0];
                    let days_until = (7 - current_day + first) as i64 + (config.interval - 1) * 7;
                    next = from + Duration::days(days_until);
                }
            } else {
                next = from + Duration::weeks(config.interval);
            }
        }
        "monthly" => {
            if let Some(dom) = config.day_of_month {
                let date = from.date_naive();
                let mut year = date.year();
                let mut month = date.month() as i32 + config.interval as i32;
                while month > 12 {
                    month -= 12;
                    year += 1;
                }
                let target_month = month as u32;
                let last_day = last_day_of_month(year, target_month);
                let day = dom.min(last_day);
                let naive = NaiveDate::from_ymd_opt(year, target_month, day)
                    .unwrap_or(date);
                next = naive.and_hms_opt(0, 0, 0).unwrap().and_utc();
            } else {
                next = add_months(from, config.interval as u32);
            }
        }
        _ => {
            next = from + Duration::days(config.interval);
        }
    }

    NextOccurrenceResponse {
        millis: next.timestamp_millis(),
        iso: next.to_rfc3339(),
    }
}

fn last_day_of_month(year: i32, month: u32) -> u32 {
    let (y, m) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    NaiveDate::from_ymd_opt(y, m, 1)
        .unwrap()
        .pred_opt()
        .unwrap()
        .day()
}

fn add_months(from: chrono::DateTime<Utc>, months: u32) -> chrono::DateTime<Utc> {
    let date = from.date_naive();
    let mut year = date.year();
    let mut month = date.month() as i32 + months as i32;
    while month > 12 {
        month -= 12;
        year += 1;
    }
    let day = date.day().min(last_day_of_month(year, month as u32));
    NaiveDate::from_ymd_opt(year, month as u32, day)
        .unwrap()
        .and_hms_opt(from.hour(), from.minute(), from.second())
        .unwrap()
        .and_utc()
}

#[tauri::command(rename_all = "camelCase")]
pub fn recurring_calculate_next(
    config: RecurringConfigInput,
    from_ms: Option<i64>,
) -> Result<NextOccurrenceResponse, String> {
    let from = from_ms.unwrap_or_else(|| Utc::now().timestamp_millis());
    Ok(calculate_next_occurrence(&config, from))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daily_interval() {
        let from = Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap();
        let result = calculate_next_occurrence(
            &RecurringConfigInput {
                frequency: "daily".to_string(),
                interval: 2,
                days_of_week: vec![],
                day_of_month: None,
            },
            from.timestamp_millis(),
        );
        let parsed = chrono::DateTime::parse_from_rfc3339(&result.iso).unwrap();
        assert_eq!(parsed.day(), 3);
    }
}
