// JS mirror of `crates/liquitask-core/src/dateutil.rs`.
//
// This is a line-for-line port of the Rust civil-date math into plain JS,
// used by the differential oracle to prove the Rust logic matches the original
// TypeScript (which uses JS `Date`). If you change dateutil.rs, change this too.
// No dependencies; integer math only.

const MS_PER_DAY = 86_400_000;

function floorDiv(a, b) {
  return Math.floor(a / b);
}
function mod(a, b) {
  return ((a % b) + b) % b;
}

function daysFromCivil(y, m, d) {
  y = m <= 2 ? y - 1 : y;
  const era = floorDiv(y >= 0 ? y : y - 399, 400);
  const yoe = y - era * 400;
  const doy = floorDiv(153 * (m > 2 ? m - 3 : m + 9) + 2, 5) + d - 1;
  const doe = yoe * 365 + floorDiv(yoe, 4) - floorDiv(yoe, 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z) {
  z += 719468;
  const era = floorDiv(z >= 0 ? z : z - 146096, 146097);
  const doe = z - era * 146097;
  const yoe = floorDiv(doe - floorDiv(doe, 1460) + floorDiv(doe, 36524) - floorDiv(doe, 146096), 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + floorDiv(yoe, 4) - floorDiv(yoe, 100));
  const mp = floorDiv(5 * doy + 2, 153);
  const d = doy - floorDiv(153 * mp + 2, 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [m <= 2 ? y + 1 : y, m, d];
}

function weekdayFromDays(z) {
  return mod(mod(z, 7) + 4, 7);
}

function daysInMonth(y, m) {
  switch (m) {
    case 1: case 3: case 5: case 7: case 8: case 10: case 12: return 31;
    case 4: case 6: case 9: case 11: return 30;
    case 2: return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
    default: return 30;
  }
}

class Civil {
  constructor(year, month, day, hour, minute, second, milli) {
    this.year = year; this.month = month; this.day = day;
    this.hour = hour; this.minute = minute; this.second = second; this.milli = milli;
  }
  static fromMillis(ms) {
    const days = floorDiv(ms, MS_PER_DAY);
    let rem = mod(ms, MS_PER_DAY);
    const milli = rem % 1000; rem = Math.floor(rem / 1000);
    const second = rem % 60; rem = Math.floor(rem / 60);
    const minute = rem % 60; rem = Math.floor(rem / 60);
    const hour = rem % 24;
    const [year, month, day] = civilFromDays(days);
    return new Civil(year, month, day, hour, minute, second, milli);
  }
  toMillis() {
    const days = daysFromCivil(this.year, this.month, this.day);
    return days * MS_PER_DAY + this.hour * 3_600_000 + this.minute * 60_000 + this.second * 1000 + this.milli;
  }
  weekday() {
    return weekdayFromDays(daysFromCivil(this.year, this.month, this.day));
  }
  _with(overrides) {
    const c = new Civil(this.year, this.month, this.day, this.hour, this.minute, this.second, this.milli);
    return Object.assign(c, overrides);
  }
  addDays(n) {
    const [year, month, day] = civilFromDays(daysFromCivil(this.year, this.month, this.day) + n);
    return this._with({ year, month, day });
  }
  addMonthsJs(n) {
    const zeroBased = this.month - 1 + n;
    let targetYear = this.year + floorDiv(zeroBased, 12);
    const targetMonth = mod(zeroBased, 12) + 1;
    const dim = daysInMonth(targetYear, targetMonth);
    if (this.day <= dim) {
      return this._with({ year: targetYear, month: targetMonth, day: this.day });
    }
    const overflow = this.day - dim;
    let nm = targetMonth + 1;
    if (nm > 12) { nm = 1; targetYear += 1; }
    return this._with({ year: targetYear, month: nm, day: overflow });
  }
  setMonthAdd(n) {
    const zeroBased = this.month - 1 + n;
    const targetYear = this.year + floorDiv(zeroBased, 12);
    const targetMonth = mod(zeroBased, 12) + 1;
    return this._with({ year: targetYear, month: targetMonth });
  }
  setDayJs(d) {
    return this._with({ day: 1 }).addDays(d - 1);
  }
  setDayZero() {
    return this._with({ day: 1 }).addDays(-1);
  }
}

module.exports = { Civil, daysFromCivil, civilFromDays, weekdayFromDays, daysInMonth, MS_PER_DAY };
