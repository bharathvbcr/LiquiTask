//! Port of `src/services/autoOrganizeService.ts` *deterministic* pieces.
//!
//! This service is predominantly AI orchestration: `runAutoOrganize`,
//! `runClustering`, `runAutoTagging`, `runHierarchyDetection`,
//! `runProjectAssignment`, `runTagConsolidation` and `applyChanges` all revolve
//! around `aiService` calls (Ollama). **None of that moves.** Only the three
//! genuinely pure, structural helpers cross into Rust:
//!
//! 1. [`filter_task_ids`] — the `filterTasks` pre-filter (exclude projects, then
//!    slice to the batch cap). Returns kept ids in order; the TS side maps them
//!    back to `Task[]`.
//! 2. [`dedup_candidate_pairs`] — the candidate-pair generation that runs
//!    *before* `aiService.detectDuplicates`: build an inverted index of title
//!    words and emit the unique unordered id-pairs.
//! 3. [`consolidate_tags`] — the tag-remap step of the `applyChanges`
//!    `tag-consolidate` branch: remap each tag through `before -> suggested`,
//!    then dedupe preserving order.
//!
//! All id assembly that depends on `Date.now()` / `Math.random()` stays in TS
//! (this module never mints ids); it only returns structural data.

use std::collections::HashMap;

use crate::model::Task;

/// Faithful port of `AutoOrganizeService.filterTasks`.
///
/// Excludes tasks whose `projectId` is in `excluded_project_ids` (only when that
/// list is non-empty, matching the original guard), then — if the survivor count
/// exceeds `max_tasks_per_batch` — keeps the first `max_tasks_per_batch` in the
/// original order. Returns the kept task ids in order; the TS caller re-hydrates
/// these back into `Task[]`.
pub fn filter_task_ids(
    tasks: &[Task],
    excluded_project_ids: &[String],
    max_tasks_per_batch: i64,
) -> Vec<String> {
    // `filtered = allTasks` then conditionally filter — the original only runs
    // the `.filter` when `excludedProjectIds.length > 0`. With an empty exclude
    // list this is a no-op, so a plain `contains` check over an empty slice is
    // equivalent (nothing is ever excluded).
    let mut filtered: Vec<&Task> = if excluded_project_ids.is_empty() {
        tasks.iter().collect()
    } else {
        tasks
            .iter()
            .filter(|t| !excluded_project_ids.contains(&t.project_id))
            .collect()
    };

    // `if (filtered.length > maxTasksPerBatch) filtered = filtered.slice(0, max)`.
    // Faithfully reproduce JS `Array.slice(0, max)`: a non-negative `max` keeps
    // the first `max` elements; a NEGATIVE `max` counts from the end and keeps
    // `len - |max|` elements (clamped to 0), it does NOT yield an empty array.
    if (filtered.len() as i64) > max_tasks_per_batch {
        let keep = if max_tasks_per_batch < 0 {
            filtered
                .len()
                .saturating_sub((-max_tasks_per_batch) as usize)
        } else {
            (max_tasks_per_batch as usize).min(filtered.len())
        };
        filtered.truncate(keep);
    }

    filtered.into_iter().map(|t| t.id.clone()).collect()
}

/// A unique unordered candidate pair, serialized as `[id_a, id_b]` in the same
/// sorted order the original uses for its dedupe key (`[a, b].sort()`).
pub type CandidatePair = [String; 2];

