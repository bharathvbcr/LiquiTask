/**
 * Value coercion helpers for the agent boundary.
 *
 * LLM providers (and some plugin payloads) frequently return a shape that
 * *looks* right to TypeScript's erased types but is wrong at runtime — most
 * commonly an object where a string is expected, e.g. a subtask returned as
 * `{ title: "Do X", description: "..." }` instead of the bare string `"Do X"`.
 *
 * When such a value reaches the native (Tauri) command boundary, serde rejects
 * it with `invalid type: map, expected a string` and the *entire* agent run
 * fails. These helpers normalise arbitrary input into clean strings so a single
 * malformed field can never crash a run.
 */

/** Keys we will unwrap, in preference order, when handed an object-as-string. */
const STRING_LIKE_KEYS = [
  "title",
  "name",
  "text",
  "label",
  "task",
  "step",
  "value",
  "summary",
  "description",
] as const;

/**
 * Cap on how deep we descend into nested arrays. Leaf scalars are still
 * converted at any depth; this only stops runaway recursion on pathological
 * input (e.g. `[[[[…]]]]`) from blowing the stack.
 */
const MAX_COERCE_DEPTH = 4;

function coerceString(value: unknown, fallback: string, depth: number): string {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // Only nested arrays/objects recurse; guard them (scalars above are cheap).
  if (depth >= MAX_COERCE_DEPTH) return fallback;
  if (Array.isArray(value)) {
    const joined = value
      .map((v) => coerceString(v, "", depth + 1))
      .filter((s) => s.length > 0)
      .join(", ");
    return joined || fallback;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of STRING_LIKE_KEYS) {
      const candidate = record[key];
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate;
      }
    }
  }
  return fallback;
}

/**
 * Coerce an arbitrary value into a clean string.
 *
 * - strings pass through
 * - numbers / booleans are stringified
 * - arrays are joined (each element coerced)
 * - objects are unwrapped via the first matching {@link STRING_LIKE_KEYS} key
 * - anything unresolvable falls back to `fallback` (default `""`)
 */
export function asString(value: unknown, fallback = ""): string {
  return coerceString(value, fallback, 0);
}

/**
 * Coerce an arbitrary value into a trimmed, de-duplicated array of non-empty
 * strings. Accepts a single value, an array, or `null`/`undefined`.
 */
export function asStringArray(value: unknown): string[] {
  if (value == null) return [];
  const items = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const str = asString(item).trim();
    if (str.length === 0 || seen.has(str)) continue;
    seen.add(str);
    out.push(str);
  }
  return out;
}

/**
 * Normalise AI-generated subtasks into plain title strings. This is the exact
 * shape `Task.subtasks[].title` and the native `SubtaskInput.title` require.
 */
export function normalizeSubtaskTitles(value: unknown): string[] {
  return asStringArray(value);
}
