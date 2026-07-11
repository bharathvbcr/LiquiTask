//! Port of `src/services/taskCleanupService.ts` pure heuristic logic.
//!
//! Only the deterministic heuristics move to Rust: title/tag similarity, the
//! heuristic duplicate detection, the merge suggestion, the redundancy analysis,
//! the heuristic categorization and the heuristic clustering. Every `aiService`
//! call and every `storageService` read STAYS in the TypeScript service — this
//! crate never touches AI, storage, the network or a clock.
//!
//! Time rule (see `model` / `dateutil`): the reference clock (`new Date()` /
//! `Date.now()` in the original) crosses in as `now_ms` (epoch millis). We NEVER
//! read a clock here. Task date fields are already epoch millis on the DTO.
//!
//! Determinism rule: the original assembles result ids with `Date.now()` +
//! `Math.random()`. Those non-deterministic id expressions STAY in TypeScript.
//! The functions here return only the deterministic structural data (task-id
//! groupings, confidences, reasoning strings, suggested actions, merged fields);
//! the TS wrapper then assembles the final typed objects and generates the ids
//! exactly as the original did.
//!
//! String semantics: `calculateTitleSimilarity` mirrors the JS
//! `normalize`/`split(/\s+/)`/Set-Jaccard pipeline *exactly*, including the
//! JS regex classes (`\w` == ASCII `[A-Za-z0-9_]`, `\s` == the JS whitespace
//! set) and the edge case where an empty normalized string splits to `[""]`
//! (a one-element set, NOT an empty set).

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::model::{Subtask, Task};

// ---------------------------------------------------------------------------
// String normalization mirroring the JS regexes.
// ---------------------------------------------------------------------------

/// JS `\w` character class: ASCII `[A-Za-z0-9_]`.
fn is_js_word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// JS `\s` character class (the set matched by `\s` in a JS RegExp). Covers the
/// ASCII whitespace plus the Unicode space separators JS recognizes.
fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{0009}' // tab
            | '\u{000A}' // line feed
            | '\u{000B}' // vertical tab
            | '\u{000C}' // form feed
            | '\u{000D}' // carriage return
            | '\u{0020}' // space
            | '\u{00A0}' // no-break space
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}' // line separator
            | '\u{2029}' // paragraph separator
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}' // BOM / zero-width no-break space
    )
}

/// Mirror the JS `normalize`:
/// `t.toLowerCase().replace(/[^\w\s]/g, "").trim()`.
///
/// The replace drops every char that is neither a JS word char nor JS
/// whitespace (leaving whitespace runs intact, NOT collapsed), then `trim()`
/// removes leading/trailing whitespace. `to_lowercase` matches JS lowercasing
/// for the ASCII letters that survive the filter (all surviving letters are
/// ASCII, so the two lowercasings agree).
fn normalize_title(t: &str) -> String {
    let lowered = t.to_lowercase();
    let filtered: String = lowered
        .chars()
        .filter(|&c| is_js_word_char(c) || is_js_whitespace(c))
        .collect();
    // JS String.prototype.trim() strips the same whitespace set as `\s`.
    trim_js_whitespace(&filtered)
}

/// JS `String.prototype.trim()` — strips leading/trailing JS whitespace.
fn trim_js_whitespace(s: &str) -> String {
    let start = s
        .char_indices()
        .find(|&(_, c)| !is_js_whitespace(c))
        .map(|(i, _)| i)
        .unwrap_or(s.len());
    let end = s
        .char_indices()
        .rev()
        .find(|&(_, c)| !is_js_whitespace(c))
        .map(|(i, c)| i + c.len_utf8())
        .unwrap_or(start);
    s[start..end].to_string()
}

/// Mirror JS `s.split(/\s+/)` for a string that has already been trimmed.
///
/// For a non-empty trimmed string this yields the whitespace-delimited words
/// with no empty tokens. For the empty string JS returns `[""]` (a single empty
/// token), so the resulting word *set* is `{""}` — we reproduce that exactly,
/// because the Jaccard union/intersection depend on it.
fn split_words(normalized: &str) -> Vec<String> {
    if normalized.is_empty() {
        // JS: "".split(/\s+/) === [""].
        return vec![String::new()];
    }
    // Trimmed + non-empty: no leading/trailing ws, so no empty tokens are
    // produced. `split_whitespace`-style splitting on JS-whitespace runs.
    let mut words: Vec<String> = Vec::new();
    let mut cur = String::new();
    for c in normalized.chars() {
        if is_js_whitespace(c) {
            if !cur.is_empty() {
                words.push(std::mem::take(&mut cur));
            }
        } else {
            cur.push(c);
        }
    }
    if !cur.is_empty() {
        words.push(cur);
    }
    words
}

