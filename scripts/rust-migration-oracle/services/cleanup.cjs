// Differential oracle case: taskCleanupService heuristics.
//
// reference() = the ORIGINAL TypeScript heuristics from
//   src/services/taskCleanupService.ts, with types stripped and the
//   non-deterministic id/random fields removed, so each function returns only
//   the deterministic structural data (task-id groupings, confidences,
//   reasoning, suggested actions, merged fields). `now` is passed in (the
//   originals read `new Date()` / `Date.now()`), never a live clock.
// port()      = a JS mirror of crates/liquitask-core/src/cleanup.rs, built to
//   reproduce the Rust structural output byte-for-byte.
//
// Because the service exposes several functions, both reference() and port()
// return a COMBINED normalized object:
//   { dupes, redundancy, categorize, clusters, merge }
// Equality across fuzzed inputs proves the Rust port matches the original.
//
// Run under TZ=UTC (see run.cjs) — the string/number math here is TZ-independent,
// but the harness pins TZ=UTC for all cases uniformly.

// ===========================================================================
// Shared string helpers (identical logic used by BOTH reference and port so a
// mismatch can only come from an algorithmic divergence, not the primitives).
// The reference uses real JS regexes; the port re-implements the JS regex
// semantics the way cleanup.rs does, and we assert they agree via the fuzz.
// ===========================================================================

// ---- reference primitives: verbatim JS from the original service ----------
function refNormalize(t) {
  return t
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .trim();
}

