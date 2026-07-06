// Differential oracle case: automationService action reducer + isRuleDue.
//
// reference() = the ORIGINAL TypeScript logic with types stripped:
//   * the action-application loop lifted out of `processTaskEvent`, run over the
//     ALREADY-MATCHED rules (condition evaluation is intentionally NOT modeled —
//     the query engine stays in TS and only matched rules reach the reducer), and
//   * the private `isRuleDue`, which reads JS `Date` getters. Run under TZ=UTC
//     (see run.cjs) so those local-time getters equal the Rust UTC civil math.
// port()      = a JS mirror of crates/liquitask-core/src/automation.rs, built on
//   the Civil helpers (mirror of dateutil.rs) for the schedule due-check.
// Equality across fuzzed inputs proves the Rust port matches the original.

const { Civil } = require("../lib/civil.cjs");

const MUTABLE_TASK_FIELDS = new Set([
  "assignee",
  "summary",
  "title",
  "subtitle",
  "timeEstimate",
  "dueDate",
]);

// ---- reference: verbatim original TS logic (types stripped) -----------------

// The action-application loop from `processTaskEvent` (web/fallback path),
// isolated over the matched rules. Returns the reducer's observable outputs.
function referenceReducer(matchingRules, task) {
  const updates = {};
  const tagsToAdd = [];
  const tagsToRemove = [];
  const notifications = [];
  const assignToAgentIds = [];

  matchingRules.forEach((rule) => {
    rule.actions.forEach((action) => {
      switch (action.type) {
        case "setField":
          if (action.field && MUTABLE_TASK_FIELDS.has(action.field)) {
            updates[action.field] = action.value;
          }
          break;
        case "addTag":
          if (typeof action.value === "string") {
            tagsToAdd.push(action.value);
          }
          break;
        case "removeTag":
          if (typeof action.value === "string") {
            tagsToRemove.push(action.value);
          }
          break;
        case "moveToColumn":
          if (typeof action.value === "string") {
            updates.status = action.value;
          }
          break;
        case "setPriority":
          if (typeof action.value === "string") {
            updates.priority = action.value;
          }
          break;
        case "notify":
          if (typeof action.value === "string") {
            notifications.push(action.value);
          }
          break;
        case "assignToAgent":
          if (typeof action.value === "string") {
            assignToAgentIds.push(action.value);
          }
          break;
      }
    });
  });

  let tags;
  if (tagsToAdd.length > 0 || tagsToRemove.length > 0) {
    const currentTags = task.tags || [];
    const newTags = [
      ...currentTags.filter((t) => !tagsToRemove.includes(t)),
      ...tagsToAdd.filter((t) => !currentTags.includes(t)),
    ];
    updates.tags = newTags;
    tags = newTags;
  }

  const dedupedNotifications = Array.from(
    new Set(notifications.map((n) => n.trim()).filter(Boolean)),
  );
  const uniqueAgentIds = Array.from(new Set(assignToAgentIds));

  return {
    updates,
    tags,
    notifications: dedupedNotifications,
    assignToAgentIds: uniqueAgentIds,
  };
}

// The private `isRuleDue`, verbatim (uses JS Date getters; TZ=UTC in run.cjs).
function referenceIsRuleDue(rule, now) {
  if (!rule.schedule) return false;

  const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
  if (rule.schedule.time !== currentTime) {
    return false;
  }

  if (rule.schedule.frequency === "weekly" && typeof rule.schedule.dayOfWeek === "number") {
    return now.getDay() === rule.schedule.dayOfWeek;
  }

  if (rule.schedule.frequency === "monthly" && typeof rule.schedule.dayOfMonth === "number") {
    return now.getDate() === rule.schedule.dayOfMonth;
  }

  return true;
}

function reference(matchedRules, task, nowMs) {
  return {
    result: referenceReducer(matchedRules, task),
    due: matchedRules.map((r) => referenceIsRuleDue(r, new Date(nowMs))),
  };
}

// ---- port: mirror of liquitask_core::automation -----------------------------

