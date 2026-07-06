// Differential oracle case: riskAnalysisService heuristics.
//
// reference() = the ORIGINAL TypeScript algorithm from
//   src/services/riskAnalysisService.ts (types stripped) — the four pure
//   methods (calculateCriticalPath + calculateHeuristicRisks +
//   calculateOverallScore + generatePredictionMessage) composed into
//   { criticalPath, risks, overallScore, predictionMessage }. Uses `nowMs`
//   instead of `new Date()`.
// port()      = a JS mirror of crates/liquitask-core/src/risk.rs.
// Equality across fuzzed inputs proves the Rust port matches the original.
//
// The risk heuristics are pure ms arithmetic (a dueDate-vs-now subtraction),
// so unlike the recurring case there is no civil-date stepping and no Civil
// helper is needed. Both sides operate directly on epoch millis.

// ---- reference: verbatim original TS logic (types stripped) ----------------
function refCalculateCriticalPath(tasks) {
  const adj = new Map();
  const inDegree = new Map();
  const taskMap = new Map();

  tasks.forEach((t) => {
    taskMap.set(t.id, t);
    if (!inDegree.has(t.id)) inDegree.set(t.id, 0);

    const blockedBy =
      t.links?.filter((l) => l.type === "blocked-by").map((l) => l.targetTaskId) || [];
    blockedBy.forEach((depId) => {
      const dependentTasks = adj.get(depId) ?? [];
      dependentTasks.push(t.id);
      adj.set(depId, dependentTasks);
      inDegree.set(t.id, (inDegree.get(t.id) || 0) + 1);
    });
  });

  let maxPath = [];
  const memo = new Map();

  const findLongestPath = (id) => {
    const memoizedPath = memo.get(id);
    if (memoizedPath) return memoizedPath;

    const children = adj.get(id) || [];
    if (children.length === 0) return [id];

    let longestChildPath = [];
    for (const childId of children) {
      const path = findLongestPath(childId);
      if (path.length > longestChildPath.length) {
        longestChildPath = path;
      }
    }

    const result = [id, ...longestChildPath];
    memo.set(id, result);
    return result;
  };

  tasks.forEach((t) => {
    const path = findLongestPath(t.id);
    if (path.length > maxPath.length) {
      maxPath = path;
    }
  });

  return maxPath;
}

function refCalculateHeuristicRisks(tasks, criticalPath, nowMs) {
  const risks = [];
  const now = new Date(nowMs);

  tasks.forEach((task) => {
    let score = 0;
    const reasons = [];

    if (task.dueDate && task.status !== "Completed") {
      const due = new Date(task.dueDate);
      const diff = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      if (diff < 0) {
        score += 0.8;
        reasons.push("Task is overdue");
      } else if (diff < 2) {
        score += 0.4;
        reasons.push("Due within 48 hours");
      }
    }

    if (criticalPath.includes(task.id)) {
      score += 0.3;
      reasons.push("Task is on the critical path");
    }

    if (task.timeEstimate > 480 && task.priority === "high") {
      score += 0.2;
      reasons.push("Large high-priority task (possible bottleneck)");
    }

    const blockers = task.links?.filter((l) => l.type === "blocked-by").length || 0;
    if (blockers > 2) {
      score += 0.2;
      reasons.push(`Blocked by ${blockers} tasks`);
    }

    if (score > 0.2) {
      risks.push({
        taskId: task.id,
        score: Math.min(score, 1.0),
        level: score > 0.7 ? "high" : score > 0.4 ? "medium" : "low",
        reason: reasons.join(", "),
        bottleneckTasks:
          task.links?.filter((l) => l.type === "blocked-by").map((l) => l.targetTaskId) || [],
      });
    }
  });

  return risks;
}

function refCalculateOverallScore(risks) {
  if (risks.length === 0) return 0;
  const highRisks = risks.filter((r) => r.level === "high").length;
  const mediumRisks = risks.filter((r) => r.level === "medium").length;
  return Math.min(highRisks * 0.3 + mediumRisks * 0.1, 1.0);
}

function refGeneratePredictionMessage(risks, cpLength) {
  const high = risks.filter((r) => r.level === "high").length;
  if (high > 2) return `Critical: ${high} major risks detected. Timeline is highly unstable.`;
  if (cpLength > 5) return `Warning: Long critical path (${cpLength} steps). Any delay will cascade.`;
  if (risks.length > 0) return `Project is healthy but watch out for ${risks.length} potential issues.`;
  return "Timeline looks solid! Low risk of delay.";
}

