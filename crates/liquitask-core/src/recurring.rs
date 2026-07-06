//! Port of `src/services/recurringTaskService.ts` pure logic.
//!
//! Only the deterministic date math moves to Rust; the scheduler (setInterval),
//! task creation and React callbacks stay in TS. The TS service calls
//! `recurring_next_occurrence` / `recurring_advance` for the computation.

use serde::{Deserialize, Serialize};

use crate::dateutil::Civil;
use crate::model::RecurringConfig;

/// Faithful port of `RecurringTaskService.calculateNextOccurrence`.
///
/// `from_ms` is the reference instant (epoch millis). Returns the next
/// occurrence as epoch millis. Time-of-day is preserved from `from_ms`, exactly
/// like the original which only mutates date components.
pub fn next_occurrence(config: &RecurringConfig, from_ms: i64) -> i64 {
    let c = Civil::from_millis(from_ms);
    let interval = config.interval;

    let next = match config.frequency.as_str() {
        "daily" => c.add_days(interval),

        "weekly" => match &config.days_of_week {
            Some(days) if !days.is_empty() => {
                let current_day = c.weekday();
                let mut sorted = days.clone();
                sorted.sort_unstable();
                match sorted.iter().find(|&&day| day > current_day) {
                    Some(&next_day_this_week) => {
                        c.add_days((next_day_this_week - current_day) + (interval - 1) * 7)
                    }
                    None => {
                        let days_until_next = 7 - current_day + sorted[0];
                        c.add_days(days_until_next + (interval - 1) * 7)
                    }
                }
            }
            _ => c.add_days(7 * interval),
        },

        // The TS guard is `if (config.dayOfMonth)` — a JS truthiness test, so a
        // `dayOfMonth` of 0 (or absent) takes the same-day `else` branch. Match
        // that: only `Some(dom)` with `dom != 0` enters the day-of-month path;
        // `Some(0)` and `None` both fall through to `add_months_js`.
        "monthly" => match config.day_of_month {
            Some(dom) if dom != 0 => {
                // next.setDate(1); next.setMonth(getMonth()+interval);
                let d1 = Civil { day: 1, ..c };
                let stepped = d1.set_month_add(interval);
                let target_month = stepped.month;
                // next.setDate(dayOfMonth)  (may overflow into next month)
                let placed = stepped.set_day_js(dom);
                if placed.month != target_month {
                    // next.setDate(0) -> last day of target month
                    placed.set_day_zero()
                } else {
                    placed
                }
            }
            // `None` or `Some(0)` — the JS-falsy `dayOfMonth` case.
            _ => c.add_months_js(interval),
        },

        // "custom" and any unknown frequency fall through to interval-as-days,
        // matching the original switch's `custom` branch.
        _ => c.add_days(interval),
    };

    next.to_millis()
}

/// Result of advancing a recurrence, mirroring the `{ nextOccurrence, enabled }`
/// update the TS service applies (with end-date disabling).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecurringAdvance {
    /// `None` == the TS `undefined` (recurrence exhausted past end date).
    pub next_occurrence: Option<i64>,
    pub enabled: bool,
}

/// Port of the shared tail of `generateRecurringInstance` / `updateNextOccurrence`:
/// compute the next occurrence from `now_ms` and disable once it passes `endDate`.
pub fn advance(config: &RecurringConfig, now_ms: i64) -> RecurringAdvance {
    let next_occ = next_occurrence(config, now_ms);
    let past_end = matches!(config.end_date, Some(end) if next_occ > end);
    RecurringAdvance {
        next_occurrence: if past_end { None } else { Some(next_occ) },
        enabled: if past_end { false } else { config.enabled },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dateutil::Civil;

    fn ms(y: i64, mo: i64, d: i64) -> i64 {
        (Civil { year: y, month: mo, day: d, hour: 12, minute: 0, second: 0, milli: 0 }).to_millis()
    }
    fn cfg(freq: &str, interval: i64) -> RecurringConfig {
        RecurringConfig {
            enabled: true,
            frequency: freq.to_string(),
            interval,
            days_of_week: None,
            day_of_month: None,
            end_date: None,
            next_occurrence: None,
        }
    }

    #[test]
    fn daily() {
        let got = next_occurrence(&cfg("daily", 3), ms(2024, 1, 10));
        assert_eq!(got, ms(2024, 1, 13));
    }

    #[test]
    fn weekly_no_days() {
        let got = next_occurrence(&cfg("weekly", 2), ms(2024, 1, 1));
        assert_eq!(got, ms(2024, 1, 15));
    }

    #[test]
    fn monthly_no_dom_overflow() {
        // Jan 31 + 1 month (2024 leap) -> Mar 2, preserving noon.
        let got = next_occurrence(&cfg("monthly", 1), ms(2024, 1, 31));
        assert_eq!(got, ms(2024, 3, 2));
    }

    #[test]
    fn monthly_with_dom_clamps() {
        // dayOfMonth 31, interval 1 from Jan 15 2023 -> Feb has 28 -> clamp to Feb 28.
        let mut c = cfg("monthly", 1);
        c.day_of_month = Some(31);
        let got = next_occurrence(&c, ms(2023, 1, 15));
        assert_eq!(got, ms(2023, 2, 28));
    }

    #[test]
    fn monthly_day_of_month_zero_is_js_falsy() {
        // TS `if (config.dayOfMonth)` treats 0 as falsy -> same-day (add-months)
        // branch, NOT the day-of-month path. From Jan 15 2024 + 1 month -> Feb 15.
        let mut c = cfg("monthly", 1);
        c.day_of_month = Some(0);
        let got = next_occurrence(&c, ms(2024, 1, 15));
        assert_eq!(got, ms(2024, 2, 15));
        // Identical to leaving day_of_month unset.
        let mut c_none = cfg("monthly", 1);
        c_none.day_of_month = None;
        assert_eq!(got, next_occurrence(&c_none, ms(2024, 1, 15)));
    }

    #[test]
    fn advance_disables_past_end_date() {
        let mut c = cfg("daily", 10);
        c.end_date = Some(ms(2024, 1, 5));
        let r = advance(&c, ms(2024, 1, 1)); // next would be Jan 11 > Jan 5
        assert_eq!(r.next_occurrence, None);
        assert!(!r.enabled);
    }
}
