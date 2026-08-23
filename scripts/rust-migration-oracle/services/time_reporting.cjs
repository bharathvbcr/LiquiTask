// Differential oracle case: timeReportingService (generate/metrics/csv/json)
//
// reference() = the ORIGINAL TypeScript algorithm from
//   src/services/timeReportingService.ts, types stripped, using JS `Date`
//   exactly as the service does (dates as real Date objects). Run under TZ=UTC
//   (see run.cjs) so `toISOString()`/date getters match the Rust UTC civil math.
// port()      = a JS mirror of crates/liquitask-core/src/time_reporting.rs,
//   working entirely in epoch-millis and the Civil helpers (mirror of
//   dateutil.rs), reproducing the same aggregation / rounding / string output.
//
// Both return a NORMALIZED plain object (Maps -> sorted-key objects, Task rows
// keyed/sorted by taskId, plus the CSV + JSON strings and productivity metrics)
// so run.cjs's stableStringify can compare them structurally. Equality across
// thousands of fuzzed inputs proves the Rust port is behaviour-preserving.

const { Civil } = require("../lib/civil.cjs");

// ---------------------------------------------------------------------------
// Shared input shape:
//   case args = [tasksMs, options, projectNames, nowMs]
//     tasksMs      : Task[] but with createdAt/completedAt as epoch MILLIS
//     options      : { groupBy, dateRange?{start,end} (ms), projectIds?, assignees? }
//     projectNames : { [projectId]: name }
//     nowMs        : fixed instant for generatedAt / clock-free determinism
// ---------------------------------------------------------------------------

// ===========================================================================
// reference: verbatim original TS logic (types stripped), Date-based.
// tasksMs are converted to Date-bearing tasks first, mirroring how the real
// service receives Task objects whose date fields are Date instances.
// ===========================================================================
function refToDateTasks(tasksMs) {
  return tasksMs.map((t) => ({
    ...t,
    createdAt: new Date(t.createdAt),
    completedAt: t.completedAt === undefined || t.completedAt === null ? undefined : new Date(t.completedAt),
  }));
}
function refProjects(projectNames) {
  return Object.keys(projectNames).map((id) => ({ id, name: projectNames[id] }));
}
function refDateRange(options) {
  if (!options.dateRange) return undefined;
  return { start: new Date(options.dateRange.start), end: new Date(options.dateRange.end) };
}

function ref_generateTimeReport(tasks, options, projects) {
  let filteredTasks = tasks;
  if (options.dateRange) {
    const { start, end } = options.dateRange;
    filteredTasks = tasks.filter((task) => {
      const taskDate = task.completedAt || task.createdAt;
      return taskDate >= start && taskDate <= end;
    });
  }
  if (options.projectIds && options.projectIds.length > 0) {
    const { projectIds } = options;
    filteredTasks = filteredTasks.filter((t) => projectIds.includes(t.projectId));
  }
  if (options.assignees && options.assignees.length > 0) {
    const { assignees } = options;
    filteredTasks = filteredTasks.filter((t) => assignees.includes(t.assignee));
  }

  const totalTimeSpent = filteredTasks.reduce((sum, t) => sum + (t.timeSpent || 0), 0);
  const totalTimeEstimate = filteredTasks.reduce((sum, t) => sum + (t.timeEstimate || 0), 0);

  const byProject = new Map();
  const byAssignee = new Map();
  const byDate = new Map();
  const byPriority = new Map();

  filteredTasks.forEach((task) => {
    const projectName = projects?.find((p) => p.id === task.projectId)?.name || task.projectId;
    const projectData = byProject.get(projectName) || { spent: 0, estimate: 0, count: 0 };
    projectData.spent += task.timeSpent || 0;
    projectData.estimate += task.timeEstimate || 0;
    projectData.count += 1;
    byProject.set(projectName, projectData);

    const assignee = task.assignee || "Unassigned";
    const assigneeData = byAssignee.get(assignee) || { spent: 0, estimate: 0, count: 0 };
    assigneeData.spent += task.timeSpent || 0;
    assigneeData.estimate += task.timeEstimate || 0;
    assigneeData.count += 1;
    byAssignee.set(assignee, assigneeData);

    const dateKey = (task.completedAt || task.createdAt).toISOString().split("T")[0];
    const dateData = byDate.get(dateKey) || { spent: 0, estimate: 0, count: 0 };
    dateData.spent += task.timeSpent || 0;
    dateData.estimate += task.timeEstimate || 0;
    dateData.count += 1;
    byDate.set(dateKey, dateData);

    const priorityData = byPriority.get(task.priority) || { spent: 0, estimate: 0, count: 0 };
    priorityData.spent += task.timeSpent || 0;
    priorityData.estimate += task.timeEstimate || 0;
    priorityData.count += 1;
    byPriority.set(task.priority, priorityData);
  });

  const taskData = filteredTasks.map((task) => ({
    task,
    timeSpent: task.timeSpent || 0,
    timeEstimate: task.timeEstimate || 0,
    variance: (task.timeSpent || 0) - (task.timeEstimate || 0),
  }));

  return { totalTimeSpent, totalTimeEstimate, tasks: taskData, byProject, byAssignee, byDate, byPriority };
}