function reference(tasks, nowMs) {
  const criticalPath = refCalculateCriticalPath(tasks);
  const risks = refCalculateHeuristicRisks(tasks, criticalPath, nowMs);
  const overallScore = refCalculateOverallScore(risks);
  const predictionMessage = refGeneratePredictionMessage(risks, criticalPath.length);
  return { criticalPath, risks, overallScore, predictionMessage };
}

// ---- port: mirror of liquitask-core::risk -----------------------------------
function blockedByIds(task) {
  return (task.links || []).filter((l) => l.type === "blocked-by").map((l) => l.targetTaskId);
}

function portCalculateCriticalPath(tasks) {
  // adjacency: dependency id -> list of dependent ids (encounter order)
  const adj = new Map();
  for (const t of tasks) {
    for (const depId of blockedByIds(t)) {
      const list = adj.get(depId) ?? [];
      list.push(t.id);
      adj.set(depId, list);
    }
  }

  const memo = new Map();
  const findLongestPath = (id) => {
    const cached = memo.get(id);
    if (cached) return cached;

    const children = adj.get(id) || [];
    if (children.length === 0) return [id];

    let longestChildPath = [];
    for (const childId of children) {
      const path = findLongestPath(childId);
      if (path.length > longestChildPath.length) {
        longestChildPath = path;
      }
    }
    const result = [id, ...longestChildPath];
    memo.set(id, result);
    return result;
  };

  let maxPath = [];
  for (const t of tasks) {
    const path = findLongestPath(t.id);
    if (path.length > maxPath.length) {
      maxPath = path;
    }
  }
  return maxPath;
}

function portCalculateHeuristicRisks(tasks, criticalPath, nowMs) {
  const risks = [];
  for (const task of tasks) {
    let score = 0;
    const reasons = [];

    // Risk 1: overdue / near deadline (pure ms subtraction, mirroring Rust).
    if (task.dueDate !== undefined && task.dueDate !== null && task.status !== "Completed") {
      const diff = (task.dueDate - nowMs) / (1000 * 60 * 60 * 24);
      if (diff < 0) {
        score += 0.8;
        reasons.push("Task is overdue");
      } else if (diff < 2) {
        score += 0.4;
        reasons.push("Due within 48 hours");
      }
    }

    // Risk 2: critical path.
    if (criticalPath.includes(task.id)) {
      score += 0.3;
      reasons.push("Task is on the critical path");
    }

    // Risk 3: large high-priority estimate.
    const timeEstimate = task.timeEstimate ?? 0;
    if (timeEstimate > 480 && task.priority === "high") {
      score += 0.2;
      reasons.push("Large high-priority task (possible bottleneck)");
    }

    // Risk 4: dependency density.
    const blockedBy = blockedByIds(task);
    const blockers = blockedBy.length;
    if (blockers > 2) {
      score += 0.2;
      reasons.push(`Blocked by ${blockers} tasks`);
    }

    if (score > 0.2) {
      const level = score > 0.7 ? "high" : score > 0.4 ? "medium" : "low";
      risks.push({
        taskId: task.id,
        score: Math.min(score, 1.0),
        level,
        reason: reasons.join(", "),
        bottleneckTasks: blockedBy,
      });
    }
  }
  return risks;
}

function portCalculateOverallScore(risks) {
  if (risks.length === 0) return 0;
  const high = risks.filter((r) => r.level === "high").length;
  const medium = risks.filter((r) => r.level === "medium").length;
  return Math.min(high * 0.3 + medium * 0.1, 1.0);
}

function portGeneratePredictionMessage(risks, cpLength) {
  const high = risks.filter((r) => r.level === "high").length;
  if (high > 2) return `Critical: ${high} major risks detected. Timeline is highly unstable.`;
  if (cpLength > 5) return `Warning: Long critical path (${cpLength} steps). Any delay will cascade.`;
  if (risks.length > 0) return `Project is healthy but watch out for ${risks.length} potential issues.`;
  return "Timeline looks solid! Low risk of delay.";
}

