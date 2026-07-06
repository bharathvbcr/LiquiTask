//! Port of `src/services/timeReportingService.ts` pure logic.
//!
//! Only the deterministic aggregation, CSV/JSON serialization and productivity
//! math move to Rust. Storage, the command palette wiring, React and blob/file
//! download all stay in TS. The TS service calls `time_generate_report`,
//! `time_productivity_metrics`, `time_export_csv`, `time_export_json`.
//!
//! Boundary rule (see crate docs): every date crosses as **epoch millis**
//! (`i64`); the clock is never read here (`now_ms` is passed in). Grouping
//! `byDate` uses the UTC `yyyy-mm-dd` of `completedAt || createdAt`, which
//! matches the original `toISOString().split('T')[0]` when TZ=UTC.
//!
//! The TS groups `byProject` by the project *name*. We do not model `Project`
//! here; the bridge builds an `id -> name` map (`project_names`) from the
//! renderer's projects and passes it in. A missing id falls back to the raw
//! `projectId`, mirroring `projects?.find(...)?.name || task.projectId`.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::dateutil::Civil;
use crate::model::Task;

/// One aggregation bucket: `{ spent, estimate, count }`, mirroring the TS
/// `Map<string, { spent; estimate; count }>` value shape.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Bucket {
    pub spent: f64,
    pub estimate: f64,
    pub count: i64,
}

impl Bucket {
    fn zero() -> Bucket {
        Bucket {
            spent: 0.0,
            estimate: 0.0,
            count: 0,
        }
    }

    fn add(&mut self, spent: f64, estimate: f64) {
        self.spent += spent;
        self.estimate += estimate;
        self.count += 1;
    }
}

/// Per-task row of the report (`report.tasks[i]`), flattened to the fields the
/// TS export/metrics actually read. `task_id` is `task.id`, `job_id` is
/// `task.jobId`. `variance = time_spent - time_estimate`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskRow {
    pub task_id: String,
    pub job_id: String,
    pub title: String,
    pub time_spent: f64,
    pub time_estimate: f64,
    pub variance: f64,
}

/// Rust mirror of the TS `TimeReport`. The four `by*` fields serialize to JSON
/// objects (mirroring `Object.fromEntries(map)`); the TS bridge rebuilds the
/// `Map`s with `new Map(Object.entries(obj))`.
///
/// `group_by` is carried through untouched (the TS return has no such field,
/// but the option only affects which grouping a caller reads; all four groups
/// are always computed). We deliberately do NOT serialize it so the shape
/// matches the TS report exactly.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimeReport {
    pub total_time_spent: f64,
    pub total_time_estimate: f64,
    pub tasks: Vec<TaskRow>,
    pub by_project: HashMap<String, Bucket>,
    pub by_assignee: HashMap<String, Bucket>,
    pub by_date: HashMap<String, Bucket>,
    pub by_priority: HashMap<String, Bucket>,
}

/// Options for `generate_report`. `date_range` bounds are epoch millis; the
/// filter is inclusive on both ends (`>= start && <= end`), matching the TS
/// `Date` comparison. Empty/absent `project_ids`/`assignees` disable that
/// filter (mirrors the `&& length > 0` guards).
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TimeReportOptions {
    pub group_by: String,
    pub date_range: Option<DateRange>,
    pub project_ids: Option<Vec<String>>,
    pub assignees: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DateRange {
    pub start: i64,
    pub end: i64,
}

/// Productivity metrics computed from a report's task rows. All integer-valued
/// after rounding, mirroring the TS `Math.round` results.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProductivityMetrics {
    pub average_accuracy: f64,
    pub tasks_over_estimate: i64,
    pub tasks_under_estimate: i64,
    pub average_variance: f64,
}