function refTitleSimilarity(title1, title2) {
  const n1 = refNormalize(title1);
  const n2 = refNormalize(title2);
  if (n1 === n2) return 1.0;
  if (n1.includes(n2) || n2.includes(n1)) return 0.85;
  const words1 = new Set(n1.split(/\s+/));
  const words2 = new Set(n2.split(/\s+/));
  const intersection = new Set([...words1].filter((w) => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  return intersection.size / union.size;
}

function refTagOverlap(tags1, tags2) {
  if (tags1.length === 0 && tags2.length === 0) return 0;
  const set1 = new Set(tags1);
  const set2 = new Set(tags2);
  const intersection = new Set([...set1].filter((t) => set2.has(t)));
  return intersection.size / Math.max(set1.size, set2.size);
}

function refGroupConfidence(tasks) {
  if (tasks.length < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      total += refTitleSimilarity(tasks[i].title, tasks[j].title);
      pairs++;
    }
  }
  return pairs > 0 ? total / pairs : 0;
}

// ---- port primitives: mirror of cleanup.rs normalization -------------------
function isJsWordChar(cp) {
  // ASCII [A-Za-z0-9_]
  return (
    (cp >= 48 && cp <= 57) || // 0-9
    (cp >= 65 && cp <= 90) || // A-Z
    (cp >= 97 && cp <= 122) || // a-z
    cp === 95 // _
  );
}

function isJsWhitespace(cp) {
  return (
    cp === 0x09 ||
    cp === 0x0a ||
    cp === 0x0b ||
    cp === 0x0c ||
    cp === 0x0d ||
    cp === 0x20 ||
    cp === 0xa0 ||
    cp === 0x1680 ||
    (cp >= 0x2000 && cp <= 0x200a) ||
    cp === 0x2028 ||
    cp === 0x2029 ||
    cp === 0x202f ||
    cp === 0x205f ||
    cp === 0x3000 ||
    cp === 0xfeff
  );
}

function trimJsWhitespace(s) {
  const chars = [...s];
  let start = 0;
  while (start < chars.length && isJsWhitespace(chars[start].codePointAt(0))) start++;
  let end = chars.length;
  while (end > start && isJsWhitespace(chars[end - 1].codePointAt(0))) end--;
  return chars.slice(start, end).join("");
}

function portNormalize(t) {
  const lowered = t.toLowerCase();
  let filtered = "";
  for (const ch of lowered) {
    const cp = ch.codePointAt(0);
    if (isJsWordChar(cp) || isJsWhitespace(cp)) filtered += ch;
  }
  return trimJsWhitespace(filtered);
}

// split of an already-trimmed normalized string; "" -> [""].
function splitWords(normalized) {
  if (normalized.length === 0) return [""];
  const out = [];
  let cur = "";
  for (const ch of normalized) {
    if (isJsWhitespace(ch.codePointAt(0))) {
      if (cur.length) {
        out.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

// split of an arbitrary (possibly untrimmed) string, mirroring JS split(/\s+/):
// leading ws -> single leading "", trailing ws -> single trailing "", "" -> [""].
function jsSplitWhitespace(s) {
  if (s.length === 0) return [""];
  const chars = [...s];
  const out = [];
  let cur = "";
  let idx = 0;
  if (idx < chars.length && isJsWhitespace(chars[idx].codePointAt(0))) {
    out.push("");
    while (idx < chars.length && isJsWhitespace(chars[idx].codePointAt(0))) idx++;
  }
  for (; idx < chars.length; idx++) {
    const ch = chars[idx];
    if (isJsWhitespace(ch.codePointAt(0))) {
      if (cur.length) {
        out.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur.length) {
    out.push(cur);
  } else if (isJsWhitespace(chars[chars.length - 1].codePointAt(0))) {
    out.push("");
  }
  return out;
}

function portTitleSimilarity(title1, title2) {
  const n1 = portNormalize(title1);
  const n2 = portNormalize(title2);
  if (n1 === n2) return 1.0;
  if (n1.includes(n2) || n2.includes(n1)) return 0.85;
  const words1 = new Set(splitWords(n1));
  const words2 = new Set(splitWords(n2));
  let inter = 0;
  const union = new Set([...words1, ...words2]);
  for (const w of words1) if (words2.has(w)) inter++;
  return inter / union.size;
}

function portTagOverlap(tags1, tags2) {
  if (tags1.length === 0 && tags2.length === 0) return 0;
  const set1 = new Set(tags1);
  const set2 = new Set(tags2);
  let inter = 0;
  for (const t of set1) if (set2.has(t)) inter++;
  return inter / Math.max(set1.size, set2.size);
}

function portGroupConfidence(tasks) {
  if (tasks.length < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      total += portTitleSimilarity(tasks[i].title, tasks[j].title);
      pairs++;
    }
  }
  return pairs > 0 ? total / pairs : 0;
}

// ===========================================================================
// Duplicate detection.
// ===========================================================================
function refDupes(allTasks, threshold) {
  const groups = [];
  const processed = new Set();
  for (let i = 0; i < allTasks.length; i++) {
    if (processed.has(allTasks[i].id)) continue;
    const group = [allTasks[i]];
    for (let j = i + 1; j < allTasks.length; j++) {
      if (processed.has(allTasks[j].id)) continue;
      const similarity = refTitleSimilarity(allTasks[i].title, allTasks[j].title);
      const tagOverlap = refTagOverlap(allTasks[i].tags, allTasks[j].tags);
      const combined = similarity * 0.7 + tagOverlap * 0.3;
      if (combined >= threshold) {
        group.push(allTasks[j]);
        processed.add(allTasks[j].id);
      }
    }
    if (group.length > 1) {
      groups.push({ taskIds: group.map((t) => t.id), confidence: refGroupConfidence(group) });
      processed.add(group[0].id);
    }
  }
  return groups;
}

function portDupes(allTasks, threshold) {
  const groups = [];
  const processed = new Set();
  for (let i = 0; i < allTasks.length; i++) {
    if (processed.has(allTasks[i].id)) continue;
    const group = [allTasks[i]];
    for (let j = i + 1; j < allTasks.length; j++) {
      if (processed.has(allTasks[j].id)) continue;
      const similarity = portTitleSimilarity(allTasks[i].title, allTasks[j].title);
      const tagOverlap = portTagOverlap(allTasks[i].tags, allTasks[j].tags);
      const combined = similarity * 0.7 + tagOverlap * 0.3;
      if (combined >= threshold) {
        group.push(allTasks[j]);
        processed.add(allTasks[j].id);
      }
    }
    if (group.length > 1) {
      groups.push({ taskIds: group.map((t) => t.id), confidence: portGroupConfidence(group) });
      processed.add(group[0].id);
    }
  }
  return groups;
}

// ===========================================================================
// Merge suggestion.
// ===========================================================================
function stableSortMerge(tasks, cmp) {
  // Array.prototype.sort is stable in modern V8; the Rust uses a stable sort
  // too. We emulate a stable sort explicitly so ordering is unambiguous.
  return tasks
    .map((t, i) => [t, i])
    .sort((a, b) => {
      const c = cmp(a[0], b[0]);
      return c !== 0 ? c : a[1] - b[1];
    })
    .map((pair) => pair[0]);
}

function mergeComparator(a, b) {
  const aHas = a.subtasks.length > 0 ? 1 : 0;
  const bHas = b.subtasks.length > 0 ? 1 : 0;
  if (aHas !== bHas) return bHas - aHas;
  const aAct = a.activity ? a.activity.length : 0;
  const bAct = b.activity ? b.activity.length : 0;
  return bAct - aAct;
}

function refMerge(groupTasks) {
  const sorted = stableSortMerge([...groupTasks], mergeComparator);
  const keepTask = sorted[0];
  const archiveTasks = sorted.slice(1);
  const allSubtasks = [
    ...keepTask.subtasks,
    ...archiveTasks.flatMap((t) =>
      t.subtasks.filter(
        (st) =>
          !keepTask.subtasks.some((kst) => kst.title.toLowerCase() === st.title.toLowerCase()),
      ),
    ),
  ];
  const allTags = Array.from(new Set([...keepTask.tags, ...archiveTasks.flatMap((t) => t.tags)]));
  const mergedSummary =
    keepTask.summary +
    "\n\n---\nMerged from duplicates:\n" +
    archiveTasks.map((t) => `- ${t.title}: ${t.summary}`).join("\n");
  return {
    keepTaskId: keepTask.id,
    archiveTaskIds: archiveTasks.map((t) => t.id),
    mergedFields: {
      subtasks: allSubtasks,
      tags: allTags,
      summary: mergedSummary,
      timeEstimate: Math.max(keepTask.timeEstimate, ...archiveTasks.map((t) => t.timeEstimate)),
      timeSpent: keepTask.timeSpent + archiveTasks.reduce((s, t) => s + t.timeSpent, 0),
    },
    reasoning: `Kept "${keepTask.title}" (most complete). Merged ${archiveTasks.length} duplicate(s).`,
  };
}

function portMerge(groupTasks) {
  const sorted = stableSortMerge([...groupTasks], mergeComparator);
  const keepTask = sorted[0];
  const archiveTasks = sorted.slice(1);

  const allSubtasks = keepTask.subtasks.map((s) => ({ ...s }));
  for (const t of archiveTasks) {
    for (const st of t.subtasks) {
      const stLower = st.title.toLowerCase();
      const dup = keepTask.subtasks.some((kst) => kst.title.toLowerCase() === stLower);
      if (!dup) allSubtasks.push({ ...st });
    }
  }

  const seen = new Set();
  const allTags = [];
  for (const tag of keepTask.tags) if (!seen.has(tag)) (seen.add(tag), allTags.push(tag));
  for (const t of archiveTasks)
    for (const tag of t.tags) if (!seen.has(tag)) (seen.add(tag), allTags.push(tag));

  const mergedFrom = archiveTasks.map((t) => `- ${t.title}: ${t.summary}`).join("\n");
  const mergedSummary = `${keepTask.summary}\n\n---\nMerged from duplicates:\n${mergedFrom}`;

  let timeEstimate = keepTask.timeEstimate;
  for (const t of archiveTasks) if (t.timeEstimate > timeEstimate) timeEstimate = t.timeEstimate;
  const timeSpent = keepTask.timeSpent + archiveTasks.reduce((acc, t) => acc + t.timeSpent, 0);

  return {
    keepTaskId: keepTask.id,
    archiveTaskIds: archiveTasks.map((t) => t.id),
    mergedFields: {
      subtasks: allSubtasks,
      tags: allTags,
      summary: mergedSummary,
      timeEstimate,
      timeSpent,
    },
    reasoning: `Kept "${keepTask.title}" (most complete). Merged ${archiveTasks.length} duplicate(s).`,
  };
}

// ===========================================================================
// Redundancy analysis (fully deterministic; `now` passed in).
// ===========================================================================
function refIsStale(task, now) {
  const daysSinceUpdate = task.updatedAt
    ? (now - task.updatedAt) / (1000 * 60 * 60 * 24)
    : (now - task.createdAt) / (1000 * 60 * 60 * 24);
  const isPastDue = task.dueDate ? task.dueDate < now : false;
  const isLowPriority = task.priority === "low";
  const noRecentActivity = daysSinceUpdate > 30;
  return isPastDue && isLowPriority && noRecentActivity;
}

function isTerminalTask(t) {
  return t.completedAt != null || t.status === "Completed" || t.status === "Commit";
}

function refRedundancy(allTasks, now) {
  const analyses = [];
  const completedTasks = allTasks.filter((t) => isTerminalTask(t));
  const activeTasks = allTasks.filter((t) => !isTerminalTask(t));
  for (const task of activeTasks) {
    for (const completed of completedTasks) {
      const similarity = refTitleSimilarity(task.title, completed.title);
      if (similarity > 0.7) {
        analyses.push({
          taskId: task.id,
          type: "completed-overlap",
          relatedTaskId: completed.id,
          confidence: similarity,
          reasoning: `Task "${task.title}" overlaps with completed task "${completed.title}" (${Math.round(similarity * 100)}% similar)`,
          suggestedAction: "archive",
        });
      }
    }
    const subtaskOf = activeTasks.find(
      (other) =>
        other.id !== task.id &&
        other.subtasks.some((st) => st.title.toLowerCase() === task.title.toLowerCase()),
    );
    if (subtaskOf) {
      analyses.push({
        taskId: task.id,
        type: "subset",
        relatedTaskId: subtaskOf.id,
        confidence: 0.9,
        reasoning: `Task "${task.title}" appears to be a subtask of "${subtaskOf.title}"`,
        suggestedAction: "convert-to-subtask",
      });
    }
    if (refIsStale(task, now)) {
      analyses.push({
        taskId: task.id,
        type: "stale",
        confidence: 0.8,
        reasoning: `Task "${task.title}" is stale: no recent activity, past due date, low priority`,
        suggestedAction: "archive",
      });
    }
    const blockedByCompleted =
      task.links &&
      task.links.some(
        (link) =>
          link.type === "blocked-by" && completedTasks.some((ct) => ct.id === link.targetTaskId),
      );
    if (blockedByCompleted) {
      analyses.push({
        taskId: task.id,
        type: "blocked-completed",
        confidence: 0.85,
        reasoning: `Task "${task.title}" was blocked by a task that is now completed`,
        suggestedAction: "update",
      });
    }
  }
  return analyses;
}

function portIsStale(task, now) {
  const daysSinceUpdate =
    task.updatedAt != null
      ? (now - task.updatedAt) / (1000 * 60 * 60 * 24)
      : (now - task.createdAt) / (1000 * 60 * 60 * 24);
  const isPastDue = task.dueDate != null ? task.dueDate < now : false;
  const isLowPriority = task.priority === "low";
  const noRecentActivity = daysSinceUpdate > 30;
  return isPastDue && isLowPriority && noRecentActivity;
}

function portRedundancy(allTasks, now) {
  const analyses = [];
  const completedTasks = allTasks.filter((t) => isTerminalTask(t));
  const activeTasks = allTasks.filter((t) => !isTerminalTask(t));
  for (const task of activeTasks) {
    for (const completed of completedTasks) {
      const similarity = portTitleSimilarity(task.title, completed.title);
      if (similarity > 0.7) {
        const pct = Math.round(similarity * 100);
        analyses.push({
          taskId: task.id,
          type: "completed-overlap",
          relatedTaskId: completed.id,
          confidence: similarity,
          reasoning: `Task "${task.title}" overlaps with completed task "${completed.title}" (${pct}% similar)`,
          suggestedAction: "archive",
        });
      }
    }
    const taskTitleLower = task.title.toLowerCase();
    const subtaskOf = activeTasks.find(
      (other) =>
        other.id !== task.id &&
        other.subtasks.some((st) => st.title.toLowerCase() === taskTitleLower),
    );
    if (subtaskOf) {
      analyses.push({
        taskId: task.id,
        type: "subset",
        relatedTaskId: subtaskOf.id,
        confidence: 0.9,
        reasoning: `Task "${task.title}" appears to be a subtask of "${subtaskOf.title}"`,
        suggestedAction: "convert-to-subtask",
      });
    }
    if (portIsStale(task, now)) {
      analyses.push({
        taskId: task.id,
        type: "stale",
        confidence: 0.8,
        reasoning: `Task "${task.title}" is stale: no recent activity, past due date, low priority`,
        suggestedAction: "archive",
      });
    }
    const blockedByCompleted =
      task.links != null &&
      task.links.some(
        (link) =>
          link.type === "blocked-by" && completedTasks.some((ct) => ct.id === link.targetTaskId),
      );
    if (blockedByCompleted) {
      analyses.push({
        taskId: task.id,
        type: "blocked-completed",
        confidence: 0.85,
        reasoning: `Task "${task.title}" was blocked by a task that is now completed`,
        suggestedAction: "update",
      });
    }
  }
  return analyses;
}

// ===========================================================================
// Categorization (`now` passed in — the original read Date.now() in priority).
// ===========================================================================
const TAG_PATTERNS = [
  "bug",
  "feature",
  "enhancement",
  "documentation",
  "testing",
  "design",
  "review",
  "research",
  "deployment",
  "refactor",
  "urgent",
  "backend",
  "frontend",
  "api",
  "database",
  "ui",
  "ux",
];

function refExtractTags(task) {
  const content = `${task.title} ${task.summary} ${task.tags.join(" ")}`.toLowerCase();
  return TAG_PATTERNS.filter((tag) => content.includes(tag));
}

function refSuggestPriority(task, now) {
  if (task.dueDate) {
    const daysUntilDue = (task.dueDate - now) / (1000 * 60 * 60 * 24);
    if (daysUntilDue < 2) return "high";
    if (daysUntilDue < 7) return "medium";
  }
  if (task.links && task.links.some((l) => l.type === "blocks")) return "high";
  return task.priority || "medium";
}

function refCategorize(allTasks, now) {
  return allTasks.map((task) => ({
    taskId: task.id,
    suggestedTags: refExtractTags(task),
    suggestedPriority: refSuggestPriority(task, now),
    confidence: 0.6,
    reasoning: "Heuristic categorization based on content analysis",
  }));
}

function portExtractTags(task) {
  const content = `${task.title} ${task.summary} ${task.tags.join(" ")}`.toLowerCase();
  return TAG_PATTERNS.filter((tag) => content.includes(tag));
}

function portSuggestPriority(task, now) {
  if (task.dueDate != null) {
    const daysUntilDue = (task.dueDate - now) / (1000 * 60 * 60 * 24);
    if (daysUntilDue < 2) return "high";
    if (daysUntilDue < 7) return "medium";
  }
  const hasBlocks = task.links != null && task.links.some((l) => l.type === "blocks");
  if (hasBlocks) return "high";
  return task.priority === "" || task.priority == null ? "medium" : task.priority;
}

function portCategorize(allTasks, now) {
  return allTasks.map((task) => ({
    taskId: task.id,
    suggestedTags: portExtractTags(task),
    suggestedPriority: portSuggestPriority(task, now),
    confidence: 0.6,
    reasoning: "Heuristic categorization based on content analysis",
  }));
}

// ===========================================================================
// Clustering (raw lowercased-title word overlap; no punctuation stripping).
// ===========================================================================
function refClusters(allTasks) {
  const clusters = [];
  const processed = new Set();
  for (const task of allTasks) {
    if (processed.has(task.id)) continue;
    const clusterTasks = [task.id];
    processed.add(task.id);
    const taskWords = new Set(task.title.toLowerCase().split(/\s+/));
    for (const other of allTasks) {
      if (processed.has(other.id)) continue;
      const otherWords = new Set(other.title.toLowerCase().split(/\s+/));
      const overlap = [...taskWords].filter((w) => otherWords.has(w)).length;
      if (overlap >= 2) {
        clusterTasks.push(other.id);
        processed.add(other.id);
      }
    }
    if (clusterTasks.length > 1) {
      const commonTags = new Set();
      clusterTasks.forEach((id) => {
        const t = allTasks.find((task) => task.id === id);
        if (t) t.tags.forEach((tag) => commonTags.add(tag));
      });
      clusters.push({
        taskIds: clusterTasks,
        theme: clusterTasks.map((id) => (allTasks.find((t) => t.id === id)?.title ?? "")).join(", "),
        suggestedTags: [...commonTags],
        confidence: 0.65,
      });
    }
  }
  return clusters;
}

function portClusters(allTasks) {
  const clusters = [];
  const processed = new Set();
  for (const task of allTasks) {
    if (processed.has(task.id)) continue;
    const clusterTaskIds = [task.id];
    processed.add(task.id);
    const taskWords = new Set(jsSplitWhitespace(task.title.toLowerCase()));
    for (const other of allTasks) {
      if (processed.has(other.id)) continue;
      const otherWords = new Set(jsSplitWhitespace(other.title.toLowerCase()));
      let overlap = 0;
      for (const w of taskWords) if (otherWords.has(w)) overlap++;
      if (overlap >= 2) {
        clusterTaskIds.push(other.id);
        processed.add(other.id);
      }
    }
    if (clusterTaskIds.length > 1) {
      const seen = new Set();
      const commonTags = [];
      for (const id of clusterTaskIds) {
        const t = allTasks.find((tt) => tt.id === id);
        if (t) for (const tag of t.tags) if (!seen.has(tag)) (seen.add(tag), commonTags.push(tag));
      }
      const theme = clusterTaskIds
        .map((id) => {
          const t = allTasks.find((tt) => tt.id === id);
          return t ? t.title : "";
        })
        .join(", ");
      clusters.push({ taskIds: clusterTaskIds, theme, suggestedTags: commonTags, confidence: 0.65 });
    }
  }
  return clusters;
}

// ===========================================================================
// Combined normalized objects.
// ===========================================================================
function reference(tasks, nowMs) {
  const firstTwo = tasks.slice(0, 2);
  return {
    dupes: refDupes(tasks, 0.5),
    redundancy: refRedundancy(tasks, nowMs),
    categorize: refCategorize(tasks, nowMs),
    clusters: refClusters(tasks),
    merge: firstTwo.length >= 2 ? refMerge(firstTwo) : null,
  };
}

function port(tasks, nowMs) {
  const firstTwo = tasks.slice(0, 2);
  return {
    dupes: portDupes(tasks, 0.5),
    redundancy: portRedundancy(tasks, nowMs),
    categorize: portCategorize(tasks, nowMs),
    clusters: portClusters(tasks),
    merge: firstTwo.length >= 2 ? portMerge(firstTwo) : null,
  };
}

// ===========================================================================
// Fuzz: random task lists with overlapping/duplicate titles, tags, subtasks,
// statuses, dates and blocked-by links. Titles are drawn from a small
// vocabulary so similarity heuristics actually fire. `nowMs` is fixed per case.
// ===========================================================================
const VOCAB = [
  "deploy",
  "api",
  "service",
  "gateway",
  "fix",
  "the",
  "bug",
  "feature",
  "testing",
  "database",
  "ui",
  "refactor",
  "urgent",
  "backend",
  "frontend",
  "review",
  "docs",
  "research",
];
// Occasionally inject punctuation / non-ASCII / whitespace oddities into titles
// to exercise the normalization edge cases.
const ODD = ["!!!", "café", "a\tb", "  ", "über-thing", "foo_bar", "", "UI/UX", "  lead"];

const TAG_POOL = ["backend", "frontend", "api", "ui", "ux", "bug", "urgent", "db", "misc"];
const STATUSES = ["Todo", "In Progress", "Completed", "Commit", "Blocked", "Pending"];
const PRIORITIES = ["low", "medium", "high", ""];

function randInt(rng, n) {
  return Math.floor(rng() * n);
}

function makeTitle(rng) {
  // Mostly vocabulary words (so overlaps trigger); sometimes an odd token.
  const nWords = 1 + randInt(rng, 4);
  const parts = [];
  for (let i = 0; i < nWords; i++) {
    if (rng() < 0.12) parts.push(ODD[randInt(rng, ODD.length)]);
    else parts.push(VOCAB[randInt(rng, VOCAB.length)]);
  }
  let title = parts.join(" ");
  // Rare fully-odd title to hit empty-normalize / substring branches.
  if (rng() < 0.05) title = ODD[randInt(rng, ODD.length)];
  return title;
}

function makeTags(rng) {
  const n = randInt(rng, 4);
  const tags = [];
  for (let i = 0; i < n; i++) tags.push(TAG_POOL[randInt(rng, TAG_POOL.length)]);
  return tags;
}

function makeSubtasks(rng, titlePool) {
  const n = randInt(rng, 3);
  const subs = [];
  for (let i = 0; i < n; i++) {
    // Sometimes a subtask title equals a task title (drives the "subset" path).
    const title =
      rng() < 0.5 && titlePool.length > 0
        ? titlePool[randInt(rng, titlePool.length)]
        : makeTitle(rng);
    subs.push({ id: `st${i}`, title, completed: rng() < 0.5 });
  }
  return subs;
}

function* fuzz(rng) {
  const BASE = 1_700_000_000_000;
  const DAY = 86_400_000;
  for (let caseIdx = 0; caseIdx < 6000; caseIdx++) {
    const n = 2 + randInt(rng, 6); // 2..7 tasks
    // Pre-generate titles so subtasks can reference real task titles.
    const titles = [];
    for (let i = 0; i < n; i++) titles.push(makeTitle(rng));

    const tasks = [];
    const ids = [];
    for (let i = 0; i < n; i++) {
      const id = `t${caseIdx}_${i}`;
      ids.push(id);
    }
    for (let i = 0; i < n; i++) {
      const hasUpdated = rng() < 0.7;
      const hasDue = rng() < 0.6;
      const status = STATUSES[randInt(rng, STATUSES.length)];
      const completedAt = rng() < 0.2 ? BASE - randInt(rng, 60) * DAY : undefined;
      // links: sometimes blocked-by an earlier task; sometimes a "blocks" link.
      const links = [];
      if (i > 0 && rng() < 0.4) {
        links.push({ targetTaskId: ids[randInt(rng, i)], type: "blocked-by" });
      }
      if (rng() < 0.2) {
        links.push({ targetTaskId: ids[randInt(rng, n)], type: "blocks" });
      }
      const activityLen = randInt(rng, 4);
      const activity = activityLen > 0 ? new Array(activityLen).fill(0).map((_, k) => ({ k })) : undefined;

      tasks.push({
        id: ids[i],
        title: titles[i],
        summary: rng() < 0.5 ? "needs testing and a bug fix" : "",
        priority: PRIORITIES[randInt(rng, PRIORITIES.length)],
        status,
        createdAt: BASE - randInt(rng, 90) * DAY,
        updatedAt: hasUpdated ? BASE - randInt(rng, 90) * DAY : undefined,
        dueDate: hasDue ? BASE + (randInt(rng, 120) - 90) * DAY : undefined,
        completedAt,
        subtasks: makeSubtasks(rng, titles),
        tags: makeTags(rng),
        timeEstimate: randInt(rng, 1000),
        timeSpent: randInt(rng, 500),
        links: links.length ? links : undefined,
        activity,
      });
    }

    // Fixed nowMs per case, spread around the base instant.
    const nowMs = BASE + (randInt(rng, 200) - 100) * DAY;
    yield { args: [tasks, nowMs], label: `case#${caseIdx} n=${n} now=${nowMs}` };
  }
}

module.exports = { name: "cleanup.heuristics", reference, port, fuzz };