function ref_escapeCSV(value) {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function ref_exportTimeDataToCSV(tasks, projects) {
  const header =
    "Task ID,Title,Project,Assignee,Time Estimate (min),Time Spent (min),Variance (min),Estimate Accuracy (%)";
  const rows = tasks.map((task) => {
    const projectName = projects?.find((p) => p.id === task.projectId)?.name || task.projectId;
    const estimate = task.timeEstimate || 0;
    const spent = task.timeSpent || 0;
    const variance = spent - estimate;
    const accuracy = estimate > 0 ? Math.round((1 - Math.abs(variance) / estimate) * 100) : 0;
    return [
      task.jobId,
      ref_escapeCSV(task.title),
      ref_escapeCSV(projectName),
      ref_escapeCSV(task.assignee || "Unassigned"),
      estimate,
      spent,
      variance,
      accuracy,
    ].join(",");
  });
  return [header, ...rows].join("\n");
}

function ref_exportTimeDataToJSON(report, nowMs) {
  return JSON.stringify(
    {
      // Original uses `new Date().toISOString()`; the differential requires a
      // fixed instant, so we thread nowMs through (semantically identical).
      generatedAt: new Date(nowMs).toISOString(),
      totals: {
        timeSpent: report.totalTimeSpent,
        timeEstimate: report.totalTimeEstimate,
        variance: report.totalTimeSpent - report.totalTimeEstimate,
      },
      byProject: Object.fromEntries(report.byProject),
      byAssignee: Object.fromEntries(report.byAssignee),
      byDate: Object.fromEntries(report.byDate),
      byPriority: Object.fromEntries(report.byPriority),
      tasks: report.tasks.map((t) => ({
        taskId: t.task.id,
        jobId: t.task.jobId,
        title: t.task.title,
        timeSpent: t.timeSpent,
        timeEstimate: t.timeEstimate,
        variance: t.variance,
      })),
    },
    null,
    2,
  );
}

function ref_calculateProductivityMetrics(report) {
  const tasksWithEstimates = report.tasks.filter((t) => t.timeEstimate > 0);
  if (tasksWithEstimates.length === 0) {
    return { averageAccuracy: 0, tasksOverEstimate: 0, tasksUnderEstimate: 0, averageVariance: 0 };
  }
  const accuracies = tasksWithEstimates.map((t) => {
    const variance = Math.abs(t.variance);
    return Math.max(0, Math.round((1 - variance / t.timeEstimate) * 100));
  });
  const averageAccuracy = accuracies.reduce((sum, a) => sum + a, 0) / accuracies.length;
  const tasksOverEstimate = tasksWithEstimates.filter((t) => t.variance > 0).length;
  const tasksUnderEstimate = tasksWithEstimates.filter((t) => t.variance < 0).length;
  const averageVariance =
    tasksWithEstimates.reduce((sum, t) => sum + t.variance, 0) / tasksWithEstimates.length;
  return {
    averageAccuracy: Math.round(averageAccuracy),
    tasksOverEstimate,
    tasksUnderEstimate,
    averageVariance: Math.round(averageVariance),
  };
}

function reference(tasksMs, options, projectNames, nowMs) {
  const tasks = refToDateTasks(tasksMs);
  const projects = refProjects(projectNames);
  const opts = { ...options, dateRange: refDateRange(options) };
  const report = ref_generateTimeReport(tasks, opts, projects);
  const metrics = ref_calculateProductivityMetrics(report);
  const csv = ref_exportTimeDataToCSV(tasks, projects);
  const json = ref_exportTimeDataToJSON(report, nowMs);
  return normalizeReport(report, metrics, csv, json);
}

// ===========================================================================
// port: mirror of liquitask-core::time_reporting, epoch-millis + Civil only.
// ===========================================================================

// JS `Math.round` == round-half-toward-+inf == floor(x + 0.5); mirrors the
// Rust `js_round` = (x + 0.5).floor().
function jsRound(x) {
  return Math.floor(x + 0.5);
}

function projectName(projectNames, projectId) {
  const n = projectNames[projectId];
  return n !== undefined && n !== "" ? n : projectId;
}

function dateKeyMs(ms) {
  const c = Civil.fromMillis(ms);
  return (
    String(c.year).padStart(4, "0") +
    "-" +
    String(c.month).padStart(2, "0") +
    "-" +
    String(c.day).padStart(2, "0")
  );
}

function isoUtc(ms) {
  const c = Civil.fromMillis(ms);
  return (
    String(c.year).padStart(4, "0") +
    "-" +
    String(c.month).padStart(2, "0") +
    "-" +
    String(c.day).padStart(2, "0") +
    "T" +
    String(c.hour).padStart(2, "0") +
    ":" +
    String(c.minute).padStart(2, "0") +
    ":" +
    String(c.second).padStart(2, "0") +
    "." +
    String(c.milli).padStart(3, "0") +
    "Z"
  );
}

// Mirror of Rust fmt_num: integers without trailing ".0" (String(number)),
// otherwise JS shortest round-trip (matches Rust {} for the finite decimals we
// generate). In JS this is simply String(x) after normalizing -0 to 0.
function fmtNum(x) {
  const v = x === 0 ? 0 : x; // collapse -0 -> 0
  return String(v);
}

function port_generateReport(tasksMs, options, projectNames) {
  let filtered = tasksMs;
  if (options.dateRange) {
    const { start, end } = options.dateRange;
    filtered = filtered.filter((t) => {
      const taskDate = t.completedAt === undefined || t.completedAt === null ? t.createdAt : t.completedAt;
      return taskDate >= start && taskDate <= end;
    });
  }
  if (options.projectIds && options.projectIds.length > 0) {
    filtered = filtered.filter((t) => options.projectIds.includes(t.projectId));
  }
  if (options.assignees && options.assignees.length > 0) {
    filtered = filtered.filter((t) => options.assignees.includes(t.assignee));
  }

  let totalTimeSpent = 0;
  let totalTimeEstimate = 0;
  const byProject = {};
  const byAssignee = {};
  const byDate = {};
  const byPriority = {};

  const add = (map, key, spent, estimate) => {
    const b = map[key] || { spent: 0, estimate: 0, count: 0 };
    b.spent += spent;
    b.estimate += estimate;
    b.count += 1;
    map[key] = b;
  };

  const rows = [];
  for (const t of filtered) {
    const spent = t.timeSpent || 0;
    const estimate = t.timeEstimate || 0;
    totalTimeSpent += spent;
    totalTimeEstimate += estimate;

    add(byProject, projectName(projectNames, t.projectId), spent, estimate);
    add(byAssignee, t.assignee ? t.assignee : "Unassigned", spent, estimate);
    const completed = t.completedAt === undefined || t.completedAt === null ? t.createdAt : t.completedAt;
    add(byDate, dateKeyMs(completed), spent, estimate);
    add(byPriority, t.priority, spent, estimate);

    rows.push({
      taskId: t.id,
      jobId: t.jobId,
      title: t.title,
      timeSpent: spent,
      timeEstimate: estimate,
      variance: spent - estimate,
    });
  }

  return {
    totalTimeSpent,
    totalTimeEstimate,
    tasks: rows,
    byProject,
    byAssignee,
    byDate,
    byPriority,
  };
}

function port_productivityMetrics(report) {
  const withEst = report.tasks.filter((t) => t.timeEstimate > 0);
  if (withEst.length === 0) {
    return { averageAccuracy: 0, tasksOverEstimate: 0, tasksUnderEstimate: 0, averageVariance: 0 };
  }
  const n = withEst.length;
  const accSum = withEst.reduce((s, t) => {
    const variance = Math.abs(t.variance);
    return s + Math.max(0, jsRound((1 - variance / t.timeEstimate) * 100));
  }, 0);
  const averageAccuracy = accSum / n;
  const tasksOverEstimate = withEst.filter((t) => t.variance > 0).length;
  const tasksUnderEstimate = withEst.filter((t) => t.variance < 0).length;
  const averageVariance = withEst.reduce((s, t) => s + t.variance, 0) / n;
  return {
    averageAccuracy: jsRound(averageAccuracy),
    tasksOverEstimate,
    tasksUnderEstimate,
    averageVariance: jsRound(averageVariance),
  };
}

function port_escapeCSV(value) {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function port_exportCSV(tasksMs, projectNames) {
  const header =
    "Task ID,Title,Project,Assignee,Time Estimate (min),Time Spent (min),Variance (min),Estimate Accuracy (%)";
  const lines = [header];
  for (const t of tasksMs) {
    const pname = projectName(projectNames, t.projectId);
    const estimate = t.timeEstimate || 0;
    const spent = t.timeSpent || 0;
    const variance = spent - estimate;
    const accuracy = estimate > 0 ? jsRound((1 - Math.abs(variance) / estimate) * 100) : 0;
    const assignee = t.assignee ? t.assignee : "Unassigned";
    lines.push(
      [
        // Corrected Rust writes jobId RAW (only the other columns are escaped).
        t.jobId,
        port_escapeCSV(t.title),
        port_escapeCSV(pname),
        port_escapeCSV(assignee),
        fmtNum(estimate),
        fmtNum(spent),
        fmtNum(variance),
        fmtNum(accuracy),
      ].join(","),
    );
  }
  return lines.join("\n");
}

// Mirror of Rust export_json: hand-built 2-space-pretty JSON with map entries
// emitted sorted-by-key and JS-style numbers. Must byte-match the reference's
// JSON.stringify(obj, null, 2) once the reference maps are compared through the
// same normalization (the oracle compares normalized objects that INCLUDE the
// json string; to make that string deterministic across Map insertion order we
// sort keys on BOTH sides — see normalizeJsonString).
function port_exportJSON(report, nowMs) {
  const esc = (s) => JSON.stringify(String(s));
  const mapBlock = (map, indent) => {
    const keys = Object.keys(map).sort();
    if (keys.length === 0) return "{}";
    const inner = `${indent}  `;
    const inner2 = `${inner}  `;
    const entries = keys.map((k) => {
      const b = map[k];
      return (
        inner +
        esc(k) +
        ": {\n" +
        inner2 +
        '"spent": ' +
        fmtNum(b.spent) +
        ",\n" +
        inner2 +
        '"estimate": ' +
        fmtNum(b.estimate) +
        ",\n" +
        inner2 +
        '"count": ' +
        b.count +
        "\n" +
        inner +
        "}"
      );
    });
    return `{\n${entries.join(",\n")}\n${indent}}`;
  };

  let tasksBlock;
  if (report.tasks.length === 0) {
    tasksBlock = "[]";
  } else {
    const entries = report.tasks.map(
      (t) =>
        "    {\n" +
        '      "taskId": ' +
        esc(t.taskId) +
        ",\n" +
        '      "jobId": ' +
        esc(t.jobId) +
        ",\n" +
        '      "title": ' +
        esc(t.title) +
        ",\n" +
        '      "timeSpent": ' +
        fmtNum(t.timeSpent) +
        ",\n" +
        '      "timeEstimate": ' +
        fmtNum(t.timeEstimate) +
        ",\n" +
        '      "variance": ' +
        fmtNum(t.variance) +
        "\n    }",
    );
    tasksBlock = `[\n${entries.join(",\n")}\n  ]`;
  }

  return (
    "{\n" +
    '  "generatedAt": ' +
    esc(isoUtc(nowMs)) +
    ",\n" +
    '  "totals": {\n' +
    '    "timeSpent": ' +
    fmtNum(report.totalTimeSpent) +
    ",\n" +
    '    "timeEstimate": ' +
    fmtNum(report.totalTimeEstimate) +
    ",\n" +
    '    "variance": ' +
    fmtNum(report.totalTimeSpent - report.totalTimeEstimate) +
    "\n  },\n" +
    '  "byProject": ' +
    mapBlock(report.byProject, "  ") +
    ",\n" +
    '  "byAssignee": ' +
    mapBlock(report.byAssignee, "  ") +
    ",\n" +
    '  "byDate": ' +
    mapBlock(report.byDate, "  ") +
    ",\n" +
    '  "byPriority": ' +
    mapBlock(report.byPriority, "  ") +
    ",\n" +
    '  "tasks": ' +
    tasksBlock +
    "\n}"
  );
}

function port(tasksMs, options, projectNames, nowMs) {
  const report = port_generateReport(tasksMs, options, projectNames);
  const metrics = port_productivityMetrics(report);
  const csv = port_exportCSV(tasksMs, projectNames);
  const json = port_exportJSON(report, nowMs);
  // The port's report is already plain-object shaped; adapt to the common
  // normalized form used by reference.
  return normalizePortReport(report, metrics, csv, json);
}

// ===========================================================================
// Normalization — collapse both sides to a comparable plain object.
//   - totals, productivity metrics
//   - four group maps as sorted-key plain {spent,estimate,count} objects
//   - task rows sorted by taskId (order-independent, taskIds are unique here)
//   - csv string as-is
//   - json string re-parsed and re-serialized with sorted keys, so Map
//     insertion-order differences between reference & port do NOT cause
//     spurious mismatches while still verifying the full JSON payload/values.
// ===========================================================================
function mapToSortedObj(mapLike) {
  // mapLike is either a JS Map (reference) or a plain object (port).
  const obj = {};
  const entries = mapLike instanceof Map ? [...mapLike.entries()] : Object.entries(mapLike);
  for (const [k, v] of entries) {
    obj[k] = { spent: v.spent, estimate: v.estimate, count: v.count };
  }
  // Key order is normalized by run.cjs's stableStringify; return as-is.
  return obj;
}

function sortRows(rows) {
  return [...rows].sort((a, b) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0));
}

// Re-serialize a JSON string with recursively sorted keys so byProject/byDate
// etc. compare order-independently. Preserves all values and array order.
function normalizeJsonString(jsonStr) {
  const parsed = JSON.parse(jsonStr);
  const sortKeys = (v) => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sortKeys(parsed));
}