// ---------------------------------------------------------------------------
// Similarity primitives.
// ---------------------------------------------------------------------------

/// Faithful port of `TaskCleanupService.calculateTitleSimilarity`.
///
/// equal -> 1.0; substring (either direction) -> 0.85; else Jaccard over the
/// whitespace-split word *sets* of the normalized titles.
pub fn calculate_title_similarity(title1: &str, title2: &str) -> f64 {
    let n1 = normalize_title(title1);
    let n2 = normalize_title(title2);

    if n1 == n2 {
        return 1.0;
    }
    // JS `String.includes` — substring test on the normalized strings.
    if n1.contains(&n2) || n2.contains(&n1) {
        return 0.85;
    }

    // `new Set(nX.split(/\s+/))` — dedup words into sets.
    let words1: BTreeSet<String> = split_words(&n1).into_iter().collect();
    let words2: BTreeSet<String> = split_words(&n2).into_iter().collect();

    let intersection = words1.intersection(&words2).count();
    let union = words1.union(&words2).count();

    // `union` is always >= 1 here (each set has >= 1 element), so no div-by-zero.
    intersection as f64 / union as f64
}

/// Faithful port of `TaskCleanupService.calculateTagOverlap`.
pub fn calculate_tag_overlap(tags1: &[String], tags2: &[String]) -> f64 {
    if tags1.is_empty() && tags2.is_empty() {
        return 0.0;
    }
    let set1: BTreeSet<&String> = tags1.iter().collect();
    let set2: BTreeSet<&String> = tags2.iter().collect();
    let intersection = set1.intersection(&set2).count();
    let max = set1.len().max(set2.len());
    // At least one set is non-empty (the both-empty case returned above), so
    // `max >= 1`.
    intersection as f64 / max as f64
}

/// Faithful port of `TaskCleanupService.calculateGroupConfidence` — the mean
/// pairwise title similarity over all unordered pairs in the group.
pub fn calculate_group_confidence(tasks: &[&Task]) -> f64 {
    if tasks.len() < 2 {
        return 0.0;
    }
    let mut total_similarity = 0.0;
    let mut pairs = 0u64;
    for i in 0..tasks.len() {
        for j in (i + 1)..tasks.len() {
            total_similarity += calculate_title_similarity(&tasks[i].title, &tasks[j].title);
            pairs += 1;
        }
    }
    if pairs > 0 {
        total_similarity / pairs as f64
    } else {
        0.0
    }
}

// ---------------------------------------------------------------------------
// Duplicate detection.
// ---------------------------------------------------------------------------

/// A deterministic duplicate group: the task ids in the group plus the group
/// confidence. The TS wrapper adds the random `id` and the fixed `reasons`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub task_ids: Vec<String>,
    pub confidence: f64,
}

/// Faithful port of `TaskCleanupService.heuristicDuplicateDetection`.
///
/// Reproduces the exact greedy pairing, the `processed` bookkeeping (including
/// the subtle re-add of `group[0]` after a group forms), the encounter order of
/// members, and the combined score `similarity * 0.7 + tagOverlap * 0.3`.
pub fn heuristic_duplicate_detection(all_tasks: &[Task], threshold: f64) -> Vec<DuplicateGroup> {
    let mut groups: Vec<DuplicateGroup> = Vec::new();
    let mut processed: BTreeSet<String> = BTreeSet::new();

    for i in 0..all_tasks.len() {
        if processed.contains(&all_tasks[i].id) {
            continue;
        }

        // Group members as references, in encounter order (seed = task i).
        let mut group: Vec<&Task> = vec![&all_tasks[i]];

        for j in (i + 1)..all_tasks.len() {
            if processed.contains(&all_tasks[j].id) {
                continue;
            }

            let similarity =
                calculate_title_similarity(&all_tasks[i].title, &all_tasks[j].title);
            let tag_overlap = calculate_tag_overlap(&all_tasks[i].tags, &all_tasks[j].tags);
            let combined_score = similarity * 0.7 + tag_overlap * 0.3;

            if combined_score >= threshold {
                group.push(&all_tasks[j]);
                processed.insert(all_tasks[j].id.clone());
            }
        }

        if group.len() > 1 {
            let confidence = calculate_group_confidence(&group);
            groups.push(DuplicateGroup {
                task_ids: group.iter().map(|t| t.id.clone()).collect(),
                confidence,
            });
            // Mirror the original's `processed.add(group[0].id)`.
            processed.insert(group[0].id.clone());
        }
    }

    groups
}