/// Faithful port of the candidate-pair generation inside `runDeduplication`,
/// i.e. everything *before* `await aiService.detectDuplicates(taskPairs, ...)`.
///
/// Algorithm (mirrors the TS exactly):
/// 1. Build an inverted index mapping each title word -> list of task ids that
///    contain it. Words are lowercased, split on whitespace (`/\s+/`) and only
///    kept when their length is `> 2`.
/// 2. Walk the index in *first-seen word order* and, for every pair `(i, j)`
///    with `i < j` within a word's id-list, form the dedupe key `[a, b].sort()`
///    joined by `-`. The first time a key is seen, emit the pair.
///
/// # Determinism / ordering
/// The original relies on JS `Map` preserving insertion order for `titleIndex`.
/// Rust's `HashMap` iteration is unordered, so we back the index with a
/// `Vec<(word, Vec<id>)>` (insertion-ordered) plus a `HashMap<word, index>` for
/// O(1) lookup. Iterating the `Vec` reproduces the original discovery order.
///
/// Note on whitespace splitting: the TS uses `String.prototype.split(/\s+/)`,
/// whose `\s` character class is NOT the same as Rust's Unicode
/// `char::is_whitespace()` (they disagree on U+0085/NEL and U+FEFF/BOM). We
/// split with [`split_js_whitespace`], which matches the JS `\s` set exactly, so
/// word boundaries are identical for free-form Unicode titles.
pub fn dedup_candidate_pairs(tasks: &[Task]) -> Vec<CandidatePair> {
    // `if (tasks.length < 2) return changes;`
    if tasks.len() < 2 {
        return Vec::new();
    }

    // Insertion-ordered inverted index: parallel `order` vec + lookup map.
    let mut order: Vec<(String, Vec<String>)> = Vec::new();
    let mut word_index: HashMap<String, usize> = HashMap::new();

    for task in tasks {
        for word in split_js_whitespace(&task.title) {
            // The TS lowercases the whole title FIRST, then keeps words with
            // `w.length > 2`. Measure length on the *lowercased* token, using
            // UTF-16 code units to match JS `String.length` exactly (a non-BMP
            // char such as an emoji is length 2 in JS but 1 Unicode scalar, so
            // `chars().count()` would disagree — titles are free-form user text).
            let lower = word.to_lowercase();
            if lower.encode_utf16().count() <= 2 {
                continue;
            }
            match word_index.get(&lower) {
                Some(&idx) => order[idx].1.push(task.id.clone()),
                None => {
                    word_index.insert(lower.clone(), order.len());
                    order.push((lower, vec![task.id.clone()]));
                }
            }
        }
    }

    let mut pair_seen: HashMap<String, ()> = HashMap::new();
    let mut pairs: Vec<CandidatePair> = Vec::new();

    for (_word, ids) in &order {
        for i in 0..ids.len() {
            for j in (i + 1)..ids.len() {
                // `[ids[i], ids[j]].sort().join("-")` — JS default string sort.
                let (a, b) = sorted_pair(&ids[i], &ids[j]);
                let key = format!("{a}-{b}");
                if pair_seen.insert(key, ()).is_none() {
                    // Original pushes only if BOTH tasks are found by id. Since
                    // every id in the index came from a task in `tasks`, the
                    // `find` always succeeds here, so we always emit.
                    pairs.push([a, b]);
                }
            }
        }
    }

    pairs
}

/// Order two ids the way `[a, b].sort()` does in JS: lexicographic by UTF-16
/// code unit. For the id character sets this service handles (alphanumerics and
/// `-`), Rust's byte/`str` ordering agrees with JS's code-unit ordering, so a
/// plain `str` comparison is faithful.
fn sorted_pair(a: &str, b: &str) -> (String, String) {
    if a <= b {
        (a.to_string(), b.to_string())
    } else {
        (b.to_string(), a.to_string())
    }
}

/// The ECMAScript regex `\s` character class. This deliberately differs from
/// Rust's `char::is_whitespace()` (Unicode `White_Space`): it INCLUDES U+FEFF
/// (BOM/ZWNBSP) and EXCLUDES U+0085 (NEL), matching what JS `.split(/\s+/)` does.
fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{0009}'
            | '\u{000A}'
            | '\u{000B}'
            | '\u{000C}'
            | '\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

/// Faithful port of JS `String.prototype.split(/\s+/)` for word extraction:
/// split on runs of [`is_js_whitespace`] and drop empty tokens. JS emits
/// leading/trailing empty strings on boundary whitespace, but those are length 0
/// and dropped by the caller's `> 2` filter, so emitting only non-empty tokens
/// is equivalent.
fn split_js_whitespace(s: &str) -> impl Iterator<Item = &str> {
    s.split(is_js_whitespace).filter(|w| !w.is_empty())
}

