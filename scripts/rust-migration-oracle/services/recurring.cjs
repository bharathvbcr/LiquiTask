// Differential oracle case: recurringTaskService.calculateNextOccurrence
//
// reference() = the ORIGINAL TypeScript algorithm with types stripped, using
//   JS `Date` exactly as src/services/recurringTaskService.ts does. Run under
//   TZ=UTC (see run.js) so JS local-time getters == the Rust UTC civil math.
// port()      = a JS mirror of crates/liquitask-core/src/recurring.rs, built
//   only from the Civil helpers (mirror of dateutil.rs).
// Equality across fuzzed inputs proves the Rust port matches the original.

const { Civil } = require("../lib/civil.cjs");

// ---- reference: verbatim original TS logic (types stripped) ----------------
function reference(config, fromMs) {
  const fromDate = new Date(fromMs);
  const next = new Date(fromDate);
  switch (config.frequency) {
    case "daily":
      next.setDate(next.getDate() + config.interval);
      break;
    case "weekly":
      if (config.daysOfWeek && config.daysOfWeek.length > 0) {
        const currentDay = next.getDay();
        const sortedDays = [...config.daysOfWeek].sort((a, b) => a - b);
        const nextDayThisWeek = sortedDays.find((day) => day > currentDay);
        if (nextDayThisWeek !== undefined) {
          next.setDate(next.getDate() + (nextDayThisWeek - currentDay) + (config.interval - 1) * 7);
        } else {
          const daysUntilNext = 7 - currentDay + sortedDays[0];
          next.setDate(next.getDate() + daysUntilNext + (config.interval - 1) * 7);
        }
      } else {
        next.setDate(next.getDate() + 7 * config.interval);
      }
      break;
    case "monthly":
      if (config.dayOfMonth) {
        next.setDate(1);
        next.setMonth(next.getMonth() + config.interval);
        const targetMonth = next.getMonth();
        next.setDate(config.dayOfMonth);
        if (next.getMonth() !== targetMonth) {
          next.setDate(0);
        }
      } else {
        next.setMonth(next.getMonth() + config.interval);
      }
      break;
    case "custom":
      next.setDate(next.getDate() + config.interval);
      break;
  }
  return next.getTime();
}

// ---- port: mirror of liquitask-core::recurring::next_occurrence -------------
function port(config, fromMs) {
  const c = Civil.fromMillis(fromMs);
  const interval = config.interval;
  let next;
  switch (config.frequency) {
    case "daily":
      next = c.addDays(interval);
      break;
    case "weekly":
      if (config.daysOfWeek && config.daysOfWeek.length > 0) {
        const currentDay = c.weekday();
        const sorted = [...config.daysOfWeek].sort((a, b) => a - b);
        const nextDay = sorted.find((day) => day > currentDay);
        if (nextDay !== undefined) {
          next = c.addDays((nextDay - currentDay) + (interval - 1) * 7);
        } else {
          const daysUntilNext = 7 - currentDay + sorted[0];
          next = c.addDays(daysUntilNext + (interval - 1) * 7);
        }
      } else {
        next = c.addDays(7 * interval);
      }
      break;
    case "monthly":
      if (config.dayOfMonth) {
        const d1 = c._with({ day: 1 });
        const stepped = d1.setMonthAdd(interval);
        const targetMonth = stepped.month;
        const placed = stepped.setDayJs(config.dayOfMonth);
        next = placed.month !== targetMonth ? placed.setDayZero() : placed;
      } else {
        next = c.addMonthsJs(interval);
      }
      break;
    default: // "custom" and unknown
      next = c.addDays(interval);
  }
  return next.toMillis();
}

// ---- fuzz: random configs + reference instants -----------------------------
function* fuzz(rng) {
  const freqs = ["daily", "weekly", "monthly", "custom"];
  for (let i = 0; i < 20000; i++) {
    const frequency = freqs[Math.floor(rng() * freqs.length)];
    const interval = 1 + Math.floor(rng() * 6);
    const config = { enabled: true, frequency, interval };
    if (frequency === "weekly" && rng() < 0.7) {
      const n = 1 + Math.floor(rng() * 4);
      const days = new Set();
      while (days.size < n) days.add(Math.floor(rng() * 7));
      config.daysOfWeek = [...days];
    }
    if (frequency === "monthly" && rng() < 0.7) {
      // Include 0 (JS-falsy) to exercise the dayOfMonth-branch guard, which the
      // Rust `Some(0)` match previously diverged on.
      config.dayOfMonth = rng() < 0.1 ? 0 : 1 + Math.floor(rng() * 31);
    }
    // Reference instant: spread across ~1970..2035 at random ms.
    const fromMs = Math.floor((rng() - 0.05) * 2_000_000_000_000);
    yield { args: [config, fromMs], label: `${JSON.stringify(config)}@${fromMs}` };
  }
}

module.exports = { name: "recurring.next_occurrence", reference, port, fuzz };
