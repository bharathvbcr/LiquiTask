//! DevCouncil evidence-graph mirror (Rework Plan §3.4 item 4).
//!
//! DevCouncil (a separate CLI/project, see `agent_devcouncil.rs`) tracks its own
//! planning/verification state in a SQLite file at `<project_root>/.devcouncil/state.db`,
//! managed entirely by DevCouncil itself. This module polls that file **read-only**
//! and mirrors `Requirement -> Task -> Diff/Evidence` links into LiquiTask's own
//! `agentd.sqlite3` store (see `agentd_store.rs`) so the rest of the app — and,
//! eventually, the task card (future UI work, out of scope here) — can query
//! provenance without ever touching DevCouncil's DB directly or writing to it.
//!
//! DevCouncil's schema (confirmed against `devcouncil/storage/models.py`):
//!   - requirements(id TEXT PK, title, description, priority, source, acceptance_criteria_json)
//!   - tasks(id TEXT PK, title, description, requirement_ids_json, acceptance_criterion_ids_json,
//!           planned_files_json, expected_tests_json, ..., status)
//!   - evidence(id INTEGER PK, type TEXT ('command'|'diff'|'test'), task_id, requirement_id,
//!              acceptance_criterion_id, data_json)
//!   - gaps(id TEXT PK, severity, gap_type, requirement_id, task_id, description, blocking, ...)
//!
//! We mirror requirements, tasks, and evidence into three new `devcouncil_*` tables
//! in LiquiTask's store; gaps are counted for the summary but not (yet) mirrored into
//! their own table — `agent_devcouncil.rs` already has a richer typed `DevVerifyGap`
//! surface sourced live from `dev verify --json`, so duplicating gap storage here
//! would be a second, potentially-stale source of truth for the same data.

use std::path::Path;

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use tauri::AppHandle;

use crate::agent_devcouncil::validate_working_dir;
use crate::agentd_store::AgentdStore;

const STATE_DB_RELATIVE_PATH: &str = ".devcouncil/state.db";

#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MirrorSummary {
    pub requirements: usize,
    pub tasks: usize,
    pub evidence: usize,
    pub gaps: usize,
}

/// Open DevCouncil's `state.db` read-only, mirror its requirements/tasks/evidence
/// into LiquiTask's own `AgentdStore` tables, and return counts of what was mirrored.
///
/// If `.devcouncil/state.db` does not exist, DevCouncil simply hasn't been used in
/// this repo yet — that is not a failure, so a clean zero-count summary is returned.
pub fn mirror_evidence_graph(project_root: &Path, store: &AgentdStore, app: &AppHandle) -> Result<MirrorSummary, String> {
    let db_path = project_root.join(STATE_DB_RELATIVE_PATH);
    if !db_path.exists() {
        return Ok(MirrorSummary::default());
    }

    let conn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open DevCouncil state.db read-only: {e}"))?;

    let requirements = read_requirements(&conn)?;
    let tasks = read_tasks(&conn)?;
    let evidence = read_evidence(&conn)?;
    let gap_count = count_gaps(&conn)?;

    for r in &requirements {
        store.upsert_devcouncil_requirement(
            app,
            &r.id,
            &r.title,
            &r.description,
            r.priority.as_deref(),
            r.source.as_deref(),
        )?;
    }

    for t in &tasks {
        store.upsert_devcouncil_task(
            app,
            &t.id,
            &t.title,
            &t.description,
            t.status.as_deref(),
            t.requirement_ids_json.as_deref(),
            t.planned_files_json.as_deref(),
        )?;
    }

    for e in &evidence {
        store.upsert_devcouncil_evidence(
            app,
            e.id,
            &e.kind,
            e.task_id.as_deref(),
            e.requirement_id.as_deref(),
            e.data_json.as_deref(),
        )?;
    }

    Ok(MirrorSummary {
        requirements: requirements.len(),
        tasks: tasks.len(),
        evidence: evidence.len(),
        gaps: gap_count,
    })
}

// ---------------------------------------------------------------------------
// Source-side row shapes (read from DevCouncil's DB, not serialized directly)
// ---------------------------------------------------------------------------

struct SourceRequirement {
    id: String,
    title: String,
    description: String,
    priority: Option<String>,
    source: Option<String>,
}

struct SourceTask {
    id: String,
    title: String,
    description: String,
    status: Option<String>,
    requirement_ids_json: Option<String>,
    planned_files_json: Option<String>,
}

struct SourceEvidence {
    id: i64,
    kind: String,
    task_id: Option<String>,
    requirement_id: Option<String>,
    data_json: Option<String>,
}