function normalizeReport(report, metrics, csv, json) {
  return {
    totals: {
      timeSpent: report.totalTimeSpent,
      timeEstimate: report.totalTimeEstimate,
      variance: report.totalTimeSpent - report.totalTimeEstimate,
    },
    metrics,
    byProject: mapToSortedObj(report.byProject),
    byAssignee: mapToSortedObj(report.byAssignee),
    byDate: mapToSortedObj(report.byDate),
    byPriority: mapToSortedObj(report.byPriority),
    rows: sortRows(
      report.tasks.map((t) => ({
        taskId: t.task.id,
        jobId: t.task.jobId,
        title: t.task.title,
        timeSpent: t.timeSpent,
        timeEstimate: t.timeEstimate,
        variance: t.variance,
      })),
    ),
    csv,
    json: normalizeJsonString(json),
  };
}

function normalizePortReport(report, metrics, csv, json) {
  return {
    totals: {
      timeSpent: report.totalTimeSpent,
      timeEstimate: report.totalTimeEstimate,
      variance: report.totalTimeSpent - report.totalTimeEstimate,
    },
    metrics,
    byProject: mapToSortedObj(report.byProject),
    byAssignee: mapToSortedObj(report.byAssignee),
    byDate: mapToSortedObj(report.byDate),
    byPriority: mapToSortedObj(report.byPriority),
    rows: sortRows(report.tasks),
    csv,
    json: normalizeJsonString(json),
  };
}