/// JS `Math.round`: round-half toward +∞ (2.5 -> 3, -2.5 -> -2, -1.5 -> -1).
/// `(x + 0.5).floor()` reproduces this for the whole real line.
fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// The project's display name for grouping: `project_names[id]` or the raw id.
/// Mirrors `projects?.find((p) => p.id === task.projectId)?.name || task.projectId`.
/// Note the JS `|| id` also replaces an *empty-string* name with the id.
fn project_name<'a>(project_names: &'a HashMap<String, String>, project_id: &'a str) -> &'a str {
    match project_names.get(project_id) {
        Some(name) if !name.is_empty() => name.as_str(),
        _ => project_id,
    }
}

/// UTC `yyyy-mm-dd` for an instant, matching JS `new Date(ms).toISOString().split('T')[0]`
/// under TZ=UTC. Zero-padded like `toISOString`.
fn date_key(ms: i64) -> String {
    let c = Civil::from_millis(ms);
    format!("{:04}-{:02}-{:02}", c.year, c.month, c.day)
}

/// Port of `TimeReportingService.generateTimeReport`.
pub fn generate_report(
    tasks: &[Task],
    options: &TimeReportOptions,
    project_names: &HashMap<String, String>,
) -> TimeReport {
    // Filter by date range (inclusive), then projectIds, then assignees —
    // preserving the TS order so the resulting task set is identical.
    let mut filtered: Vec<&Task> = tasks.iter().collect();

    if let Some(range) = &options.date_range {
        filtered.retain(|t| {
            let task_date = t.completed_at.unwrap_or(t.created_at);
            task_date >= range.start && task_date <= range.end
        });
    }

    if let Some(ids) = &options.project_ids {
        if !ids.is_empty() {
            filtered.retain(|t| ids.iter().any(|id| id == &t.project_id));
        }
    }

    if let Some(assignees) = &options.assignees {
        if !assignees.is_empty() {
            filtered.retain(|t| assignees.iter().any(|a| a == &t.assignee));
        }
    }

    let mut total_time_spent = 0.0;
    let mut total_time_estimate = 0.0;

    let mut by_project: HashMap<String, Bucket> = HashMap::new();
    let mut by_assignee: HashMap<String, Bucket> = HashMap::new();
    let mut by_date: HashMap<String, Bucket> = HashMap::new();
    let mut by_priority: HashMap<String, Bucket> = HashMap::new();

    let mut task_rows: Vec<TaskRow> = Vec::with_capacity(filtered.len());

    for task in &filtered {
        // `task.timeSpent || 0` / `task.timeEstimate || 0`: the model already
        // defaults these to 0 (serde default) so the f64 is used directly.
        let spent = task.time_spent;
        let estimate = task.time_estimate;

        total_time_spent += spent;
        total_time_estimate += estimate;

        // byProject — keyed on project *name*.
        let pname = project_name(project_names, &task.project_id).to_string();
        by_project.entry(pname).or_insert_with(Bucket::zero).add(spent, estimate);

        // byAssignee — "" falls back to "Unassigned" (JS `|| "Unassigned"`).
        let assignee = if task.assignee.is_empty() {
            "Unassigned".to_string()
        } else {
            task.assignee.clone()
        };
        by_assignee.entry(assignee).or_insert_with(Bucket::zero).add(spent, estimate);

        // byDate — UTC yyyy-mm-dd of completedAt || createdAt.
        let key = date_key(task.completed_at.unwrap_or(task.created_at));
        by_date.entry(key).or_insert_with(Bucket::zero).add(spent, estimate);

        // byPriority — raw priority string (no fallback in TS).
        by_priority
            .entry(task.priority.clone())
            .or_insert_with(Bucket::zero)
            .add(spent, estimate);

        task_rows.push(TaskRow {
            task_id: task.id.clone(),
            job_id: task.job_id.clone(),
            title: task.title.clone(),
            time_spent: spent,
            time_estimate: estimate,
            variance: spent - estimate,
        });
    }

    TimeReport {
        total_time_spent,
        total_time_estimate,
        tasks: task_rows,
        by_project,
        by_assignee,
        by_date,
        by_priority,
    }
}