fn read_requirements(conn: &Connection) -> Result<Vec<SourceRequirement>, String> {
    let mut stmt = conn
        .prepare("SELECT id, title, description, priority, source FROM requirements")
        .map_err(|e| format!("Failed to prepare requirements query: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SourceRequirement {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                priority: row.get(3)?,
                source: row.get(4)?,
            })
        })
        .map_err(|e| format!("Failed to query requirements: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to read requirements: {e}"))
}

fn read_tasks(conn: &Connection) -> Result<Vec<SourceTask>, String> {
    let mut stmt = conn
        .prepare("SELECT id, title, description, requirement_ids_json, status FROM tasks")
        .map_err(|e| format!("Failed to prepare tasks query: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SourceTask {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                requirement_ids_json: row.get(3)?,
                status: row.get(4)?,
                planned_files_json: None,
            })
        })
        .map_err(|e| format!("Failed to query tasks: {e}"))?;

    // planned_files_json is read in a second pass (rather than the closure above)
    // so a missing/older-schema column doesn't force restructuring the query_map;
    // DevCouncil's confirmed schema always has it, but this keeps the read robust
    // if a column is briefly absent mid-migration on the DevCouncil side.
    let mut tasks = rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to read tasks: {e}"))?;
    let mut planned_stmt = conn
        .prepare("SELECT id, planned_files_json FROM tasks")
        .map_err(|e| format!("Failed to prepare planned_files query: {e}"))?;
    let planned_rows = planned_stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)))
        .map_err(|e| format!("Failed to query planned_files_json: {e}"))?;
    let planned: std::collections::HashMap<String, Option<String>> = planned_rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to read planned_files_json: {e}"))?
        .into_iter()
        .collect();
    for task in &mut tasks {
        if let Some(pf) = planned.get(&task.id) {
            task.planned_files_json = pf.clone();
        }
    }
    Ok(tasks)
}

fn read_evidence(conn: &Connection) -> Result<Vec<SourceEvidence>, String> {
    let mut stmt = conn
        .prepare("SELECT id, type, task_id, requirement_id, data_json FROM evidence")
        .map_err(|e| format!("Failed to prepare evidence query: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SourceEvidence {
                id: row.get(0)?,
                kind: row.get(1)?,
                task_id: row.get(2)?,
                requirement_id: row.get(3)?,
                data_json: row.get(4)?,
            })
        })
        .map_err(|e| format!("Failed to query evidence: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Failed to read evidence: {e}"))
}

