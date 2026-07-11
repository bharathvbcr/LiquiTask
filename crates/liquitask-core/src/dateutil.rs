//! Dependency-free civil (proleptic Gregorian) date arithmetic in UTC.
//!
//! We deliberately avoid `chrono`/`time` so this crate stays buildable without
//! network access or extra system libs. All functions operate on **epoch
//! milliseconds** (i64), matching what the TypeScript bridge sends after
//! converting `Date` values with `getTime()`.
//!
//! Semantics mirror JavaScript `Date` *date-component* mutators
//! (`setDate`/`setMonth`/`getDay`) evaluated in UTC. Recurrence is day-granular,
//! so UTC civil math matches the original local-time TS logic except at
//! sub-day/DST boundaries, which do not affect day/week/month stepping.
//!
//! Algorithms: Howard Hinnant's `days_from_civil` / `civil_from_days`
//! (http://howardhinnant.github.io/date_algorithms.html), which are exact for
//! the full range and public domain.

pub const MS_PER_DAY: i64 = 86_400_000;

/// A civil date-time broken into UTC components (mirrors JS Date getters).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Civil {
    pub year: i64,
    /// 1..=12
    pub month: i64,
    /// 1..=31
    pub day: i64,
    pub hour: i64,
    pub minute: i64,
    pub second: i64,
    pub milli: i64,
}

/// Days since 1970-01-01 for a civil date. Month is 1..=12.
/// Hinnant's algorithm; valid for any Gregorian date.
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as i64; // [0, 399]
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146097 + doe - 719468
}

/// Checked variant of [`days_from_civil`] — returns `None` when the formula overflows.
fn days_from_civil_checked(y: i64, m: i64, d: i64) -> Option<i64> {
    let y = if m <= 2 { y.checked_sub(1)? } else { y };
    let era = if y >= 0 {
        y / 400
    } else {
        (y - 399).checked_div(400)?
    };
    let yoe = y.checked_sub(era.checked_mul(400)?)?;
    let month_term = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * month_term + 2) / 5 + d - 1;
    let doe = yoe
        .checked_mul(365)?
        .checked_add(yoe / 4)?
        .checked_sub(yoe / 100)?
        .checked_add(doy)?;
    era.checked_mul(146097)?
        .checked_add(doe)?
        .checked_sub(719_468)
}

/// Inverse of `days_from_civil`: civil (y, m, d) from days since epoch.
pub fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Day of week, 0 = Sunday .. 6 = Saturday (matches JS `getDay`).
pub fn weekday_from_days(z: i64) -> i64 {
    // 1970-01-01 (z = 0) was a Thursday (4).
    (((z % 7) + 4) % 7 + 7) % 7
}

/// Number of days in a given month (month is 1..=12).
pub fn days_in_month(y: i64, m: i64) -> i64 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

impl Civil {
    /// Decompose epoch milliseconds into UTC civil components.
    pub fn from_millis(ms: i64) -> Civil {
        // Floor-divide so negative epochs (pre-1970) decompose correctly.
        let days = ms.div_euclid(MS_PER_DAY);
        let mut rem = ms.rem_euclid(MS_PER_DAY);
        let milli = rem % 1000;
        rem /= 1000;
        let second = rem % 60;
        rem /= 60;
        let minute = rem % 60;
        rem /= 60;
        let hour = rem % 24;
        let (year, month, day) = civil_from_days(days);
        Civil {
            year,
            month,
            day,
            hour,
            minute,
            second,
            milli,
        }
    }

    /// Recompose UTC civil components into epoch milliseconds.
    /// Saturates on overflow instead of panicking.
    pub fn to_millis(&self) -> i64 {
        let Some(days) = days_from_civil_checked(self.year, self.month, self.day) else {
            return if self.year >= 0 { i64::MAX } else { i64::MIN };
        };
        days.saturating_mul(MS_PER_DAY)
            .saturating_add(self.hour.saturating_mul(3_600_000))
            .saturating_add(self.minute.saturating_mul(60_000))
            .saturating_add(self.second.saturating_mul(1000))
            .saturating_add(self.milli)
    }

    /// JS `getDay()` — 0 = Sunday.
    pub fn weekday(&self) -> i64 {
        weekday_from_days(days_from_civil(self.year, self.month, self.day))
    }

    /// Mirror JS `date.setDate(getDate() + n)` — add `n` days, preserving the
    /// time-of-day, rolling months/years as needed.
    pub fn add_days(&self, n: i64) -> Civil {
        let days = days_from_civil(self.year, self.month, self.day) + n;
        let (year, month, day) = civil_from_days(days);
        Civil {
            year,
            month,
            day,
            ..*self
        }
    }