/// Faithful port of the tag-remap in the `tag-consolidate` branch of
/// `applyChanges`:
/// ```js
/// const newTags = task.tags.map((t) => before.includes(t) ? suggested : t);
/// const dedupedTags = Array.from(new Set(newTags));
/// ```
/// Each tag maps to `suggested` when it appears in `before`, otherwise stays
/// itself; the result is de-duplicated while preserving first-seen order (JS
/// `Set` insertion order).
pub fn consolidate_tags(tags: &[String], before: &[String], suggested: &str) -> Vec<String> {
    let mut seen: HashMap<String, ()> = HashMap::new();
    let mut out: Vec<String> = Vec::new();
    for tag in tags {
        let mapped = if before.contains(tag) {
            suggested.to_string()
        } else {
            tag.clone()
        };
        if seen.insert(mapped.clone(), ()).is_none() {
            out.push(mapped);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Task;

    fn task(id: &str, project_id: &str, title: &str) -> Task {
        Task {
            id: id.to_string(),
            project_id: project_id.to_string(),
            title: title.to_string(),
            ..Task::default()
        }
    }

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    // ---- filter_task_ids ---------------------------------------------------

    #[test]
    fn filter_no_exclusions_under_cap() {
        let tasks = vec![task("1", "p1", "a"), task("2", "p2", "b")];
        let got = filter_task_ids(&tasks, &[], 100);
        assert_eq!(got, s(&["1", "2"]));
    }

    #[test]
    fn filter_excludes_projects() {
        let tasks = vec![
            task("1", "p1", "a"),
            task("2", "p2", "b"),
            task("3", "p1", "c"),
        ];
        let got = filter_task_ids(&tasks, &s(&["p2"]), 100);
        assert_eq!(got, s(&["1", "3"]));
    }

    #[test]
    fn filter_slices_to_cap_in_order() {
        let tasks = vec![
            task("1", "p1", "a"),
            task("2", "p1", "b"),
            task("3", "p1", "c"),
        ];
        let got = filter_task_ids(&tasks, &[], 2);
        assert_eq!(got, s(&["1", "2"]));
    }

    #[test]
    fn filter_exclude_then_slice() {
        let tasks = vec![
            task("1", "p1", "a"),
            task("2", "px", "b"),
            task("3", "p1", "c"),
            task("4", "p1", "d"),
        ];
        // Exclude px -> [1,3,4]; cap 2 -> [1,3].
        let got = filter_task_ids(&tasks, &s(&["px"]), 2);
        assert_eq!(got, s(&["1", "3"]));
    }

    #[test]
    fn filter_cap_equal_length_keeps_all() {
        let tasks = vec![task("1", "p1", "a"), task("2", "p1", "b")];
        // length (2) is NOT > cap (2), so no slice.
        let got = filter_task_ids(&tasks, &[], 2);
        assert_eq!(got, s(&["1", "2"]));
    }

    #[test]
    fn filter_negative_cap_drops_last_like_js_slice() {
        // JS `slice(0, -1)` keeps all but the last element (NOT an empty array).
        let tasks = vec![
            task("1", "p1", "a"),
            task("2", "p1", "b"),
            task("3", "p1", "c"),
        ];
        assert_eq!(filter_task_ids(&tasks, &[], -1), s(&["1", "2"]));
        // slice(0, -2) keeps the first element only.
        assert_eq!(filter_task_ids(&tasks, &[], -2), s(&["1"]));
        // A magnitude >= len clamps to empty, matching JS.
        assert_eq!(filter_task_ids(&tasks, &[], -5), Vec::<String>::new());
    }

    // ---- dedup_candidate_pairs --------------------------------------------

    #[test]
    fn dedup_js_whitespace_class_matches_js() {
        // U+FEFF (BOM) IS JS `\s` -> splits "review\u{feff}report" into two words,
        // so the shared "review" links the pair (matches TS `.split(/\s+/)`).
        let bom = vec![
            task("T0", "p1", "review\u{feff}report"),
            task("T1", "p1", "review daily"),
        ];
        assert_eq!(
            dedup_candidate_pairs(&bom),
            vec![["T0".to_string(), "T1".to_string()]]
        );
        // U+0085 (NEL) is NOT JS `\s` -> "planning\u{85}session" stays one word,
        // so no shared "planning" word and no pair (matches TS, unlike Unicode).
        let nel = vec![
            task("T0", "p1", "planning\u{85}session"),
            task("T1", "p1", "planning phase"),
        ];
        assert!(dedup_candidate_pairs(&nel).is_empty());
    }

    #[test]
    fn dedup_word_length_counts_utf16_units() {
        // "😀😀" is 2 Unicode scalars but JS `.length` == 4 (surrogate pairs), so
        // it passes the `> 2` filter and the shared word links the pair.
        let tasks = vec![
            task("1", "p1", "\u{1F600}\u{1F600}"),
            task("2", "p1", "\u{1F600}\u{1F600}"),
        ];
        assert_eq!(
            dedup_candidate_pairs(&tasks),
            vec![["1".to_string(), "2".to_string()]]
        );
    }

    #[test]
    fn dedup_empty_when_fewer_than_two() {
        let tasks = vec![task("1", "p1", "hello world")];
        assert!(dedup_candidate_pairs(&tasks).is_empty());
    }

    #[test]
    fn dedup_short_words_ignored() {
        // "a" and "to" are length <= 2 so contribute no index entries.
        let tasks = vec![task("1", "p1", "a to"), task("2", "p1", "a to")];
        assert!(dedup_candidate_pairs(&tasks).is_empty());
    }

    #[test]
    fn dedup_basic_pair() {
        let tasks = vec![
            task("1", "p1", "deploy service"),
            task("2", "p1", "deploy pipeline"),
        ];
        // shared word "deploy" -> pair [1,2].
        let got = dedup_candidate_pairs(&tasks);
        assert_eq!(got, vec![["1".to_string(), "2".to_string()]]);
    }

    #[test]
    fn dedup_dedupes_across_words() {
        let tasks = vec![
            task("1", "p1", "deploy service pipeline"),
            task("2", "p1", "deploy service pipeline"),
        ];
        // three shared words but the pair [1,2] is emitted once.
        let got = dedup_candidate_pairs(&tasks);
        assert_eq!(got, vec![["1".to_string(), "2".to_string()]]);
    }

    #[test]
    fn dedup_sorted_key_order() {
        // ids chosen so encounter order (b then a) differs from sorted order.
        let tasks = vec![
            task("b", "p1", "shared word"),
            task("a", "p1", "shared word"),
        ];
        // Encounter list for "shared" = [b, a]; sorted key -> [a, b].
        let got = dedup_candidate_pairs(&tasks);
        assert_eq!(got, vec![["a".to_string(), "b".to_string()]]);
    }

    #[test]
    fn dedup_lowercases() {
        let tasks = vec![
            task("1", "p1", "Deploy Service"),
            task("2", "p1", "deploy SERVICE"),
        ];
        // Case-insensitive: "deploy"/"service" both match -> single pair.
        let got = dedup_candidate_pairs(&tasks);
        assert_eq!(got, vec![["1".to_string(), "2".to_string()]]);
    }

    #[test]
    fn dedup_multiple_pairs_first_seen_word_order() {
        let tasks = vec![
            task("1", "p1", "alpha"),
            task("2", "p1", "alpha beta"),
            task("3", "p1", "beta"),
        ];
        // "alpha" -> ids [1,2] -> pair [1,2].
        // "beta"  -> ids [2,3] -> pair [2,3].
        let got = dedup_candidate_pairs(&tasks);
        assert_eq!(
            got,
            vec![
                ["1".to_string(), "2".to_string()],
                ["2".to_string(), "3".to_string()],
            ]
        );
    }

    // ---- consolidate_tags --------------------------------------------------

    #[test]
    fn consolidate_maps_before_to_suggested() {
        let tags = s(&["bug", "defect", "ui"]);
        let before = s(&["bug", "defect"]);
        let got = consolidate_tags(&tags, &before, "issue");
        // bug->issue, defect->issue (dedup), ui->ui.
        assert_eq!(got, s(&["issue", "ui"]));
    }

    #[test]
    fn consolidate_no_matches_is_identity() {
        let tags = s(&["a", "b", "c"]);
        let got = consolidate_tags(&tags, &s(&["x", "y"]), "z");
        assert_eq!(got, s(&["a", "b", "c"]));
    }

    #[test]
    fn consolidate_preserves_first_seen_order() {
        // suggested already present later; mapping brings it forward, dedup drops
        // the duplicate, preserving the first occurrence's position.
        let tags = s(&["old", "keep", "issue"]);
        let before = s(&["old"]);
        let got = consolidate_tags(&tags, &before, "issue");
        assert_eq!(got, s(&["issue", "keep"]));
    }

    #[test]
    fn consolidate_dedupes_preexisting_dupes() {
        let tags = s(&["x", "x", "y"]);
        let got = consolidate_tags(&tags, &[], "z");
        assert_eq!(got, s(&["x", "y"]));
    }
}