// ---------------------------------------------------------------------------
// Merge suggestion.
// ---------------------------------------------------------------------------

/// The deterministic subset of the TS `MergeSuggestion.mergedFields` that the
/// heuristic computes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MergedFields {
    pub subtasks: Vec<Subtask>,
    pub tags: Vec<String>,
    pub summary: String,
    pub time_estimate: f64,
    pub time_spent: f64,
}

/// Faithful port of `TaskCleanupService.heuristicMergeSuggestion`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MergeSuggestion {
    pub keep_task_id: String,
    pub archive_task_ids: Vec<String>,
    pub merged_fields: MergedFields,
    pub reasoning: String,
}

/// Faithful port of `TaskCleanupService.heuristicMergeSuggestion`.
///
/// The original sorts a copy of the group's tasks by: subtasks-present (desc),
/// then activity length (desc). `Array.prototype.sort` is stable in modern V8,
/// so ties keep their original relative order — we replicate that with a
/// **stable** sort so the chosen keep-task and archive order match JS exactly.
pub fn heuristic_merge_suggestion(group_tasks: &[Task]) -> Result<MergeSuggestion, String> {
    if group_tasks.is_empty() {
        return Err("merge group must contain at least one task".to_string());
    }

    // Stable sort by the same comparator the TS uses.
    let mut sorted: Vec<&Task> = group_tasks.iter().collect();
    sorted.sort_by(|a, b| {
        let a_has_sub = if !a.subtasks.is_empty() { 1i64 } else { 0 };
        let b_has_sub = if !b.subtasks.is_empty() { 1i64 } else { 0 };
        if a_has_sub != b_has_sub {
            // `return bHasSubtasks - aHasSubtasks` -> descending has-subtasks.
            return b_has_sub.cmp(&a_has_sub);
        }
        let a_act = a.activity_len() as i64;
        let b_act = b.activity_len() as i64;
        // `return bHasActivity - aHasActivity` -> descending activity length.
        b_act.cmp(&a_act)
    });

    let keep_task = sorted[0];
    let archive_tasks: Vec<&Task> = sorted[1..].to_vec();

    // allSubtasks = keep.subtasks ++ (archive subtasks whose lowercased title is
    // not already present, case-insensitively, in keep.subtasks).
    let mut all_subtasks: Vec<Subtask> = keep_task.subtasks.clone();
    for t in &archive_tasks {
        for st in &t.subtasks {
            let st_lower = st.title.to_lowercase();
            let dup = keep_task
                .subtasks
                .iter()
                .any(|kst| kst.title.to_lowercase() == st_lower);
            if !dup {
                all_subtasks.push(st.clone());
            }
        }
    }

    // allTags = Array.from(new Set([...keep.tags, ...archive.flatMap(t=>t.tags)]))
    // — JS Set preserves first-insertion order, so we dedup while keeping order.
    let mut seen_tags: BTreeSet<String> = BTreeSet::new();
    let mut all_tags: Vec<String> = Vec::new();
    for tag in &keep_task.tags {
        if seen_tags.insert(tag.clone()) {
            all_tags.push(tag.clone());
        }
    }
    for t in &archive_tasks {
        for tag in &t.tags {
            if seen_tags.insert(tag.clone()) {
                all_tags.push(tag.clone());
            }
        }
    }

    // mergedSummary = keep.summary + "\n\n---\nMerged from duplicates:\n" +
    //   archive.map(t => `- ${t.title}: ${t.summary}`).join("\n")
    let merged_from = archive_tasks
        .iter()
        .map(|t| format!("- {}: {}", t.title, t.summary))
        .collect::<Vec<_>>()
        .join("\n");
    let merged_summary = format!(
        "{}\n\n---\nMerged from duplicates:\n{}",
        keep_task.summary, merged_from
    );

    // timeEstimate = Math.max(keep.timeEstimate, ...archive.map(t=>t.timeEstimate))
    let mut time_estimate = keep_task.time_estimate;
    for t in &archive_tasks {
        if t.time_estimate > time_estimate {
            time_estimate = t.time_estimate;
        }
    }

    // timeSpent = keep.timeSpent + archive.reduce((s,t)=>s+t.timeSpent, 0)
    let time_spent = keep_task.time_spent
        + archive_tasks
            .iter()
            .fold(0.0, |acc, t| acc + t.time_spent);

    let reasoning = format!(
        "Kept \"{}\" (most complete). Merged {} duplicate(s).",
        keep_task.title,
        archive_tasks.len()
    );

    Ok(MergeSuggestion {
        keep_task_id: keep_task.id.clone(),
        archive_task_ids: archive_tasks.iter().map(|t| t.id.clone()).collect(),
        merged_fields: MergedFields {
            subtasks: all_subtasks,
            tags: all_tags,
            summary: merged_summary,
            time_estimate,
            time_spent,
        },
        reasoning,
    })
}