    /// Mirror JS `date.setMonth(getMonth() + n)` INCLUDING overflow: the
    /// day-of-month is preserved, and if the target month is shorter the date
    /// rolls forward into the following month (e.g. Jan 31 + 1mo -> Mar 3).
    pub fn add_months_js(&self, n: i64) -> Civil {
        let zero_based = self.month - 1 + n;
        let mut target_year = self.year + zero_based.div_euclid(12);
        let target_month = zero_based.rem_euclid(12) + 1; // 1..=12
        let dim = days_in_month(target_year, target_month);
        if self.day <= dim {
            Civil {
                year: target_year,
                month: target_month,
                day: self.day,
                ..*self
            }
        } else {
            // Overflow into the next month by (day - dim) days.
            let overflow = self.day - dim;
            let mut nm = target_month + 1;
            if nm > 12 {
                nm = 1;
                target_year += 1;
            }
            Civil {
                year: target_year,
                month: nm,
                day: overflow,
                ..*self
            }
        }
    }

    /// Mirror JS `date.setMonth(getMonth() + n)` when the day is guaranteed
    /// in-range (no overflow), used after `set_day(1)`.
    pub fn set_month_add(&self, n: i64) -> Civil {
        let zero_based = self.month - 1 + n;
        let target_year = self.year + zero_based.div_euclid(12);
        let target_month = zero_based.rem_euclid(12) + 1;
        Civil {
            year: target_year,
            month: target_month,
            ..*self
        }
    }

    /// Mirror JS `date.setDate(d)` INCLUDING overflow into later months when
    /// `d` exceeds the current month length.
    pub fn set_day_js(&self, d: i64) -> Civil {
        // Anchor to day 1 of this month, then add (d - 1) days.
        let base = Civil {
            day: 1,
            ..*self
        };
        base.add_days(d - 1)
    }

    /// Mirror JS `date.setDate(0)` — the last day of the *previous* month.
    pub fn set_day_zero(&self) -> Civil {
        let base = Civil {
            day: 1,
            ..*self
        };
        base.add_days(-1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_is_thursday() {
        assert_eq!(weekday_from_days(0), 4); // 1970-01-01 = Thursday
        let c = Civil::from_millis(0);
        assert_eq!((c.year, c.month, c.day), (1970, 1, 1));
        assert_eq!(c.weekday(), 4);
    }

    #[test]
    fn roundtrip_millis() {
        for &ms in &[0i64, 1, 1_000, 86_400_000, 1_700_000_000_000, -86_400_000] {
            let c = Civil::from_millis(ms);
            assert_eq!(c.to_millis(), ms, "roundtrip failed for {}", ms);
        }
    }

    #[test]
    fn add_days_rolls_month() {
        // 2024-01-31 + 1 day = 2024-02-01
        let c = Civil { year: 2024, month: 1, day: 31, hour: 9, minute: 0, second: 0, milli: 0 };
        let n = c.add_days(1);
        assert_eq!((n.year, n.month, n.day, n.hour), (2024, 2, 1, 9));
    }

    #[test]
    fn add_months_js_overflow() {
        // JS: new Date(2024,0,31); setMonth(1) -> 2024-03-02 (2024 is leap, Feb has 29)
        let c = Civil { year: 2024, month: 1, day: 31, hour: 0, minute: 0, second: 0, milli: 0 };
        let n = c.add_months_js(1);
        assert_eq!((n.year, n.month, n.day), (2024, 3, 2));
        // Non-leap: 2023-01-31 setMonth(1) -> 2023-03-03
        let c2 = Civil { year: 2023, month: 1, day: 31, hour: 0, minute: 0, second: 0, milli: 0 };
        let n2 = c2.add_months_js(1);
        assert_eq!((n2.year, n2.month, n2.day), (2023, 3, 3));
    }

    #[test]
    fn leap_year_february() {
        assert_eq!(days_in_month(2024, 2), 29);
        assert_eq!(days_in_month(2023, 2), 28);
        assert_eq!(days_in_month(2000, 2), 29);
        assert_eq!(days_in_month(1900, 2), 28);
    }

    #[test]
    fn to_millis_saturates_on_overflow() {
        let c = Civil {
            year: i64::MAX,
            month: 12,
            day: 31,
            hour: 23,
            minute: 59,
            second: 59,
            milli: 999,
        };
        assert_eq!(c.to_millis(), i64::MAX);
    }
}