/// Port of `TimeReportingService.calculateProductivityMetrics`.
///
/// Operates purely on `report.tasks`. `averageAccuracy` and `averageVariance`
/// are `Math.round`ed; per-task accuracy is `max(0, round((1 - |var|/est)*100))`.
pub fn productivity_metrics(report: &TimeReport) -> ProductivityMetrics {
    let with_estimates: Vec<&TaskRow> = report
        .tasks
        .iter()
        .filter(|t| t.time_estimate > 0.0)
        .collect();

    if with_estimates.is_empty() {
        return ProductivityMetrics {
            average_accuracy: 0.0,
            tasks_over_estimate: 0,
            tasks_under_estimate: 0,
            average_variance: 0.0,
        };
    }

    let n = with_estimates.len() as f64;

    let accuracy_sum: f64 = with_estimates
        .iter()
        .map(|t| {
            let variance = t.variance.abs();
            js_round((1.0 - variance / t.time_estimate) * 100.0).max(0.0)
        })
        .sum();
    let average_accuracy = accuracy_sum / n;

    let tasks_over_estimate = with_estimates.iter().filter(|t| t.variance > 0.0).count() as i64;
    let tasks_under_estimate = with_estimates.iter().filter(|t| t.variance < 0.0).count() as i64;

    let variance_sum: f64 = with_estimates.iter().map(|t| t.variance).sum();
    let average_variance = variance_sum / n;

    ProductivityMetrics {
        average_accuracy: js_round(average_accuracy),
        tasks_over_estimate,
        tasks_under_estimate,
        average_variance: js_round(average_variance),
    }
}

/// Format an f64 the way JS `String(number)` / `Array.join` / `JSON.stringify`
/// do for the *finite integer or simple* values we produce here: no trailing
/// `.0` for integers, plain decimal otherwise. All CSV/JSON numbers in this
/// service are either integers (accuracy, counts) or sums/differences of the
/// input `timeSpent`/`timeEstimate`. For the exact JS-shortest-round-trip of
/// arbitrary floats we defer to Rust's `{}` which matches JS for integers and
/// the finite decimals the fuzzer generates (see oracle notes).
fn fmt_num(x: f64) -> String {
    if x == x.trunc() && x.is_finite() && x.abs() < 1e21 {
        // Integer value: render without a decimal point. `-0.0` -> "0".
        let i = x as i64;
        i.to_string()
    } else {
        // Non-integer: Rust's default float formatting is the shortest string
        // that round-trips, matching V8 for the decimals used here.
        format!("{}", x)
    }
}

/// Escape a CSV field exactly like the private `escapeCSV`: quote-wrap and
/// double interior quotes iff the value contains a comma, quote, or newline.
fn escape_csv(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

/// Port of `TimeReportingService.exportTimeDataToCSV`. Header + one row per
/// task (in input order). Accuracy uses `Math.round`; 0 when estimate <= 0.
pub fn export_csv(tasks: &[Task], project_names: &HashMap<String, String>) -> String {
    let header = "Task ID,Title,Project,Assignee,Time Estimate (min),Time Spent (min),Variance (min),Estimate Accuracy (%)";

    let mut lines: Vec<String> = Vec::with_capacity(tasks.len() + 1);
    lines.push(header.to_string());

    for task in tasks {
        let pname = project_name(project_names, &task.project_id);
        let estimate = task.time_estimate;
        let spent = task.time_spent;
        let variance = spent - estimate;
        let accuracy = if estimate > 0.0 {
            js_round((1.0 - variance.abs() / estimate) * 100.0)
        } else {
            0.0
        };
        let assignee = if task.assignee.is_empty() {
            "Unassigned"
        } else {
            task.assignee.as_str()
        };

        let row = [
            // The TS writes `task.jobId` RAW (only title/project/assignee are
            // escaped). Reproduce that exactly — jobIds are machine-generated and
            // never contain a comma/quote/newline, so this is observably identical.
            task.job_id.clone(),
            escape_csv(&task.title),
            escape_csv(pname),
            escape_csv(assignee),
            fmt_num(estimate),
            fmt_num(spent),
            fmt_num(variance),
            fmt_num(accuracy),
        ]
        .join(",");
        lines.push(row);
    }

    lines.join("\n")
}

/// UTC ISO-8601 string for an instant, matching JS `new Date(ms).toISOString()`
/// (`YYYY-MM-DDTHH:mm:ss.sssZ`, milliseconds always 3 digits).
fn iso_utc(ms: i64) -> String {
    let c = Civil::from_millis(ms);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        c.year, c.month, c.day, c.hour, c.minute, c.second, c.milli
    )
}

