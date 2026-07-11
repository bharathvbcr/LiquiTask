//! Thin `#[tauri::command]` wrappers over `liquitask_core::recurring`.
//!
//! Tauri auto-converts camelCase JS arg keys to snake_case Rust params (same as
//! the existing `workspace_read_file` command), so the renderer calls:
//!   invoke("recurring_next_occurrence", { config, fromMs })
//!   invoke("recurring_advance",         { config, nowMs })

use liquitask_core::model::RecurringConfig;
use liquitask_core::recurring::{self, RecurringAdvance};

/// Next occurrence (epoch millis) for a recurrence config, from `from_ms`.
#[tauri::command]
pub fn recurring_next_occurrence(config: RecurringConfig, from_ms: i64) -> i64 {
    recurring::next_occurrence(&config, from_ms)
}

/// Next occurrence plus end-date disabling, mirroring the TS update payload.
#[tauri::command]
pub fn recurring_advance(config: RecurringConfig, now_ms: i64) -> RecurringAdvance {
    recurring::advance(&config, now_ms)
}

#[cfg(test)]
mod tests {
    use super::*;
    use liquitask_core::dateutil::Civil;

    fn ms(y: i64, mo: i64, d: i64) -> i64 {
        Civil {
            year: y,
            month: mo,
            day: d,
            hour: 12,
            minute: 0,
            second: 0,
            milli: 0,
        }
        .to_millis()
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
    fn recurring_wrappers_roundtrip() {
        let config = cfg("daily", 2);
        let from = ms(2024, 1, 10);
        assert_eq!(recurring_next_occurrence(config.clone(), from), ms(2024, 1, 12));

        let adv = recurring_advance(config, from);
        assert_eq!(adv.next_occurrence, Some(ms(2024, 1, 12)));
        assert!(adv.enabled);
    }

    #[test]
    fn recurring_advance_disables_past_end() {
        let mut config = cfg("daily", 5);
        config.end_date = Some(ms(2024, 1, 12));
        let adv = recurring_advance(config, ms(2024, 1, 10));
        assert_eq!(adv.next_occurrence, None);
        assert!(!adv.enabled);
    }
}
