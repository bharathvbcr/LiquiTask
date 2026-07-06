// Differential oracle case: autoOrganizeService deterministic helpers.
//
// This service is PREDOMINANTLY AI orchestration (aiService/Ollama). None of
// that is ported. Only three genuinely pure, structural pieces move to Rust and
// are proven here:
//   1. filterTasks       -> keptIds  (exclude projects, then slice to batch cap)
//   2. runDeduplication  -> pairs    (title-word inverted index -> unique pairs,
//                                      the step BEFORE aiService.detectDuplicates)
//   3. applyChanges tag- -> remap    (map tags before->suggested, dedupe in order)
//      consolidate branch
//
// reference() = the ORIGINAL TypeScript algorithms (types stripped), verbatim
//   from src/services/autoOrganizeService.ts.
// port()      = a JS mirror of crates/liquitask-core/src/auto_organize.rs.
//
// Candidate-pair DISCOVERY ORDER can legitimately differ (JS Map insertion
// order vs the Rust Vec-backed index — both deterministic, but the oracle only
// asserts the SET is equal), so `pairs` is compared as a SORTED SET of "a|b"
// strings. keptIds and remap are compared as-is (order is load-bearing there).
//
// No dates here, so no Civil helper is needed; both sides are plain array/string
// logic operating on the same inputs.

// ---- reference: verbatim original TS logic (types stripped) ----------------

// From AutoOrganizeService.filterTasks (returns the kept task ids, in order).
function refFilterTaskIds(tasks, excludedProjectIds, maxTasksPerBatch) {
  let filtered = tasks;
  if (excludedProjectIds.length > 0) {
    filtered = filtered.filter((t) => !excludedProjectIds.includes(t.projectId));
  }
  if (filtered.length > maxTasksPerBatch) {
    filtered = filtered.slice(0, maxTasksPerBatch);
  }
  return filtered.map((t) => t.id);
}

// From runDeduplication: the candidate-pair generation BEFORE aiService. The
// original builds { task1, task2 } refs; here we emit the id-pairs that drive
// them, in the exact [ids[i], ids[j]].sort() key order.
function refCandidatePairs(tasks) {
  if (tasks.length < 2) return [];

  const titleIndex = new Map();
  for (const task of tasks) {
    const words = task.title
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    for (const word of words) {
      if (!titleIndex.has(word)) titleIndex.set(word, []);
      titleIndex.get(word).push(task.id);
    }
  }

  const pairSet = new Set();
  const out = [];
  for (const [, ids] of titleIndex) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const sorted = [ids[i], ids[j]].sort();
        const key = sorted.join("-");
        if (!pairSet.has(key)) {
          pairSet.add(key);
          // Original only pushes when both tasks resolve by id; every id came
          // from `tasks`, so this always resolves.
          const t1 = tasks.find((t) => t.id === sorted[0]);
          const t2 = tasks.find((t) => t.id === sorted[1]);
          if (t1 && t2) out.push([sorted[0], sorted[1]]);
        }
      }
    }
  }
  return out;
}

// From applyChanges' tag-consolidate branch: remap one task's tags.
function refConsolidateTags(tags, before, suggested) {
  const newTags = tags.map((t) => (before.includes(t) ? suggested : t));
  return Array.from(new Set(newTags));
}

function reference(tasks, excludedProjectIds, maxTasksPerBatch, sampleTags, before, suggested) {
  return {
    keptIds: refFilterTaskIds(tasks, excludedProjectIds, maxTasksPerBatch),
    pairs: sortedPairSet(refCandidatePairs(tasks)),
    remap: refConsolidateTags(sampleTags, before, suggested),
  };
}

// ---- port: mirror of liquitask-core::auto_organize --------------------------

function portFilterTaskIds(tasks, excludedProjectIds, maxTasksPerBatch) {
  let filtered = excludedProjectIds.length === 0
    ? tasks.slice()
    : tasks.filter((t) => !excludedProjectIds.includes(t.projectId));
  // Corrected Rust reproduces JS `slice(0, max)` verbatim (negative caps count
  // from the end, they do NOT clamp to an empty array).
  if (filtered.length > maxTasksPerBatch) {
    filtered = filtered.slice(0, maxTasksPerBatch);
  }
  return filtered.map((t) => t.id);
}

function portCandidatePairs(tasks) {
  if (tasks.length < 2) return [];

  // Insertion-ordered inverted index (mirror of the Rust Vec + HashMap<idx>).
  const order = []; // [ [word, ids[]], ... ]
  const wordIndex = new Map(); // word -> index into `order`

  for (const task of tasks) {
    for (const rawWord of splitWhitespace(task.title)) {
      // Mirror the Rust: lowercase FIRST, then keep length > 2 (matches the TS,
      // which lowercases the whole title then filters `w.length > 2`).
      const lower = rawWord.toLowerCase();
      if (lower.length <= 2) continue;
      const idx = wordIndex.get(lower);
      if (idx !== undefined) {
        order[idx][1].push(task.id);
      } else {
        wordIndex.set(lower, order.length);
        order.push([lower, [task.id]]);
      }
    }
  }

  const pairSeen = new Set();
  const pairs = [];
  for (const [, ids] of order) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = sortedPair(ids[i], ids[j]);
        const key = `${a}-${b}`;
        if (!pairSeen.has(key)) {
          pairSeen.add(key);
          pairs.push([a, b]);
        }
      }
    }
  }
  return pairs;
}