// Read `obj[key]` as a string, else undefined — mirrors the Rust `str_field`
// (`typeof value === "string"` guard).
function strField(obj, key) {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

function portReducer(rules, task) {
  const updates = {};
  const tagsToAdd = [];
  const tagsToRemove = [];
  const notifications = [];
  const assignToAgentIds = [];

  for (const rule of rules) {
    const actions = Array.isArray(rule.actions) ? rule.actions : null;
    if (!actions) continue;

    for (const action of actions) {
      const actionType = strField(action, "type");
      if (actionType === undefined) continue;

      switch (actionType) {
        case "setField": {
          const field = strField(action, "field");
          if (field !== undefined && field !== "" && MUTABLE_TASK_FIELDS.has(field)) {
            // Corrected Rust: present value (incl. explicit null) is written;
            // an ABSENT `value` key writes nothing (matches TS undefined-dropped).
            if ("value" in action) updates[field] = action.value;
          }
          break;
        }
        case "addTag": {
          const v = strField(action, "value");
          if (v !== undefined) tagsToAdd.push(v);
          break;
        }
        case "removeTag": {
          const v = strField(action, "value");
          if (v !== undefined) tagsToRemove.push(v);
          break;
        }
        case "moveToColumn": {
          const v = strField(action, "value");
          if (v !== undefined) updates.status = v;
          break;
        }
        case "setPriority": {
          const v = strField(action, "value");
          if (v !== undefined) updates.priority = v;
          break;
        }
        case "notify": {
          const v = strField(action, "value");
          if (v !== undefined) notifications.push(v);
          break;
        }
        case "assignToAgent": {
          const v = strField(action, "value");
          if (v !== undefined) assignToAgentIds.push(v);
          break;
        }
        default:
          break;
      }
    }
  }

  let tags;
  if (tagsToAdd.length > 0 || tagsToRemove.length > 0) {
    const currentTags = task.tags || [];
    const newTags = currentTags.filter((t) => !tagsToRemove.includes(t));
    for (const t of tagsToAdd) {
      if (!currentTags.includes(t)) newTags.push(t);
    }
    updates.tags = newTags;
    tags = newTags;
  }

  const dedupedNotifications = [];
  for (const n of notifications) {
    const trimmed = n.trim();
    if (trimmed === "") continue;
    if (!dedupedNotifications.includes(trimmed)) dedupedNotifications.push(trimmed);
  }

  const uniqueAgentIds = [];
  for (const id of assignToAgentIds) {
    if (!uniqueAgentIds.includes(id)) uniqueAgentIds.push(id);
  }

  return {
    updates,
    tags,
    notifications: dedupedNotifications,
    assignToAgentIds: uniqueAgentIds,
  };
}

// Mirror of `is_rule_due`: decompose nowMs into UTC civil components.
function portIsRuleDue(rule, nowMs) {
  const schedule = rule.schedule;
  if (schedule === undefined || schedule === null || typeof schedule !== "object") {
    return false;
  }

  const c = Civil.fromMillis(nowMs);
  const pad = (n) => n.toString().padStart(2, "0");
  const currentTime = `${pad(c.hour)}:${pad(c.minute)}`;

  const time = strField(schedule, "time");
  if (time !== currentTime) {
    return false;
  }

  const frequency = strField(schedule, "frequency") ?? "";

  if (frequency === "weekly" && typeof schedule.dayOfWeek === "number") {
    return c.weekday() === schedule.dayOfWeek;
  }

  if (frequency === "monthly" && typeof schedule.dayOfMonth === "number") {
    return c.day === schedule.dayOfMonth;
  }

  return true;
}

function port(matchedRules, task, nowMs) {
  return {
    result: portReducer(matchedRules, task),
    due: matchedRules.map((r) => portIsRuleDue(r, nowMs)),
  };
}

// ---- fuzz: random tasks + random matched rules ------------------------------

const ALL_ACTION_TYPES = [
  "setField",
  "addTag",
  "removeTag",
  "moveToColumn",
  "setPriority",
  "notify",
  "assignToAgent",
];
const SET_FIELDS = ["assignee", "summary", "title", "subtitle", "timeEstimate", "dueDate", "id", "status"];
const TAG_POOL = ["", "  ", " a ", "a", "b", "c", "old", "new", "auto", "urgent"];
const STRING_POOL = ["", "  ", "hi", " hi ", "bye", "High", "Low", "Done", "InProgress", "agent-1", "agent-2"];
const FREQS = ["daily", "weekly", "monthly", "other"];

function randInt(rng, n) {
  return Math.floor(rng() * n);
}
function pick(rng, arr) {
  return arr[randInt(rng, arr.length)];
}

// Random value that MAY be non-string, to exercise the `typeof === "string"`
// guards on the tag/move/priority/notify/assign branches (which drop
// non-strings). Includes `undefined` — for those branches an `undefined` value
// is dropped by both the reference and the port, so they agree.
function randomValue(rng) {
  const r = rng();
  if (r < 0.55) return pick(rng, STRING_POOL); // string
  if (r < 0.65) return randInt(rng, 500); // number
  if (r < 0.72) return rng() < 0.5; // boolean
  if (r < 0.78) return null;
  if (r < 0.84) return undefined;
  if (r < 0.92) return ["x", randInt(rng, 3)]; // array
  return { nested: randInt(rng, 3) }; // object
}

// Random value for `setField`, which stores the value VERBATIM (any type). We
// exclude `undefined` here: `undefined` is not JSON-representable, so a
// `setField` value of `undefined` cannot cross the JS->JSON->Rust boundary —
// it arrives as an ABSENT key which Rust maps to `Value::Null`. Comparing the
// pure-JS reference (which keeps `undefined`, then JSON.stringify drops the
// key) against the Rust-mirrored port (which would surface `null`) would be a
// false negative about a value that can never actually reach Rust. Every value
// below DOES round-trip through Rust identically.
function randomJsonValue(rng) {
  const r = rng();
  if (r < 0.5) return pick(rng, STRING_POOL); // string
  if (r < 0.65) return randInt(rng, 500); // number
  if (r < 0.75) return rng() < 0.5; // boolean
  if (r < 0.85) return null;
  if (r < 0.93) return ["x", randInt(rng, 3)]; // array
  return { nested: randInt(rng, 3) }; // object
}

function randomAction(rng) {
  const type = pick(rng, ALL_ACTION_TYPES);
  if (type === "setField") {
    // A matched setField action always has a (JSON-representable) `value`.
    const action = { type, field: pick(rng, SET_FIELDS), value: randomJsonValue(rng) };
    if (rng() < 0.08) action.field = randInt(rng, 5); // non-string field -> ignored
    return action;
  }
  // Tag actions bias toward the tag pool so add/remove/merge ordering is tested.
  if ((type === "addTag" || type === "removeTag") && rng() < 0.85) {
    return { type, value: pick(rng, TAG_POOL) };
  }
  return { type, value: randomValue(rng) };
}

function randomSchedule(rng) {
  const frequency = pick(rng, FREQS);
  // Bias `time` toward the actual HH:mm of nowMs sometimes (done by caller via
  // matching), but here just produce plausible / sometimes-matching times.
  const hh = randInt(rng, 24);
  const mm = randInt(rng, 60);
  const schedule = {
    frequency,
    time: `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}`,
  };
  // Occasionally emit a FRACTIONAL day: JS `getDay() === 1.5` is always false, so
  // the rule never fires. The Rust port previously truncated it and could match.
  if (rng() < 0.6) schedule.dayOfWeek = randInt(rng, 7) + (rng() < 0.15 ? 0.5 : 0);
  if (rng() < 0.6) schedule.dayOfMonth = 1 + randInt(rng, 31) + (rng() < 0.15 ? 0.5 : 0);
  // Rarely emit a malformed schedule to test the guards.
  if (rng() < 0.05) return null;
  if (rng() < 0.05) delete schedule.time;
  return schedule;
}

function randomRule(rng, nowMs) {
  const nActions = randInt(rng, 6); // 0..5 actions
  const actions = [];
  for (let i = 0; i < nActions; i++) actions.push(randomAction(rng));

  const rule = {
    id: `r${randInt(rng, 1000)}`,
    name: "rule",
    enabled: true,
    trigger: "onSchedule",
    actions,
  };

  // ~half the rules carry a schedule; of those, force a time match on nowMs
  // sometimes so the weekly/monthly day branches are actually exercised.
  if (rng() < 0.85) {
    const schedule = randomSchedule(rng);
    if (schedule && rng() < 0.5) {
      const c = Civil.fromMillis(nowMs);
      const pad = (n) => n.toString().padStart(2, "0");
      schedule.time = `${pad(c.hour)}:${pad(c.minute)}`;
    }
    if (schedule !== undefined) rule.schedule = schedule;
  }
  // NOTE: a matched `AutomationRule` always carries an `actions` array (the TS
  // type guarantees it), so we never drop it here — the original TS reducer
  // does not guard against a missing `actions`, and the oracle proves parity
  // with that original. (The Rust reducer keeps a defensive guard regardless.)
  return rule;
}

function randomTask(rng) {
  const nTags = randInt(rng, 5);
  const tags = [];
  for (let i = 0; i < nTags; i++) tags.push(pick(rng, ["a", "b", "c", "old", "new", "auto"]));
  return {
    id: `t${randInt(rng, 1000)}`,
    tags,
    status: pick(rng, ["Todo", "Done"]),
    priority: pick(rng, ["low", "medium", "high"]),
  };
}

function* fuzz(rng) {
  for (let i = 0; i < 6000; i++) {
    // nowMs spread across ~1970..2035.
    const nowMs = Math.floor((rng() - 0.05) * 2_000_000_000_000);
    const task = randomTask(rng);
    const nRules = randInt(rng, 5); // 0..4 matched rules
    const rules = [];
    for (let r = 0; r < nRules; r++) rules.push(randomRule(rng, nowMs));
    yield {
      args: [rules, task, nowMs],
      label: `rules=${rules.length} tags=[${task.tags.join(",")}] @${nowMs}`,
    };
  }
}

module.exports = { name: "automation.reducer", reference, port, fuzz };