// ---------------------------------------------------------------------------
// Redundancy analysis.
// ---------------------------------------------------------------------------

/// Faithful port of the TS `RedundancyAnalysis` interface (deterministic — the
/// whole analysis has no AI and no random ids).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RedundancyAnalysis {
    pub task_id: String,
    /// "subset" | "completed-overlap" | "stale" | "blocked-completed"
    #[serde(rename = "type")]
    pub analysis_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub related_task_id: Option<String>,
    pub confidence: f64,
    pub reasoning: String,
    /// "archive" | "convert-to-subtask" | "update" | "delete"
    pub suggested_action: String,
}

/// Faithful port of `TaskCleanupService.isTaskStale`.
///
/// `now_ms` replaces the original `now` (`new Date()`). Uses `updatedAt` when
/// present, else `createdAt`, for the "days since update" measure.
fn is_task_stale(task: &Task, now_ms: i64) -> bool {
    let days_since_update = match task.updated_at {
        Some(updated) => {
            (now_ms as f64 - updated as f64) / (1000.0 * 60.0 * 60.0 * 24.0)
        }
        None => (now_ms as f64 - task.created_at as f64) / (1000.0 * 60.0 * 60.0 * 24.0),
    };

    let is_past_due = match task.due_date {
        Some(due) => (due as f64) < (now_ms as f64),
        None => false,
    };
    let is_low_priority = task.priority == "low";
    let no_recent_activity = days_since_update > 30.0;

    is_past_due && is_low_priority && no_recent_activity
}

/// Faithful port of `TaskCleanupService.analyzeRedundancy` (no AI — the whole
/// method is deterministic). `now_ms` replaces the original `new Date()`.
pub fn analyze_redundancy(all_tasks: &[Task], now_ms: i64) -> Vec<RedundancyAnalysis> {
    let mut analyses: Vec<RedundancyAnalysis> = Vec::new();

    // Terminal tasks: Completed (review) or Commit (merged), or completedAt set.
    let completed_tasks: Vec<&Task> = all_tasks
        .iter()
        .filter(|t| t.is_terminal())
        .collect();
    let active_tasks: Vec<&Task> = all_tasks
        .iter()
        .filter(|t| !t.is_terminal())
        .collect();

    for task in &active_tasks {
        // 1) Completed-overlap: title similarity > 0.7 against any completed.
        for completed in &completed_tasks {
            let similarity = calculate_title_similarity(&task.title, &completed.title);
            if similarity > 0.7 {
                let pct = (similarity * 100.0).round() as i64;
                analyses.push(RedundancyAnalysis {
                    task_id: task.id.clone(),
                    analysis_type: "completed-overlap".to_string(),
                    related_task_id: Some(completed.id.clone()),
                    confidence: similarity,
                    reasoning: format!(
                        "Task \"{}\" overlaps with completed task \"{}\" ({}% similar)",
                        task.title, completed.title, pct
                    ),
                    suggested_action: "archive".to_string(),
                });
            }
        }

        // 2) Subset: some OTHER active task has a subtask whose lowercased title
        //    equals this task's lowercased title. `find` -> first match.
        let task_title_lower = task.title.to_lowercase();
        let subtask_of = active_tasks.iter().find(|other| {
            other.id != task.id
                && other
                    .subtasks
                    .iter()
                    .any(|st| st.title.to_lowercase() == task_title_lower)
        });

        if let Some(other) = subtask_of {
            analyses.push(RedundancyAnalysis {
                task_id: task.id.clone(),
                analysis_type: "subset".to_string(),
                related_task_id: Some(other.id.clone()),
                confidence: 0.9,
                reasoning: format!(
                    "Task \"{}\" appears to be a subtask of \"{}\"",
                    task.title, other.title
                ),
                suggested_action: "convert-to-subtask".to_string(),
            });
        }

        // 3) Stale.
        if is_task_stale(task, now_ms) {
            analyses.push(RedundancyAnalysis {
                task_id: task.id.clone(),
                analysis_type: "stale".to_string(),
                related_task_id: None,
                confidence: 0.8,
                reasoning: format!(
                    "Task \"{}\" is stale: no recent activity, past due date, low priority",
                    task.title
                ),
                suggested_action: "archive".to_string(),
            });
        }

        // 4) Blocked-by a now-completed task.
        let blocked_by_completed = task.links.as_ref().is_some_and(|links| {
            links.iter().any(|link| {
                link.link_type == "blocked-by"
                    && completed_tasks
                        .iter()
                        .any(|ct| ct.id == link.target_task_id)
            })
        });

        if blocked_by_completed {
            analyses.push(RedundancyAnalysis {
                task_id: task.id.clone(),
                analysis_type: "blocked-completed".to_string(),
                related_task_id: None,
                confidence: 0.85,
                reasoning: format!(
                    "Task \"{}\" was blocked by a task that is now completed",
                    task.title
                ),
                suggested_action: "update".to_string(),
            });
        }
    }

    analyses
}