function portConsolidateTags(tags, before, suggested) {
  const seen = new Set();
  const out = [];
  for (const tag of tags) {
    const mapped = before.includes(tag) ? suggested : tag;
    if (!seen.has(mapped)) {
      seen.add(mapped);
      out.push(mapped);
    }
  }
  return out;
}

function port(tasks, excludedProjectIds, maxTasksPerBatch, sampleTags, before, suggested) {
  return {
    keptIds: portFilterTaskIds(tasks, excludedProjectIds, maxTasksPerBatch),
    pairs: sortedPairSet(portCandidatePairs(tasks)),
    remap: portConsolidateTags(sampleTags, before, suggested),
  };
}

// ---- helpers ---------------------------------------------------------------

// Mirror of Rust `str <= str` (byte/code-unit) ordering used by sorted_pair.
function sortedPair(a, b) {
  return a <= b ? [a, b] : [b, a];
}

// Mirror of Rust `split_js_whitespace`: the corrected Rust splits on the JS
// regex `\s` class (NOT Unicode `White_Space`), so this uses the same
// `.split(/\s+/)` the original TS does. Empty tokens are length 0 and dropped by
// the caller's `> 2` filter anyway.
function splitWhitespace(s) {
  return s.split(/\s+/).filter((w) => w.length > 0);
}

// Compare candidate pairs as a SORTED SET: collapse to unique "a|b" strings,
// sorted, so discovery-order differences don't matter.
function sortedPairSet(pairs) {
  const set = new Set(pairs.map(([a, b]) => `${a}|${b}`));
  return Array.from(set).sort();
}

// ---- fuzz: random task sets + filter/tag combos ----------------------------
function* fuzz(rng) {
  // Small vocabulary so title-word overlaps (and thus pairs) form frequently.
  // Some words are length <= 2 to exercise the `length > 2` filter, and mixed
  // case to exercise lowercasing.
  const vocab = [
    "deploy", "Service", "pipeline", "fix", "BUG", "api", "ui", "test",
    "db", "to", "a", "an", "Auth", "login", "cache", "Queue", "sync",
    // Special-character tokens that stress the whitespace class and UTF-16
    // length count (shared across tasks via the normal repeat mechanism):
    "review\uFEFFreport",     // U+FEFF (BOM) IS JS \s -> splits into two words
    "plan\u0085session",      // U+0085 (NEL) is NOT JS \s -> stays one word
    "\u{1F600}\u{1F600}",     // non-BMP emoji -> JS length 4 (2 scalars)
  ];
  const projectPool = ["p1", "p2", "p3", "p4", "px"];
  const tagPool = ["bug", "defect", "ui", "backend", "api", "urgent", "issue", "chore"];

  for (let i = 0; i < 8000; i++) {
    // --- random task set ---
    const n = Math.floor(rng() * 9); // 0..8 tasks (exercise the <2 guard too)
    const tasks = [];
    for (let k = 0; k < n; k++) {
      // Title: 0..4 words drawn from the vocab (repeats allowed so shared words
      // across tasks -> candidate pairs).
      const wc = Math.floor(rng() * 5);
      const words = [];
      for (let w = 0; w < wc; w++) {
        words.push(vocab[Math.floor(rng() * vocab.length)]);
      }
      // Occasionally add extra internal whitespace to exercise the splitter.
      const title = words.join(rng() < 0.15 ? "   " : " ");
      const projectId = projectPool[Math.floor(rng() * projectPool.length)];
      // Non-unique ids on purpose sometimes? No — ids must be unique for the
      // find()/map() semantics to be well-defined; use the loop index.
      tasks.push({ id: "T" + k, projectId, title, tags: [] });
    }

    // --- random exclude list + batch cap ---
    const excluded = [];
    const nEx = Math.floor(rng() * 3); // 0..2 excluded project ids
    for (let e = 0; e < nEx; e++) {
      const p = projectPool[Math.floor(rng() * projectPool.length)];
      if (!excluded.includes(p)) excluded.push(p);
    }
    // maxTasksPerBatch: cover negative caps, 0, small caps, and caps above the
    // task count. Negatives exercise the JS `slice(0, negative)` from-the-end
    // semantics the Rust clamp previously got wrong.
    const maxTasksPerBatch = Math.floor(rng() * 13) - 3;

    // --- random tag / before / suggested combo for the remap ---
    const stc = Math.floor(rng() * 6); // 0..5 sample tags (repeats allowed)
    const sampleTags = [];
    for (let t = 0; t < stc; t++) {
      sampleTags.push(tagPool[Math.floor(rng() * tagPool.length)]);
    }
    const bc = Math.floor(rng() * 4); // 0..3 "before" tags
    const before = [];
    for (let b = 0; b < bc; b++) {
      const tg = tagPool[Math.floor(rng() * tagPool.length)];
      if (!before.includes(tg)) before.push(tg);
    }
    const suggested = tagPool[Math.floor(rng() * tagPool.length)];

    yield {
      args: [tasks, excluded, maxTasksPerBatch, sampleTags, before, suggested],
      label:
        `n=${n} ex=[${excluded.join(",")}] cap=${maxTasksPerBatch} ` +
        `tags=[${sampleTags.join(",")}] before=[${before.join(",")}] sug=${suggested}`,
    };
  }
}

module.exports = { name: "autoOrganize.deterministic", reference, port, fuzz };