/// Port of `TimeReportingService.exportTimeDataToJSON`, producing the SAME
/// 2-space-pretty JSON text as `JSON.stringify(obj, null, 2)`.
///
/// We build the JSON by hand (rather than `serde_json::to_string_pretty`) so
/// numbers render JS-style (`90` not `90.0`) and key order matches the TS
/// object-literal insertion order, which `JSON.stringify` preserves. The four
/// `by*` maps preserve the *report's* insertion order in TS; here they come
/// from `HashMap`, so the bridge/oracle compares them order-independently
/// (see oracle normalization). For a byte-identical string we emit map entries
/// sorted by key — the oracle proves the normalized shapes match, and the TS
/// side reconstructs Maps from the object regardless of key order.
pub fn export_json(report: &TimeReport, now_ms: i64) -> String {
    fn esc(s: &str) -> String {
        // Minimal JSON string escaping (matches JSON.stringify for the chars
        // that appear in titles/ids/keys we handle).
        let mut out = String::with_capacity(s.len() + 2);
        out.push('"');
        for ch in s.chars() {
            match ch {
                '"' => out.push_str("\\\""),
                '\\' => out.push_str("\\\\"),
                // JSON.stringify emits the two-char short escapes for these,
                // not `\uXXXX`.
                '\u{08}' => out.push_str("\\b"),
                '\u{0c}' => out.push_str("\\f"),
                '\n' => out.push_str("\\n"),
                '\r' => out.push_str("\\r"),
                '\t' => out.push_str("\\t"),
                c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
                c => out.push(c),
            }
        }
        out.push('"');
        out
    }

    fn map_block(map: &HashMap<String, Bucket>, indent: &str) -> String {
        if map.is_empty() {
            return "{}".to_string();
        }
        let mut keys: Vec<&String> = map.keys().collect();
        keys.sort();
        let inner = format!("{}  ", indent);
        let entries: Vec<String> = keys
            .iter()
            .map(|k| {
                let b = &map[*k];
                format!(
                    "{ind}{key}: {{\n{ind2}\"spent\": {spent},\n{ind2}\"estimate\": {estimate},\n{ind2}\"count\": {count}\n{ind}}}",
                    ind = inner,
                    ind2 = format!("{}  ", inner),
                    key = esc(k),
                    spent = fmt_num(b.spent),
                    estimate = fmt_num(b.estimate),
                    count = b.count,
                )
            })
            .collect();
        format!("{{\n{}\n{}}}", entries.join(",\n"), indent)
    }

    let tasks_block = if report.tasks.is_empty() {
        "[]".to_string()
    } else {
        let entries: Vec<String> = report
            .tasks
            .iter()
            .map(|t| {
                format!(
                    "    {{\n      \"taskId\": {task_id},\n      \"jobId\": {job_id},\n      \"title\": {title},\n      \"timeSpent\": {spent},\n      \"timeEstimate\": {estimate},\n      \"variance\": {variance}\n    }}",
                    task_id = esc(&t.task_id),
                    job_id = esc(&t.job_id),
                    title = esc(&t.title),
                    spent = fmt_num(t.time_spent),
                    estimate = fmt_num(t.time_estimate),
                    variance = fmt_num(t.variance),
                )
            })
            .collect();
        format!("[\n{}\n  ]", entries.join(",\n"))
    };

    format!(
        "{{\n  \"generatedAt\": {generated},\n  \"totals\": {{\n    \"timeSpent\": {spent},\n    \"timeEstimate\": {estimate},\n    \"variance\": {variance}\n  }},\n  \"byProject\": {by_project},\n  \"byAssignee\": {by_assignee},\n  \"byDate\": {by_date},\n  \"byPriority\": {by_priority},\n  \"tasks\": {tasks}\n}}",
        generated = esc(&iso_utc(now_ms)),
        spent = fmt_num(report.total_time_spent),
        estimate = fmt_num(report.total_time_estimate),
        variance = fmt_num(report.total_time_spent - report.total_time_estimate),
        by_project = map_block(&report.by_project, "  "),
        by_assignee = map_block(&report.by_assignee, "  "),
        by_date = map_block(&report.by_date, "  "),
        by_priority = map_block(&report.by_priority, "  "),
        tasks = tasks_block,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(y: i64, mo: i64, d: i64) -> i64 {
        (Civil { year: y, month: mo, day: d, hour: 0, minute: 0, second: 0, milli: 0 }).to_millis()
    }

    fn task(id: &str, job: &str, proj: &str, assignee: &str, priority: &str, spent: f64, estimate: f64, created: i64, completed: Option<i64>) -> Task {
        Task {
            id: id.to_string(),
            job_id: job.to_string(),
            project_id: proj.to_string(),
            title: format!("title-{}", id),
            assignee: assignee.to_string(),
            priority: priority.to_string(),
            created_at: created,
            completed_at: completed,
            time_spent: spent,
            time_estimate: estimate,
            ..Default::default()
        }
    }

    fn names() -> HashMap<String, String> {
        let mut m = HashMap::new();
        m.insert("p1".to_string(), "Project 1".to_string());
        m.insert("p2".to_string(), "Project 2".to_string());
        m
    }

    fn sample_tasks() -> Vec<Task> {
        vec![
            task("1", "LT-101", "p1", "Alice", "high", 60.0, 45.0, ms(2024, 1, 1), Some(ms(2024, 1, 2))),
            task("2", "LT-102", "p1", "Bob", "medium", 30.0, 60.0, ms(2024, 1, 1), None),
            task("3", "LT-103", "p2", "Alice", "low", 120.0, 120.0, ms(2024, 1, 5), None),
        ]
    }

    fn opts(group_by: &str) -> TimeReportOptions {
        TimeReportOptions {
            group_by: group_by.to_string(),
            date_range: None,
            project_ids: None,
            assignees: None,
        }
    }

    #[test]
    fn totals_and_group_by_project_match_vitest() {
        let report = generate_report(&sample_tasks(), &opts("project"), &names());
        assert_eq!(report.total_time_spent, 210.0);
        assert_eq!(report.total_time_estimate, 225.0);
        assert_eq!(report.tasks.len(), 3);
        assert_eq!(report.by_project["Project 1"].spent, 90.0);
        assert_eq!(report.by_project["Project 2"].spent, 120.0);
        assert_eq!(report.by_assignee["Alice"].spent, 180.0);
        assert_eq!(report.by_assignee["Bob"].spent, 30.0);
    }

    #[test]
    fn date_range_filter_inclusive() {
        let mut o = opts("date");
        o.date_range = Some(DateRange { start: ms(2024, 1, 1), end: ms(2024, 1, 3) });
        let report = generate_report(&sample_tasks(), &o, &names());
        assert_eq!(report.tasks.len(), 2); // task 1 (completed Jan 2) + task 2 (created Jan 1)
    }

    #[test]
    fn project_and_assignee_filters() {
        let mut o = opts("project");
        o.project_ids = Some(vec!["p1".to_string()]);
        assert_eq!(generate_report(&sample_tasks(), &o, &names()).tasks.len(), 2);

        let mut o2 = opts("assignee");
        o2.assignees = Some(vec!["Bob".to_string()]);
        let r = generate_report(&sample_tasks(), &o2, &names());
        assert_eq!(r.tasks.len(), 1);
        assert_eq!(r.tasks[0].task_id, "2");
    }

    #[test]
    fn unassigned_and_unknown_project_fallback() {
        let t = task("4", "LT-1", "p3", "", "low", 0.0, 0.0, ms(2024, 1, 1), None);
        let report = generate_report(&[t], &opts("project"), &names());
        assert_eq!(report.total_time_spent, 0.0);
        assert!(report.by_assignee.contains_key("Unassigned"));
        assert!(report.by_project.contains_key("p3")); // no name -> raw id
    }

    #[test]
    fn productivity_metrics_match_vitest_signs() {
        let report = generate_report(&sample_tasks(), &opts("project"), &names());
        let m = productivity_metrics(&report);
        assert!(m.average_accuracy > 0.0);
        assert_eq!(m.tasks_over_estimate, 1); // task 1: 60 > 45
        assert_eq!(m.tasks_under_estimate, 1); // task 2: 30 < 60
    }

    #[test]
    fn productivity_metrics_empty_when_no_estimates() {
        let t = task("4", "LT-1", "p1", "A", "low", 10.0, 0.0, ms(2024, 1, 1), None);
        let report = generate_report(&[t], &opts("project"), &names());
        let m = productivity_metrics(&report);
        assert_eq!(m.average_accuracy, 0.0);
        assert_eq!(m.tasks_over_estimate, 0);
        assert_eq!(m.tasks_under_estimate, 0);
        assert_eq!(m.average_variance, 0.0);
    }

    #[test]
    fn csv_header_and_row_shape() {
        let csv = export_csv(&sample_tasks(), &names());
        assert!(csv.starts_with("Task ID,Title,Project,Assignee,Time Estimate (min),Time Spent (min),Variance (min),Estimate Accuracy (%)"));
        assert!(csv.contains("LT-101,title-1,Project 1,Alice,45,60,15,"));
    }

    #[test]
    fn csv_escapes_commas_and_quotes() {
        let mut t = task("1", "LT-1", "p1", "A,B", "low", 1.0, 2.0, ms(2024, 1, 1), None);
        t.title = "hi, \"there\"".to_string();
        let csv = export_csv(&[t], &names());
        // Title becomes "hi, ""there""" and assignee "A,B".
        assert!(csv.contains("\"hi, \"\"there\"\"\""));
        assert!(csv.contains("\"A,B\""));
    }

    #[test]
    fn csv_job_id_written_raw() {
        // jobId is the ONE column the TS does NOT escape. A comma-containing
        // jobId must appear raw (unquoted), splitting columns exactly like TS.
        let t = task("1", "LT,101", "p1", "Alice", "low", 10.0, 5.0, ms(2024, 1, 1), None);
        let csv = export_csv(&[t], &names());
        assert!(csv.contains("\nLT,101,title-1,Project 1,Alice,"));
        assert!(!csv.contains("\"LT,101\""));
    }

    #[test]
    fn json_escapes_backspace_and_formfeed_short_forms() {
        // JSON.stringify emits `\b` / `\f`, not `` / ``.
        let t = task("1", "LT-1", "p1", "a\u{08}b\u{0c}c", "low", 10.0, 5.0, ms(2024, 1, 1), None);
        let report = generate_report(&[t], &opts("project"), &names());
        let json = export_json(&report, ms(2024, 6, 1));
        assert!(json.contains("a\\bb\\fc"));
        assert!(!json.contains("\\u0008"));
        assert!(!json.contains("\\u000c"));
        // Still valid JSON.
        serde_json::from_str::<serde_json::Value>(&json).unwrap();
    }

    #[test]
    fn js_round_half_up() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(-1.5), -1.0);
        assert_eq!(js_round(0.5), 1.0);
    }

    #[test]
    fn json_is_pretty_and_parses_totals() {
        let report = generate_report(&sample_tasks(), &opts("project"), &names());
        let json = export_json(&report, ms(2024, 6, 1));
        assert!(json.contains("\"generatedAt\": \"2024-06-01T00:00:00.000Z\""));
        assert!(json.contains("\"timeSpent\": 210"));
        // Round-trips as valid JSON.
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["totals"]["timeSpent"], serde_json::json!(210));
        assert_eq!(parsed["totals"]["variance"], serde_json::json!(-15));
    }

    #[test]
    fn date_key_utc() {
        assert_eq!(date_key(ms(2024, 1, 2)), "2024-01-02");
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00.000Z");
    }
}