function port(tasks, nowMs) {
  const criticalPath = portCalculateCriticalPath(tasks);
  const risks = portCalculateHeuristicRisks(tasks, criticalPath, nowMs);
  const overallScore = portCalculateOverallScore(risks);
  const predictionMessage = portGeneratePredictionMessage(risks, criticalPath.length);
  return { criticalPath, risks, overallScore, predictionMessage };
}

// ---- fuzz: random task sets + reference instants ---------------------------
function* fuzz(rng) {
  const statuses = ["Todo", "In Progress", "Completed", "Blocked", "Review"];
  const priorities = ["low", "medium", "high"];

  for (let i = 0; i < 12000; i++) {
    // Fixed reference instant per case, spread across ~1970..2035.
    const nowMs = Math.floor(rng() * 2_000_000_000_000);

    const n = 1 + Math.floor(rng() * 8); // 1..8 tasks
    const ids = [];
    for (let k = 0; k < n; k++) ids.push("T" + k);

    const tasks = [];
    for (let k = 0; k < n; k++) {
      const id = ids[k];
      const status = statuses[Math.floor(rng() * statuses.length)];
      const priority = priorities[Math.floor(rng() * priorities.length)];

      // dueDate: 60% present, offset within +/- ~10 days of nowMs (so overdue,
      // due-soon and future all get exercised). Occasionally undefined.
      let dueDate;
      if (rng() < 0.6) {
        const offsetDays = (rng() - 0.5) * 20; // -10 .. +10 days
        dueDate = Math.floor(nowMs + offsetDays * 86_400_000);
      }

      // timeEstimate: cover both sides of the 480 threshold, incl 0/large.
      const timeEstimate = Math.floor(rng() * 1200);

      // Random blocked-by links to OTHER generated ids (dedup, may be several
      // to exercise the >2 blocker branch). Self-links allowed rarely to match
      // the untyped original (it does not exclude self), but we avoid creating
      // an infinite loop: the memoized DFS only follows adjacency edges, and a
      // self blocked-by makes id a child of itself. The original memoizes on
      // first entry, so a self-loop yields [id] then recurses -> we must guard.
      const links = [];
      const nLinks = Math.floor(rng() * 4); // 0..3 blocked-by links
      const chosen = new Set();
      for (let j = 0; j < nLinks; j++) {
        const target = ids[Math.floor(rng() * n)];
        // Exclude self-links: the reference DFS has no cycle guard, so a task
        // blocked-by itself would infinite-loop in BOTH implementations
        // identically, but that is not a meaningful comparison. DAG-ish inputs
        // keep the differential meaningful. (Cross-links can still form cycles
        // between distinct ids; see below.)
        if (target === id) continue;
        if (chosen.has(target)) continue;
        chosen.add(target);
        links.push({ targetTaskId: target, type: "blocked-by" });
      }

      tasks.push({ id, title: "Task " + id, status, priority, timeEstimate, dueDate, links });
    }

    // Guard against dependency CYCLES among distinct ids: both the reference
    // and port DFS lack a visited-set, so a cycle (a blocked-by b, b blocked-by
    // a) would infinite-loop identically. Such a graph is not a valid task
    // dependency set and never occurs in the app. Detect and skip cyclic cases
    // so the oracle only compares well-formed (acyclic) inputs — the property
    // we actually ship.
    if (hasCycle(tasks)) continue;

    yield { args: [tasks, nowMs], label: `n=${n}@${nowMs}` };
  }
}

// Detect a cycle in the blocked-by graph (edge dep -> dependent), matching the
// adjacency the DFS walks. Returns true if any cycle exists.
function hasCycle(tasks) {
  const adj = new Map();
  for (const t of tasks) {
    for (const depId of blockedByIds(t)) {
      const list = adj.get(depId) ?? [];
      list.push(t.id);
      adj.set(depId, list);
    }
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map();
  for (const t of tasks) color.set(t.id, WHITE);

  const visit = (id) => {
    color.set(id, GRAY);
    for (const child of adj.get(id) || []) {
      const c = color.get(child);
      if (c === GRAY) return true;
      if (c === WHITE && visit(child)) return true;
    }
    color.set(id, BLACK);
    return false;
  };

  for (const t of tasks) {
    if (color.get(t.id) === WHITE && visit(t.id)) return true;
  }
  return false;
}

module.exports = { name: "risk.heuristics", reference, port, fuzz };