// ---------------------------------------------------------------------------
// Categorization.
// ---------------------------------------------------------------------------

/// Faithful port of the deterministic subset of the TS `AICategorySuggestion`
/// that the heuristic produces. The TS wrapper leaves `suggestedProjectId`
/// unset (the heuristic never sets it).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CategorySuggestion {
    pub task_id: String,
    pub suggested_tags: Vec<String>,
    pub suggested_priority: String,
    pub confidence: f64,
    pub reasoning: String,
}

/// The fixed tag vocabulary from `extractTagsFromContent`, in the original order
/// (the `filter` preserves this order).
const TAG_PATTERNS: [&str; 17] = [
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

/// Faithful port of `TaskCleanupService.extractTagsFromContent`.
///
/// `content = `${title} ${summary} ${tags.join(" ")}`.toLowerCase()`, then keep
/// each vocabulary tag whose text is a substring of `content` (JS
/// `String.includes`), preserving vocabulary order.
fn extract_tags_from_content(task: &Task) -> Vec<String> {
    let content = format!(
        "{} {} {}",
        task.title,
        task.summary,
        task.tags.join(" ")
    )
    .to_lowercase();

    TAG_PATTERNS
        .iter()
        .filter(|&&tag| content.contains(tag))
        .map(|&tag| tag.to_string())
        .collect()
}

/// Faithful port of `TaskCleanupService.suggestPriority`.
///
/// `now_ms` replaces the original `Date.now()` used in the due-date math.
fn suggest_priority(task: &Task, now_ms: i64) -> String {
    if let Some(due) = task.due_date {
        let days_until_due = (due as f64 - now_ms as f64) / (1000.0 * 60.0 * 60.0 * 24.0);
        if days_until_due < 2.0 {
            return "high".to_string();
        }
        if days_until_due < 7.0 {
            return "medium".to_string();
        }
    }

    // `task.links?.some((l) => l.type === "blocks")`.
    let has_blocks = task
        .links
        .as_ref()
        .is_some_and(|links| links.iter().any(|l| l.link_type == "blocks"));
    if has_blocks {
        return "high".to_string();
    }

    // `task.priority || "medium"` — JS falsy (empty string) falls back.
    if task.priority.is_empty() {
        "medium".to_string()
    } else {
        task.priority.clone()
    }
}

/// Faithful port of `TaskCleanupService.heuristicCategorization`.
///
/// `now_ms` threads through to `suggest_priority` (the original read `Date.now()`
/// there). Confidence and reasoning are the fixed constants from the original.
pub fn heuristic_categorization(all_tasks: &[Task], now_ms: i64) -> Vec<CategorySuggestion> {
    all_tasks
        .iter()
        .map(|task| CategorySuggestion {
            task_id: task.id.clone(),
            suggested_tags: extract_tags_from_content(task),
            suggested_priority: suggest_priority(task, now_ms),
            confidence: 0.6,
            reasoning: "Heuristic categorization based on content analysis".to_string(),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Clustering.
// ---------------------------------------------------------------------------

/// Deterministic cluster: the task ids, the joined-title theme and common tags.
/// The TS wrapper adds the random `id`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskCluster {
    pub task_ids: Vec<String>,
    pub theme: String,
    pub suggested_tags: Vec<String>,
    pub confidence: f64,
}

/// Faithful port of `TaskCleanupService.heuristicClustering`.
///
/// Greedy word-overlap clustering: seed with each unprocessed task, then absorb
/// any later unprocessed task sharing >= 2 lowercased title words. Word sets are
/// built with `title.toLowerCase().split(/\s+/)` — note this is the RAW
/// lowercased title (no punctuation stripping, unlike title similarity).
pub fn heuristic_clustering(all_tasks: &[Task]) -> Vec<TaskCluster> {
    let mut clusters: Vec<TaskCluster> = Vec::new();
    let mut processed: BTreeSet<String> = BTreeSet::new();

    for task in all_tasks {
        if processed.contains(&task.id) {
            continue;
        }

        let mut cluster_task_ids: Vec<String> = vec![task.id.clone()];
        processed.insert(task.id.clone());

        // `new Set(task.title.toLowerCase().split(/\s+/))` — raw lowercased
        // title, split on whitespace runs (no normalize/regex-strip here).
        let task_words: BTreeSet<String> = raw_word_set(&task.title);

        for other in all_tasks {
            if processed.contains(&other.id) {
                continue;
            }
            let other_words: BTreeSet<String> = raw_word_set(&other.title);
            let overlap = task_words.intersection(&other_words).count();

            if overlap >= 2 {
                cluster_task_ids.push(other.id.clone());
                processed.insert(other.id.clone());
            }
        }

        if cluster_task_ids.len() > 1 {
            // commonTags: union of tags of every clustered task, in the order
            // the TS `Set` first sees them (iterate ids in cluster order, then
            // each task's tags in order).
            let mut seen: BTreeSet<String> = BTreeSet::new();
            let mut common_tags: Vec<String> = Vec::new();
            for id in &cluster_task_ids {
                if let Some(t) = all_tasks.iter().find(|t| &t.id == id) {
                    for tag in &t.tags {
                        if seen.insert(tag.clone()) {
                            common_tags.push(tag.clone());
                        }
                    }
                }
            }

            // theme = clusterTaskIds.map(id => task.title ?? "").join(", ").
            let theme = cluster_task_ids
                .iter()
                .map(|id| {
                    all_tasks
                        .iter()
                        .find(|t| &t.id == id)
                        .map(|t| t.title.clone())
                        .unwrap_or_default()
                })
                .collect::<Vec<_>>()
                .join(", ");

            clusters.push(TaskCluster {
                task_ids: cluster_task_ids,
                theme,
                suggested_tags: common_tags,
                confidence: 0.65,
            });
        }
    }

    clusters
}

/// `new Set(title.toLowerCase().split(/\s+/))` — the RAW clustering word set.
/// Unlike `normalize_title`, this does NOT strip punctuation; it only lowercases
/// and splits on JS whitespace. The empty-string edge case (`"".split(/\s+/)`
/// -> `[""]`) applies here too, so an empty/whitespace-only title yields `{""}`.
fn raw_word_set(title: &str) -> BTreeSet<String> {
    let lowered = title.to_lowercase();
    // JS split(/\s+/) on a NON-trimmed string can yield leading/trailing empty
    // tokens; mirror that precisely so overlap counts match JS.
    js_split_whitespace(&lowered).into_iter().collect()
}

/// Mirror JS `s.split(/\s+/)` for an arbitrary (possibly untrimmed) string.
///
/// Semantics: splitting on runs of JS whitespace. A leading whitespace run
/// produces a single leading `""` token; a trailing whitespace run produces a
/// single trailing `""` token; the empty string produces `[""]`.
fn js_split_whitespace(s: &str) -> Vec<String> {
    if s.is_empty() {
        return vec![String::new()];
    }
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut chars = s.chars().peekable();
    // Leading whitespace -> a single empty token, then the split continues.
    if chars.peek().is_some_and(|&c| is_js_whitespace(c)) {
        out.push(String::new());
        while chars.peek().is_some_and(|&c| is_js_whitespace(c)) {
            chars.next();
        }
    }
    for c in chars {
        if is_js_whitespace(c) {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
        } else {
            cur.push(c);
        }
    }
    // Trailing content or trailing-whitespace-induced empty token.
    if !cur.is_empty() {
        out.push(cur);
    } else if s.chars().last().is_some_and(is_js_whitespace) {
        out.push(String::new());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    // `Subtask` and `Task` come in via `super::*`; only `TaskLink` is extra.
    use crate::model::TaskLink;

    const DAY_MS: i64 = 86_400_000;

    fn task(id: &str, title: &str) -> Task {
        Task {
            id: id.to_string(),
            title: title.to_string(),
            status: "Todo".to_string(),
            priority: "medium".to_string(),
            ..Default::default()
        }
    }

    fn subtask(title: &str) -> Subtask {
        Subtask {
            id: String::new(),
            title: title.to_string(),
            completed: false,
        }
    }

    #[test]
    fn similarity_equal_and_substring() {
        assert_eq!(calculate_title_similarity("Fix bug", "fix BUG"), 1.0);
        // "fix" is a substring of "fix the bug".
        assert_eq!(calculate_title_similarity("Fix", "Fix the bug"), 0.85);
    }

    #[test]
    fn similarity_jaccard() {
        // {deploy, api} vs {deploy, ui}: inter=1, union=3 -> 1/3.
        let s = calculate_title_similarity("deploy api", "deploy ui");
        assert!((s - (1.0 / 3.0)).abs() < 1e-12);
    }

    #[test]
    fn similarity_punctuation_stripped() {
        // Punctuation removed, so these normalize equal.
        assert_eq!(calculate_title_similarity("Fix the bug!!!", "fix the bug"), 1.0);
    }

    #[test]
    fn similarity_empty_titles_equal() {
        // Both normalize to "" -> equal branch -> 1.0.
        assert_eq!(calculate_title_similarity("!!!", "@@@"), 1.0);
        assert_eq!(calculate_title_similarity("", ""), 1.0);
    }

    #[test]
    fn similarity_word_vs_empty() {
        // "abc" vs "" (from "!!!"): not equal; "".contains in "abc"? n2="" is a
        // substring of n1 -> JS "abc".includes("") === true -> 0.85.
        let s = calculate_title_similarity("abc", "!!!");
        assert!((s - 0.85).abs() < 1e-12);
    }

    #[test]
    fn tag_overlap_basic() {
        assert_eq!(calculate_tag_overlap(&[], &[]), 0.0);
        let a = vec!["x".to_string(), "y".to_string()];
        let b = vec!["y".to_string(), "z".to_string()];
        // inter=1, max=2 -> 0.5.
        assert!((calculate_tag_overlap(&a, &b) - 0.5).abs() < 1e-12);
    }

    #[test]
    fn duplicate_detection_groups_and_confidence() {
        let mut a = task("a", "deploy api service");
        a.tags = vec!["backend".to_string()];
        let mut b = task("b", "deploy api service");
        b.tags = vec!["backend".to_string()];
        let c = task("c", "totally unrelated");
        let groups = heuristic_duplicate_detection(&[a, b, c], 0.5);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].task_ids, vec!["a", "b"]);
        // Identical titles -> similarity 1.0 -> group confidence 1.0.
        assert!((groups[0].confidence - 1.0).abs() < 1e-12);
    }

    #[test]
    fn merge_prefers_subtasks_then_activity_stable() {
        let mut keep = task("keep", "Task A");
        keep.subtasks = vec![subtask("do x")];
        keep.tags = vec!["t1".to_string()];
        keep.time_estimate = 100.0;
        keep.time_spent = 5.0;
        keep.summary = "primary".to_string();

        let mut other = task("other", "Task B");
        other.subtasks = vec![subtask("DO X"), subtask("do y")];
        other.tags = vec!["t1".to_string(), "t2".to_string()];
        other.time_estimate = 200.0;
        other.time_spent = 3.0;
        other.summary = "secondary".to_string();

        // `other` has subtasks and `keep` has subtasks -> both has_sub=1, tie ->
        // activity length both 0 -> stable: keep stays first.
        let sug = heuristic_merge_suggestion(&[keep, other]).expect("non-empty group");
        assert_eq!(sug.keep_task_id, "keep");
        assert_eq!(sug.archive_task_ids, vec!["other"]);
        // "do x" already present (case-insensitively vs "DO X"); "do y" added.
        assert_eq!(sug.merged_fields.subtasks.len(), 2);
        assert_eq!(sug.merged_fields.tags, vec!["t1", "t2"]);
        assert!((sug.merged_fields.time_estimate - 200.0).abs() < 1e-12);
        assert!((sug.merged_fields.time_spent - 8.0).abs() < 1e-12);
        assert!(sug.reasoning.contains("Kept \"Task A\""));
        assert!(sug.merged_fields.summary.starts_with("primary\n\n---\nMerged"));
    }

    #[test]
    fn merge_rejects_empty_group() {
        assert!(heuristic_merge_suggestion(&[]).is_err());
    }

    #[test]
    fn redundancy_treats_commit_and_completed_as_terminal() {
        let now = 1_700_000_000_000i64;
        let active1 = task("act1", "write the docs");
        let mut commit = task("commit", "write the docs");
        commit.status = "Commit".to_string();
        let out_commit = analyze_redundancy(&[active1, commit], now);
        assert!(out_commit.iter().any(|a| a.analysis_type == "completed-overlap"));

        let active2 = task("act2", "write the docs");
        let mut completed = task("done", "write the docs");
        completed.status = "Completed".to_string();
        let out_completed = analyze_redundancy(&[active2, completed], now);
        assert!(out_completed.iter().any(|a| a.analysis_type == "completed-overlap"));
    }

    #[test]
    fn redundancy_completed_overlap_and_stale() {
        let now = 1_700_000_000_000i64;
        // active task overlapping a completed one.
        let mut active = task("act", "write the docs");
        active.priority = "low".to_string();
        active.updated_at = Some(now - 40 * DAY_MS); // stale (>30d)
        active.due_date = Some(now - DAY_MS); // past due
        let mut completed = task("done", "write the docs");
        completed.status = "Completed".to_string();

        let out = analyze_redundancy(&[active, completed], now);
        // completed-overlap (sim 1.0 > 0.7) + stale.
        assert!(out.iter().any(|a| a.analysis_type == "completed-overlap"
            && a.related_task_id.as_deref() == Some("done")));
        assert!(out.iter().any(|a| a.analysis_type == "stale"));
    }

    #[test]
    fn redundancy_subset_and_blocked_completed() {
        let now = 1_700_000_000_000i64;
        let mut parent = task("parent", "Big Parent");
        parent.subtasks = vec![subtask("child task")];
        let child = task("child", "Child Task"); // matches subtask title (ci)

        let mut done = task("done", "Some Done");
        done.status = "Completed".to_string();
        let mut blocked = task("blk", "Blocked One");
        blocked.links = Some(vec![TaskLink {
            target_task_id: "done".to_string(),
            link_type: "blocked-by".to_string(),
        }]);

        let out = analyze_redundancy(&[parent, child, done, blocked], now);
        assert!(out.iter().any(|a| a.analysis_type == "subset"
            && a.task_id == "child"
            && a.related_task_id.as_deref() == Some("parent")));
        assert!(out
            .iter()
            .any(|a| a.analysis_type == "blocked-completed" && a.task_id == "blk"));
    }

    #[test]
    fn categorization_tags_and_priority() {
        let now = 1_700_000_000_000i64;
        let mut t = task("t", "Fix the API bug");
        t.summary = "needs testing".to_string();
        t.due_date = Some(now + DAY_MS); // < 2 days -> high
        let out = heuristic_categorization(&[t], now);
        assert_eq!(out.len(), 1);
        // vocabulary order: bug, testing, api -> but filter preserves vocab order
        // which is [bug, testing, api]? vocab is [bug,...,testing,...,api] so
        // order is bug, testing, api.
        assert_eq!(out[0].suggested_tags, vec!["bug", "testing", "api"]);
        assert_eq!(out[0].suggested_priority, "high");
        assert!((out[0].confidence - 0.6).abs() < 1e-12);
    }

    #[test]
    fn categorization_priority_fallbacks() {
        let now = 1_700_000_000_000i64;
        // No due date, has a "blocks" link -> high.
        let mut t = task("t", "plain");
        t.links = Some(vec![TaskLink {
            target_task_id: "z".to_string(),
            link_type: "blocks".to_string(),
        }]);
        let out = heuristic_categorization(&[t], now);
        assert_eq!(out[0].suggested_priority, "high");

        // No due, no blocks, empty priority -> "medium".
        let mut t2 = task("t2", "plain");
        t2.priority = String::new();
        let out2 = heuristic_categorization(&[t2], now);
        assert_eq!(out2[0].suggested_priority, "medium");
    }

    #[test]
    fn clustering_word_overlap() {
        // "deploy api service" and "deploy api gateway" share {deploy, api} = 2.
        let a = task("a", "deploy api service");
        let b = task("b", "deploy api gateway");
        let c = task("c", "unrelated thing here");
        let mut a2 = a.clone();
        a2.tags = vec!["x".to_string()];
        let mut b2 = b.clone();
        b2.tags = vec!["y".to_string()];
        let clusters = heuristic_clustering(&[a2, b2, c]);
        assert_eq!(clusters.len(), 1);
        assert_eq!(clusters[0].task_ids, vec!["a", "b"]);
        assert_eq!(clusters[0].suggested_tags, vec!["x", "y"]);
        assert_eq!(clusters[0].theme, "deploy api service, deploy api gateway");
    }

    #[test]
    fn clustering_single_overlap_not_enough() {
        // Only {deploy} shared -> overlap 1 < 2 -> no cluster.
        let a = task("a", "deploy service");
        let b = task("b", "deploy nothing else matches");
        let clusters = heuristic_clustering(&[a, b]);
        assert!(clusters.is_empty());
    }
}