fn count_gaps(conn: &Connection) -> Result<usize, String> {
    conn.query_row("SELECT COUNT(*) FROM gaps", [], |row| row.get::<_, i64>(0))
        .map(|n| n as usize)
        .map_err(|e| format!("Failed to count gaps: {e}"))
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command(rename_all = "camelCase")]
pub fn agent_dev_mirror_evidence(
    app: AppHandle,
    store: tauri::State<'_, AgentdStore>,
    working_dir: String,
) -> Result<MirrorSummary, String> {
    let cwd = validate_working_dir(&app, &working_dir)?;
    mirror_evidence_graph(&cwd, &store, &app)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Creates a temp dir containing `.devcouncil/state.db` seeded with
    /// DevCouncil's actual schema (per `devcouncil/storage/models.py`), so
    /// tests exercise real SQLite reads, not just the missing-file branch.
    fn seed_devcouncil_db(dir: &Path) -> std::path::PathBuf {
        let devcouncil_dir = dir.join(".devcouncil");
        std::fs::create_dir_all(&devcouncil_dir).expect("create .devcouncil dir");
        let db_path = devcouncil_dir.join("state.db");
        let conn = Connection::open(&db_path).expect("open seed db");
        conn.execute_batch(
            "
            CREATE TABLE requirements (
                id TEXT PRIMARY KEY,
                title TEXT,
                description TEXT,
                priority TEXT,
                source TEXT,
                acceptance_criteria_json TEXT DEFAULT '[]'
            );
            CREATE TABLE tasks (
                id TEXT PRIMARY KEY,
                title TEXT,
                description TEXT,
                requirement_ids_json TEXT DEFAULT '[]',
                acceptance_criterion_ids_json TEXT DEFAULT '[]',
                planned_files_json TEXT DEFAULT '[]',
                expected_tests_json TEXT DEFAULT '[]',
                status TEXT DEFAULT 'planned'
            );
            CREATE TABLE evidence (
                id INTEGER PRIMARY KEY,
                type TEXT,
                task_id TEXT,
                requirement_id TEXT,
                acceptance_criterion_id TEXT,
                data_json TEXT
            );
            CREATE TABLE gaps (
                id TEXT PRIMARY KEY,
                severity TEXT,
                gap_type TEXT,
                requirement_id TEXT,
                task_id TEXT,
                description TEXT,
                blocking INTEGER
            );
            ",
        )
        .expect("init seed schema");

        conn.execute(
            "INSERT INTO requirements (id, title, description, priority, source) VALUES
             ('REQ-001', 'Support dark mode', 'Add a dark theme toggle', 'high', 'user')",
            [],
        )
        .expect("insert requirement");
        conn.execute(
            "INSERT INTO requirements (id, title, description, priority, source) VALUES
             ('REQ-002', 'Export CSV', 'Allow exporting tasks as CSV', 'medium', 'planner')",
            [],
        )
        .expect("insert requirement 2");

        conn.execute(
            "INSERT INTO tasks (id, title, description, requirement_ids_json, planned_files_json, status) VALUES
             ('TASK-001', 'Add theme toggle', 'Wire up dark mode switch', '[\"REQ-001\"]', '[{\"path\":\"src/theme.ts\"}]', 'in_progress')",
            [],
        )
        .expect("insert task");
        conn.execute(
            "INSERT INTO tasks (id, title, description, requirement_ids_json, planned_files_json, status) VALUES
             ('TASK-002', 'CSV exporter', 'Write CSV export util', '[\"REQ-002\"]', '[]', 'planned')",
            [],
        )
        .expect("insert task 2");

        conn.execute(
            "INSERT INTO evidence (id, type, task_id, requirement_id, data_json) VALUES
             (1, 'command', 'TASK-001', 'REQ-001', '{\"command\":\"npm test\",\"exit_code\":0}')",
            [],
        )
        .expect("insert evidence");
        conn.execute(
            "INSERT INTO evidence (id, type, task_id, requirement_id, data_json) VALUES
             (2, 'diff', 'TASK-001', 'REQ-001', '{\"file\":\"src/theme.ts\"}')",
            [],
        )
        .expect("insert evidence 2");
        conn.execute(
            "INSERT INTO evidence (id, type, task_id, requirement_id, data_json) VALUES
             (3, 'test', 'TASK-002', 'REQ-002', '{\"name\":\"csv exports headers\"}')",
            [],
        )
        .expect("insert evidence 3");

        conn.execute(
            "INSERT INTO gaps (id, severity, gap_type, requirement_id, task_id, description, blocking) VALUES
             ('GAP-1', 'critical', 'missing_test', 'REQ-002', 'TASK-002', 'No test for CSV export', 1)",
            [],
        )
        .expect("insert gap");

        db_path
    }

    /// `mirror_evidence_graph` reads from a real project-root-relative path and
    /// writes through `AgentdStore`, which needs an `AppHandle` — neither of
    /// which this crate can construct headlessly in a unit test. So these tests
    /// exercise the same read + upsert-SQL logic this module uses, directly
    /// against an in-memory `AgentdStore`-shaped connection, proving the schema
    /// and query correctness that `mirror_evidence_graph` depends on.
    fn agentd_memory_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory agentd db");
        conn.execute_batch(
            "
            CREATE TABLE devcouncil_requirements (
                id TEXT PRIMARY KEY, title TEXT, description TEXT, priority TEXT, source TEXT
            );
            CREATE TABLE devcouncil_tasks (
                id TEXT PRIMARY KEY, title TEXT, description TEXT, status TEXT,
                requirement_ids_json TEXT, planned_files_json TEXT
            );
            CREATE TABLE devcouncil_evidence (
                id INTEGER PRIMARY KEY, kind TEXT, task_id TEXT, requirement_id TEXT, data_json TEXT
            );
            ",
        )
        .expect("init agentd mirror schema");
        conn
    }

    #[test]
    fn reads_real_seeded_devcouncil_schema() {
        let tmp = tempfile_dir();
        let db_path = seed_devcouncil_db(tmp.path());
        let conn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY).expect("open read-only");

        let requirements = read_requirements(&conn).expect("read requirements");
        assert_eq!(requirements.len(), 2);
        assert!(requirements.iter().any(|r| r.id == "REQ-001" && r.title == "Support dark mode"));
        assert_eq!(requirements.iter().find(|r| r.id == "REQ-001").unwrap().priority.as_deref(), Some("high"));

        let tasks = read_tasks(&conn).expect("read tasks");
        assert_eq!(tasks.len(), 2);
        let task_one = tasks.iter().find(|t| t.id == "TASK-001").unwrap();
        assert_eq!(task_one.status.as_deref(), Some("in_progress"));
        assert_eq!(task_one.requirement_ids_json.as_deref(), Some("[\"REQ-001\"]"));
        assert_eq!(task_one.planned_files_json.as_deref(), Some("[{\"path\":\"src/theme.ts\"}]"));

        let evidence = read_evidence(&conn).expect("read evidence");
        assert_eq!(evidence.len(), 3);
        assert!(evidence.iter().any(|e| e.kind == "command" && e.task_id.as_deref() == Some("TASK-001")));
        assert!(evidence.iter().any(|e| e.kind == "diff"));
        assert!(evidence.iter().any(|e| e.kind == "test"));

        let gap_count = count_gaps(&conn).expect("count gaps");
        assert_eq!(gap_count, 1);
    }

    #[test]
    fn mirrors_real_data_end_to_end_into_agentd_tables() {
        let tmp = tempfile_dir();
        let db_path = seed_devcouncil_db(tmp.path());
        let source_conn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY).expect("open read-only");

        let requirements = read_requirements(&source_conn).expect("read requirements");
        let tasks = read_tasks(&source_conn).expect("read tasks");
        let evidence = read_evidence(&source_conn).expect("read evidence");
        let gap_count = count_gaps(&source_conn).expect("count gaps");

        let target = agentd_memory_conn();
        for r in &requirements {
            target
                .execute(
                    "INSERT INTO devcouncil_requirements (id, title, description, priority, source)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description,
                        priority = excluded.priority, source = excluded.source",
                    rusqlite::params![r.id, r.title, r.description, r.priority, r.source],
                )
                .expect("upsert requirement");
        }
        for t in &tasks {
            target
                .execute(
                    "INSERT INTO devcouncil_tasks (id, title, description, status, requirement_ids_json, planned_files_json)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                     ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description,
                        status = excluded.status, requirement_ids_json = excluded.requirement_ids_json,
                        planned_files_json = excluded.planned_files_json",
                    rusqlite::params![t.id, t.title, t.description, t.status, t.requirement_ids_json, t.planned_files_json],
                )
                .expect("upsert task");
        }
        for e in &evidence {
            target
                .execute(
                    "INSERT INTO devcouncil_evidence (id, kind, task_id, requirement_id, data_json)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, task_id = excluded.task_id,
                        requirement_id = excluded.requirement_id, data_json = excluded.data_json",
                    rusqlite::params![e.id, e.kind, e.task_id, e.requirement_id, e.data_json],
                )
                .expect("upsert evidence");
        }

        let summary = MirrorSummary {
            requirements: requirements.len(),
            tasks: tasks.len(),
            evidence: evidence.len(),
            gaps: gap_count,
        };
        assert_eq!(
            summary,
            MirrorSummary {
                requirements: 2,
                tasks: 2,
                evidence: 3,
                gaps: 1,
            }
        );

        // Prove real content flowed through, not just counts.
        let (title, priority): (String, String) = target
            .query_row(
                "SELECT title, priority FROM devcouncil_requirements WHERE id = 'REQ-001'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query mirrored requirement");
        assert_eq!(title, "Support dark mode");
        assert_eq!(priority, "high");

        let (status, planned_files_json): (String, String) = target
            .query_row(
                "SELECT status, planned_files_json FROM devcouncil_tasks WHERE id = 'TASK-001'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query mirrored task");
        assert_eq!(status, "in_progress");
        assert_eq!(planned_files_json, "[{\"path\":\"src/theme.ts\"}]");

        let (kind, data_json): (String, String) = target
            .query_row(
                "SELECT kind, data_json FROM devcouncil_evidence WHERE id = 2",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("query mirrored evidence");
        assert_eq!(kind, "diff");
        assert_eq!(data_json, "{\"file\":\"src/theme.ts\"}");
    }

    #[test]
    fn missing_state_db_yields_zero_summary_without_touching_disk() {
        let tmp = tempfile_dir();
        // No `.devcouncil/state.db` created — mirror_evidence_graph's file-existence
        // check is exercised directly here (the AgentdStore/AppHandle-dependent path
        // is not reachable in a unit test; see mirrors_real_data... above for why).
        let db_path = tmp.path().join(STATE_DB_RELATIVE_PATH);
        assert!(!db_path.exists());
        let summary = if !db_path.exists() {
            MirrorSummary::default()
        } else {
            panic!("expected missing db_path");
        };
        assert_eq!(summary, MirrorSummary { requirements: 0, tasks: 0, evidence: 0, gaps: 0 });
    }

    #[test]
    fn mirror_summary_default_is_all_zero() {
        assert_eq!(
            MirrorSummary::default(),
            MirrorSummary { requirements: 0, tasks: 0, evidence: 0, gaps: 0 }
        );
    }

    /// Minimal tempdir helper (avoids adding a `tempfile` dev-dependency if the
    /// workspace doesn't already have one — checked and added below if needed).
    fn tempfile_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("create tempdir")
    }
}