// ===========================================================================
// fuzz: random tasks + options + projectNames, fixed nowMs per case.
// ===========================================================================
function* fuzz(rng) {
  const PROJECT_IDS = ["p1", "p2", "p3", "px"]; // "px" intentionally has no name
  const PROJECT_NAMES_POOL = { p1: "Project 1", p2: "Project 2", p3: "Data & Ops, Inc" };
  const ASSIGNEES = ["Alice", "Bob", "Carol", ""]; // "" -> Unassigned
  const PRIORITIES = ["low", "medium", "high", "urgent"];
  const GROUP_BYS = ["project", "assignee", "date", "priority"];
  // A few titles that exercise CSV escaping (comma, quote, newline) + unicode.
  const TITLES = [
    "Simple task",
    "Has, comma",
    'Has "quote"',
    "Line1\nLine2",
    'Mix, "all"\nthings',
    "Ünïçødé ✓",
    "",
  ];
  const BASE = Date.UTC(2024, 0, 1); // fixed base instant

  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  // time values including 0 and non-integers (halves stress Math.round-half-up).
  const timeVal = () => {
    const r = rng();
    if (r < 0.15) return 0;
    if (r < 0.35) return Math.floor(rng() * 240); // whole minutes
    // include .5 fractions to exercise half-up rounding in accuracy
    return Math.floor(rng() * 480) + (rng() < 0.5 ? 0.5 : 0);
  };
  const dayOffsetMs = () => Math.floor((rng() - 0.3) * 400) * 86_400_000; // ~ -120..+280 days

  for (let i = 0; i < 6000; i++) {
    const nTasks = Math.floor(rng() * 7); // 0..6 (include empty task set)
    const tasks = [];
    for (let j = 0; j < nTasks; j++) {
      const createdAt = BASE + dayOffsetMs() + Math.floor(rng() * 86_400_000);
      const hasCompleted = rng() < 0.6;
      const completedAt = hasCompleted
        ? createdAt + Math.floor(rng() * 30) * 86_400_000 + Math.floor(rng() * 86_400_000)
        : undefined;
      tasks.push({
        id: `t${i}_${j}`, // unique across the case
        // Occasionally a jobId with a comma/quote to prove it is written RAW in
        // CSV (unescaped, like the TS) rather than quote-wrapped.
        jobId: rng() < 0.1 ? `LT,"${100 + j}` : `LT-${100 + j}`,
        projectId: pick(PROJECT_IDS),
        title: pick(TITLES),
        assignee: pick(ASSIGNEES),
        priority: pick(PRIORITIES),
        timeSpent: timeVal(),
        timeEstimate: timeVal(),
        createdAt,
        completedAt,
      });
    }

    // Build a projectNames map from the pool (sometimes omit some ids so the
    // `|| projectId` fallback fires; "px" is never present).
    const projectNames = {};
    for (const id of Object.keys(PROJECT_NAMES_POOL)) {
      if (rng() < 0.85) projectNames[id] = PROJECT_NAMES_POOL[id];
    }

    const options = { groupBy: pick(GROUP_BYS) };
    if (rng() < 0.4) {
      // dateRange window around the base; ordered start <= end.
      const a = BASE + dayOffsetMs();
      const b = a + Math.floor(rng() * 120) * 86_400_000;
      options.dateRange = { start: a, end: b };
    }
    if (rng() < 0.35) {
      // random non-empty subset of project ids
      const subset = PROJECT_IDS.filter(() => rng() < 0.5);
      options.projectIds = subset.length ? subset : [pick(PROJECT_IDS)];
    }
    if (rng() < 0.35) {
      const subset = ASSIGNEES.filter(() => rng() < 0.5);
      options.assignees = subset.length ? subset : [pick(ASSIGNEES)];
    }

    const nowMs = BASE + Math.floor(rng() * 365) * 86_400_000 + Math.floor(rng() * 86_400_000);

    yield {
      args: [tasks, options, projectNames, nowMs],
      label:
        "n=" + nTasks + " groupBy=" + options.groupBy +
        (options.dateRange ? " range" : "") +
        (options.projectIds ? " pIds" : "") +
        (options.assignees ? " assg" : "") +
        " @" + nowMs,
    };
  }
}

module.exports = { name: "time.report", reference, port, fuzz };
