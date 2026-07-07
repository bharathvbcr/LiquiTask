//! SQLite store for the task domain: the **live append-only task event log**
//! (source of truth for the event-sourced board) plus the additive snapshot
//! export schema for tasks/projects/board columns (Rework Plan Phase 5
//! groundwork).
//!
//! ## Event log (live)
//!
//! `task_events` is the durable write-ahead log behind
//! `src/core/events/taskEventStore.ts`. Every board mutation is appended here
//! BEFORE any projection (React state, IndexedDB mirror, snapshot tables) is
//! updated, and the board is rebuilt from this log on boot. Appends are
//! transactional: a batch lands entirely or not at all.
//!
//! ## Snapshot export (additive groundwork)
//!
//! The snapshot half of this module is deliberately **not** a live store. It mirrors the shape of
//! `Task` / `Project` / `BoardColumn` from `types.ts` (as currently persisted
//! by `src/services/indexedDBService.ts`) into a brand-new SQLite file
//! (`tasks_export.sqlite3`) that nothing else reads from yet. It exists so a
//! future cutover session has a tested schema + a one-way export function to
//! build the real Phase 5 migration on top of, per the safety requirement
//! that "task migration is a single cutover in Phase 5 with migrationService
//! backup" (see `src/services/migrationService.ts` for the existing
//! backup/restore pattern this mirrors on the TS side).
//!
//! Nested/array fields (subtasks, attachments, tags, custom field values,
//! links, error logs, activity, recurring config, github issue) are
//! JSON-encoded into TEXT columns, following the same precedent as
//! `agentd_store.rs` (`payload_json`) and `run_store.rs` (journal entries
//! serialized as JSON blobs).
//!
//! Nothing in this module is wired into `App.tsx`, any hook, or the live
//! IndexedDB read/write path. The two Tauri commands it exposes
//! (`task_store_export_snapshot`, `task_store_read_snapshot`) are registered
//! in `main.rs` purely so they are reachable for manual/integration testing
//! by a future session.

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const DB_FILE: &str = "tasks_export.sqlite3";

pub struct TaskStore {
    conn: Mutex<Option<Connection>>,
}

impl Default for TaskStore {
    fn default() -> Self {
        Self { conn: Mutex::new(None) }
    }
}

// ---------------------------------------------------------------------------
// Wire types (what the TS side would send / receive). These intentionally
// mirror `Task` / `Project` / `BoardColumn` in `types.ts` field-for-field.
// Dates are carried as ISO-8601 strings, matching how `indexedDBService.ts`
// round-trips `Date` fields through JSON elsewhere in the app.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubtaskRecord {
    pub id: String,
    pub title: String,
    pub completed: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRecord {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(rename = "type")]
    pub kind: String, // "file" | "link"
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskLinkRecord {
    pub target_task_id: String,
    #[serde(rename = "type")]
    pub kind: String, // LinkType
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecurringConfigRecord {
    pub enabled: bool,
    pub frequency: String,
    pub interval: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub days_of_week: Option<Vec<i64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub day_of_month: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_occurrence: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ErrorLogRecord {
    pub timestamp: String,
    pub message: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActivityItemRecord {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String, // ActivityType
    pub timestamp: String,
    pub user_id: String,
    pub details: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_value: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub new_value: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GithubIssueRecord {
    pub owner: String,
    pub repo: String,
    pub number: i64,
    pub url: String,
}

/// Mirrors `Task` from `types.ts`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecord {
    pub id: String,
    pub job_id: String,
    pub project_id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    pub summary: String,
    pub assignee: String,
    pub priority: String,
    pub status: String,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(default)]
    pub subtasks: Vec<SubtaskRecord>,
    #[serde(default)]
    pub attachments: Vec<AttachmentRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_field_values: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub links: Option<Vec<TaskLinkRecord>>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub time_estimate: i64,
    pub time_spent: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recurring: Option<RecurringConfigRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_logs: Option<Vec<ErrorLogRecord>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity: Option<Vec<ActivityItemRecord>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github_issue: Option<GithubIssueRecord>,
}

/// Mirrors `Project` from `types.ts`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_paths: Option<Vec<String>>,
}

/// Mirrors `BoardColumn` from `types.ts`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ColumnRecord {
    pub id: String,
    pub title: String,
    pub color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_completed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wip_limit: Option<i64>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    pub tasks_written: i64,
    pub projects_written: i64,
    pub columns_written: i64,
    pub db_path: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotResult {
    pub tasks: Vec<TaskRecord>,
    pub projects: Vec<ProjectRecord>,
    pub columns: Vec<ColumnRecord>,
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Unable to resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
    Ok(dir.join(DB_FILE))
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS tasks (
            id                       TEXT PRIMARY KEY,
            job_id                   TEXT NOT NULL,
            project_id               TEXT NOT NULL,
            title                    TEXT NOT NULL,
            subtitle                 TEXT,
            summary                  TEXT NOT NULL,
            assignee                 TEXT NOT NULL,
            priority                 TEXT NOT NULL,
            status                   TEXT NOT NULL,
            created_at               TEXT NOT NULL,
            updated_at               TEXT,
            due_date                 TEXT,
            subtasks_json            TEXT NOT NULL DEFAULT '[]',
            attachments_json         TEXT NOT NULL DEFAULT '[]',
            custom_field_values_json TEXT,
            links_json               TEXT,
            tags_json                TEXT NOT NULL DEFAULT '[]',
            time_estimate            INTEGER NOT NULL DEFAULT 0,
            time_spent               INTEGER NOT NULL DEFAULT 0,
            recurring_json           TEXT,
            completed_at             TEXT,
            error_logs_json          TEXT,
            activity_json            TEXT,
            task_order               INTEGER,
            github_issue_json        TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

        CREATE TABLE IF NOT EXISTS projects (
            id                  TEXT PRIMARY KEY,
            name                TEXT NOT NULL,
            type                TEXT NOT NULL,
            icon                TEXT,
            parent_id           TEXT,
            pinned              INTEGER,
            project_order       INTEGER,
            workspace_paths_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_projects_parent_id ON projects(parent_id);

        CREATE TABLE IF NOT EXISTS board_columns (
            id            TEXT PRIMARY KEY,
            title         TEXT NOT NULL,
            color         TEXT NOT NULL,
            is_completed  INTEGER,
            wip_limit     INTEGER
        );

        CREATE TABLE IF NOT EXISTS task_events (
            seq        INTEGER PRIMARY KEY AUTOINCREMENT,
            id         TEXT NOT NULL UNIQUE,
            stream_id  TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload    TEXT NOT NULL,
            actor      TEXT NOT NULL,
            run_id     TEXT,
            ts         TEXT NOT NULL,
            v          INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_task_events_stream ON task_events(stream_id, seq);
        CREATE INDEX IF NOT EXISTS idx_task_events_type ON task_events(event_type, seq);
        ",
    )
    .map_err(|e| format!("Failed to init task store schema: {e}"))
}

// ---------------------------------------------------------------------------
// Task event log (live, append-only)
// ---------------------------------------------------------------------------

/// Wire shape for one event as sent by `taskEventStore.ts` (payload is an
/// opaque, pre-serialized JSON string — the log never interprets it).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskEventIn {
    pub id: String,
    pub stream_id: String,
    pub event_type: String,
    pub payload: String,
    pub actor: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    pub ts: String,
    #[serde(default = "default_event_version")]
    pub v: i64,
}

fn default_event_version() -> i64 {
    1
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskEventOut {
    pub seq: i64,
    pub id: String,
    pub stream_id: String,
    pub event_type: String,
    pub payload: String,
    pub actor: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    pub ts: String,
    pub v: i64,
}

fn validate_event(event: &TaskEventIn) -> Result<(), String> {
    if event.id.is_empty() || event.id.len() > 128 {
        return Err("Invalid event id".to_string());
    }
    if event.stream_id.is_empty() || event.stream_id.len() > 128 {
        return Err(format!("Invalid stream id on event {}", event.id));
    }
    if event.event_type.is_empty() || event.event_type.len() > 64 {
        return Err(format!("Invalid event type on event {}", event.id));
    }
    if event.payload.len() > 1_000_000 {
        return Err(format!("Event payload too large on event {}", event.id));
    }
    Ok(())
}

/// Append a batch atomically. Any invalid or duplicate event aborts the whole
/// batch (explicit transaction + rollback) so the log can never half-apply a
/// logical mutation.
fn append_events(conn: &mut Connection, events: &[TaskEventIn]) -> Result<Vec<i64>, String> {
    for event in events {
        validate_event(event)?;
    }
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to open event-log transaction: {e}"))?;
    let mut seqs = Vec::with_capacity(events.len());
    for event in events {
        tx.execute(
            "INSERT INTO task_events (id, stream_id, event_type, payload, actor, run_id, ts, v)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                event.id,
                event.stream_id,
                event.event_type,
                event.payload,
                event.actor,
                event.run_id,
                event.ts,
                event.v,
            ],
        )
        .map_err(|e| format!("Failed to append event {}: {e}", event.id))?;
        seqs.push(tx.last_insert_rowid());
    }
    tx.commit()
        .map_err(|e| format!("Failed to commit event batch: {e}"))?;
    Ok(seqs)
}

fn read_events(
    conn: &Connection,
    since_seq: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<TaskEventOut>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT seq, id, stream_id, event_type, payload, actor, run_id, ts, v
             FROM task_events WHERE seq > ?1 ORDER BY seq ASC LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            rusqlite::params![since_seq.unwrap_or(0), limit.unwrap_or(i64::MAX)],
            |row| {
                Ok(TaskEventOut {
                    seq: row.get(0)?,
                    id: row.get(1)?,
                    stream_id: row.get(2)?,
                    event_type: row.get(3)?,
                    payload: row.get(4)?,
                    actor: row.get(5)?,
                    run_id: row.get(6)?,
                    ts: row.get(7)?,
                    v: row.get(8)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn count_events(conn: &Connection) -> Result<i64, String> {
    conn.query_row("SELECT COUNT(*) FROM task_events", [], |row| row.get(0))
        .map_err(|e| e.to_string())
}

/// Serialize an `Option<T>` to a JSON string, or `None` when absent — used
/// for nullable nested-field columns so a missing field round-trips as SQL
/// NULL rather than the literal string "null".
fn opt_json<T: Serialize>(value: &Option<T>) -> Result<Option<String>, String> {
    match value {
        Some(v) => serde_json::to_string(v).map(Some).map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

fn opt_json_parse<T: for<'de> Deserialize<'de>>(raw: Option<String>) -> Result<Option<T>, String> {
    match raw {
        Some(s) => serde_json::from_str(&s).map(Some).map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

impl TaskStore {
    /// Lazily open (or reuse) the SQLite connection, matching
    /// `AgentdStore`'s lazy-start pattern — no `setup()` hook wiring needed.
    fn with_conn<T>(&self, app: &AppHandle, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
        let mut guard = self.conn.lock().map_err(|_| "task store lock poisoned".to_string())?;
        if guard.is_none() {
            let path = db_path(app)?;
            let conn = Connection::open(&path).map_err(|e| format!("Failed to open task store: {e}"))?;
            init_schema(&conn)?;
            *guard = Some(conn);
        }
        let conn = guard.as_ref().expect("just initialised");
        f(conn)
    }

    /// Mutable-connection variant for operations that need an explicit
    /// rusqlite transaction (the event log's atomic batch append).
    fn with_conn_mut<T>(
        &self,
        app: &AppHandle,
        f: impl FnOnce(&mut Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut guard = self.conn.lock().map_err(|_| "task store lock poisoned".to_string())?;
        if guard.is_none() {
            let path = db_path(app)?;
            let conn = Connection::open(&path).map_err(|e| format!("Failed to open task store: {e}"))?;
            init_schema(&conn)?;
            *guard = Some(conn);
        }
        let conn = guard.as_mut().expect("just initialised");
        f(conn)
    }

    pub fn export_snapshot(
        &self,
        app: &AppHandle,
        tasks: &[TaskRecord],
        projects: &[ProjectRecord],
        columns: &[ColumnRecord],
    ) -> Result<ExportSummary, String> {
        let path = db_path(app)?;
        self.with_conn(app, |conn| {
            for task in tasks {
                insert_task(conn, task)?;
            }
            for project in projects {
                insert_project(conn, project)?;
            }
            for column in columns {
                insert_column(conn, column)?;
            }
            Ok(())
        })?;

        Ok(ExportSummary {
            tasks_written: tasks.len() as i64,
            projects_written: projects.len() as i64,
            columns_written: columns.len() as i64,
            db_path: path.to_string_lossy().to_string(),
        })
    }

    pub fn read_snapshot(&self, app: &AppHandle) -> Result<SnapshotResult, String> {
        self.with_conn(app, |conn| {
            Ok(SnapshotResult {
                tasks: read_tasks(conn)?,
                projects: read_projects(conn)?,
                columns: read_columns(conn)?,
            })
        })
    }
}

fn insert_task(conn: &Connection, task: &TaskRecord) -> Result<(), String> {
    let subtasks_json = serde_json::to_string(&task.subtasks).map_err(|e| e.to_string())?;
    let attachments_json = serde_json::to_string(&task.attachments).map_err(|e| e.to_string())?;
    let tags_json = serde_json::to_string(&task.tags).map_err(|e| e.to_string())?;
    let custom_field_values_json = opt_json(&task.custom_field_values)?;
    let links_json = opt_json(&task.links)?;
    let recurring_json = opt_json(&task.recurring)?;
    let error_logs_json = opt_json(&task.error_logs)?;
    let activity_json = opt_json(&task.activity)?;
    let github_issue_json = opt_json(&task.github_issue)?;

    conn.execute(
        "INSERT INTO tasks (
            id, job_id, project_id, title, subtitle, summary, assignee, priority, status,
            created_at, updated_at, due_date, subtasks_json, attachments_json,
            custom_field_values_json, links_json, tags_json, time_estimate, time_spent,
            recurring_json, completed_at, error_logs_json, activity_json, task_order,
            github_issue_json
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18,
            ?19, ?20, ?21, ?22, ?23, ?24, ?25
        )
        ON CONFLICT(id) DO UPDATE SET
            job_id = excluded.job_id,
            project_id = excluded.project_id,
            title = excluded.title,
            subtitle = excluded.subtitle,
            summary = excluded.summary,
            assignee = excluded.assignee,
            priority = excluded.priority,
            status = excluded.status,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            due_date = excluded.due_date,
            subtasks_json = excluded.subtasks_json,
            attachments_json = excluded.attachments_json,
            custom_field_values_json = excluded.custom_field_values_json,
            links_json = excluded.links_json,
            tags_json = excluded.tags_json,
            time_estimate = excluded.time_estimate,
            time_spent = excluded.time_spent,
            recurring_json = excluded.recurring_json,
            completed_at = excluded.completed_at,
            error_logs_json = excluded.error_logs_json,
            activity_json = excluded.activity_json,
            task_order = excluded.task_order,
            github_issue_json = excluded.github_issue_json",
        rusqlite::params![
            task.id,
            task.job_id,
            task.project_id,
            task.title,
            task.subtitle,
            task.summary,
            task.assignee,
            task.priority,
            task.status,
            task.created_at,
            task.updated_at,
            task.due_date,
            subtasks_json,
            attachments_json,
            custom_field_values_json,
            links_json,
            tags_json,
            task.time_estimate,
            task.time_spent,
            recurring_json,
            task.completed_at,
            error_logs_json,
            activity_json,
            task.order,
            github_issue_json,
        ],
    )
    .map_err(|e| format!("Failed to insert task {}: {e}", task.id))?;
    Ok(())
}

fn insert_project(conn: &Connection, project: &ProjectRecord) -> Result<(), String> {
    let workspace_paths_json = opt_json(&project.workspace_paths)?;
    conn.execute(
        "INSERT INTO projects (
            id, name, type, icon, parent_id, pinned, project_order, workspace_paths_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            type = excluded.type,
            icon = excluded.icon,
            parent_id = excluded.parent_id,
            pinned = excluded.pinned,
            project_order = excluded.project_order,
            workspace_paths_json = excluded.workspace_paths_json",
        rusqlite::params![
            project.id,
            project.name,
            project.kind,
            project.icon,
            project.parent_id,
            project.pinned.map(|b| b as i64),
            project.order,
            workspace_paths_json,
        ],
    )
    .map_err(|e| format!("Failed to insert project {}: {e}", project.id))?;
    Ok(())
}

fn insert_column(conn: &Connection, column: &ColumnRecord) -> Result<(), String> {
    conn.execute(
        "INSERT INTO board_columns (id, title, color, is_completed, wip_limit)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            color = excluded.color,
            is_completed = excluded.is_completed,
            wip_limit = excluded.wip_limit",
        rusqlite::params![
            column.id,
            column.title,
            column.color,
            column.is_completed.map(|b| b as i64),
            column.wip_limit,
        ],
    )
    .map_err(|e| format!("Failed to insert column {}: {e}", column.id))?;
    Ok(())
}

fn read_tasks(conn: &Connection) -> Result<Vec<TaskRecord>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, job_id, project_id, title, subtitle, summary, assignee, priority, status,
                    created_at, updated_at, due_date, subtasks_json, attachments_json,
                    custom_field_values_json, links_json, tags_json, time_estimate, time_spent,
                    recurring_json, completed_at, error_logs_json, activity_json, task_order,
                    github_issue_json
             FROM tasks ORDER BY id ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
                row.get::<_, String>(12)?,
                row.get::<_, String>(13)?,
                row.get::<_, Option<String>>(14)?,
                row.get::<_, Option<String>>(15)?,
                row.get::<_, String>(16)?,
                row.get::<_, i64>(17)?,
                row.get::<_, i64>(18)?,
                row.get::<_, Option<String>>(19)?,
                row.get::<_, Option<String>>(20)?,
                row.get::<_, Option<String>>(21)?,
                row.get::<_, Option<String>>(22)?,
                row.get::<_, Option<i64>>(23)?,
                row.get::<_, Option<String>>(24)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        let (
            id,
            job_id,
            project_id,
            title,
            subtitle,
            summary,
            assignee,
            priority,
            status,
            created_at,
            updated_at,
            due_date,
            subtasks_json,
            attachments_json,
            custom_field_values_json,
            links_json,
            tags_json,
            time_estimate,
            time_spent,
            recurring_json,
            completed_at,
            error_logs_json,
            activity_json,
            task_order,
            github_issue_json,
        ) = row.map_err(|e| e.to_string())?;

        out.push(TaskRecord {
            id,
            job_id,
            project_id,
            title,
            subtitle,
            summary,
            assignee,
            priority,
            status,
            created_at,
            updated_at,
            due_date,
            subtasks: serde_json::from_str(&subtasks_json).map_err(|e| e.to_string())?,
            attachments: serde_json::from_str(&attachments_json).map_err(|e| e.to_string())?,
            custom_field_values: opt_json_parse(custom_field_values_json)?,
            links: opt_json_parse(links_json)?,
            tags: serde_json::from_str(&tags_json).map_err(|e| e.to_string())?,
            time_estimate,
            time_spent,
            recurring: opt_json_parse(recurring_json)?,
            completed_at,
            error_logs: opt_json_parse(error_logs_json)?,
            activity: opt_json_parse(activity_json)?,
            order: task_order,
            github_issue: opt_json_parse(github_issue_json)?,
        });
    }
    Ok(out)
}

fn read_projects(conn: &Connection) -> Result<Vec<ProjectRecord>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, type, icon, parent_id, pinned, project_order, workspace_paths_json
             FROM projects ORDER BY id ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<i64>>(5)?,
                row.get::<_, Option<i64>>(6)?,
                row.get::<_, Option<String>>(7)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        let (id, name, kind, icon, parent_id, pinned, order, workspace_paths_json) =
            row.map_err(|e| e.to_string())?;
        out.push(ProjectRecord {
            id,
            name,
            kind,
            icon,
            parent_id,
            pinned: pinned.map(|v| v != 0),
            order,
            workspace_paths: opt_json_parse(workspace_paths_json)?,
        });
    }
    Ok(out)
}

fn read_columns(conn: &Connection) -> Result<Vec<ColumnRecord>, String> {
    let mut stmt = conn
        .prepare("SELECT id, title, color, is_completed, wip_limit FROM board_columns ORDER BY id ASC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, Option<i64>>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        let (id, title, color, is_completed, wip_limit) = row.map_err(|e| e.to_string())?;
        out.push(ColumnRecord {
            id,
            title,
            color,
            is_completed: is_completed.map(|v| v != 0),
            wip_limit,
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Writes the given in-memory task/project/column lists into the additive
/// `tasks_export.sqlite3` store. Purely additive: never touches IndexedDB,
/// never touches any other SQLite file, and is not called from any live app
/// flow — it exists so a future cutover session can validate the schema
/// against real app data shapes.
#[tauri::command(rename_all = "camelCase")]
pub fn task_store_export_snapshot(
    app: AppHandle,
    store: tauri::State<'_, TaskStore>,
    tasks: Vec<TaskRecord>,
    projects: Vec<ProjectRecord>,
    columns: Vec<ColumnRecord>,
) -> Result<ExportSummary, String> {
    store.export_snapshot(&app, &tasks, &projects, &columns)
}

/// Reads back everything currently in the additive export store, for
/// verification purposes only.
#[tauri::command(rename_all = "camelCase")]
pub fn task_store_read_snapshot(app: AppHandle, store: tauri::State<'_, TaskStore>) -> Result<SnapshotResult, String> {
    store.read_snapshot(&app)
}

/// Append a batch of task events atomically. Returns the assigned sequence
/// numbers in input order. The whole batch fails on any invalid/duplicate
/// event — this is the transactional write-ahead step of every board mutation.
#[tauri::command(rename_all = "camelCase")]
pub fn task_events_append(
    app: AppHandle,
    store: tauri::State<'_, TaskStore>,
    events: Vec<TaskEventIn>,
) -> Result<Vec<i64>, String> {
    store.with_conn_mut(&app, |conn| append_events(conn, &events))
}

/// Read events after `since_seq` (exclusive), oldest first.
#[tauri::command(rename_all = "camelCase")]
pub fn task_events_read(
    app: AppHandle,
    store: tauri::State<'_, TaskStore>,
    since_seq: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<TaskEventOut>, String> {
    store.with_conn(&app, |conn| read_events(conn, since_seq, limit))
}

#[tauri::command(rename_all = "camelCase")]
pub fn task_events_count(
    app: AppHandle,
    store: tauri::State<'_, TaskStore>,
) -> Result<i64, String> {
    store.with_conn(&app, count_events)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Schema + read/write logic is exercised directly against an in-memory
    /// connection so these tests don't need a Tauri `AppHandle`.
    fn memory_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        init_schema(&conn).expect("init schema");
        conn
    }

    fn sample_event(id: &str, stream: &str) -> TaskEventIn {
        TaskEventIn {
            id: id.to_string(),
            stream_id: stream.to_string(),
            event_type: "task.updated".to_string(),
            payload: "{}".to_string(),
            actor: "user".to_string(),
            run_id: None,
            ts: "2026-07-06T00:00:00.000Z".to_string(),
            v: 1,
        }
    }

    #[test]
    fn event_append_assigns_monotonic_seqs() {
        let mut conn = memory_conn();
        let seqs = append_events(
            &mut conn,
            &[sample_event("e1", "t1"), sample_event("e2", "t1")],
        )
        .expect("append");
        assert_eq!(seqs, vec![1, 2]);
        let read = read_events(&conn, None, None).expect("read");
        assert_eq!(read.len(), 2);
        assert_eq!(read[0].id, "e1");
        assert_eq!(read[1].seq, 2);
        assert_eq!(count_events(&conn).expect("count"), 2);
    }

    #[test]
    fn event_append_is_atomic_on_duplicate() {
        let mut conn = memory_conn();
        append_events(&mut conn, &[sample_event("e1", "t1")]).expect("seed");
        // Second batch contains a duplicate id — the WHOLE batch must roll back.
        let result = append_events(
            &mut conn,
            &[sample_event("e2", "t1"), sample_event("e1", "t1")],
        );
        assert!(result.is_err());
        assert_eq!(count_events(&conn).expect("count"), 1);
    }

    #[test]
    fn event_read_since_seq_is_exclusive() {
        let mut conn = memory_conn();
        append_events(
            &mut conn,
            &[
                sample_event("e1", "t1"),
                sample_event("e2", "t1"),
                sample_event("e3", "t2"),
            ],
        )
        .expect("append");
        let tail = read_events(&conn, Some(1), None).expect("read");
        assert_eq!(tail.len(), 2);
        assert_eq!(tail[0].id, "e2");
    }

    #[test]
    fn event_validation_rejects_bad_input() {
        let mut conn = memory_conn();
        let mut bad = sample_event("", "t1");
        assert!(append_events(&mut conn, &[bad.clone()]).is_err());
        bad = sample_event("e1", "");
        assert!(append_events(&mut conn, &[bad]).is_err());
        assert_eq!(count_events(&conn).expect("count"), 0);
    }

    fn sample_task_minimal() -> TaskRecord {
        TaskRecord {
            id: "task-1".to_string(),
            job_id: "JOB-1".to_string(),
            project_id: "proj-1".to_string(),
            title: "Minimal task".to_string(),
            subtitle: None,
            summary: "A bare-bones task".to_string(),
            assignee: "alice".to_string(),
            priority: "medium".to_string(),
            status: "todo".to_string(),
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
            updated_at: None,
            due_date: None,
            subtasks: vec![],
            attachments: vec![],
            custom_field_values: None,
            links: None,
            tags: vec![],
            time_estimate: 0,
            time_spent: 0,
            recurring: None,
            completed_at: None,
            error_logs: None,
            activity: None,
            order: None,
            github_issue: None,
        }
    }

    fn sample_task_full() -> TaskRecord {
        TaskRecord {
            id: "task-2".to_string(),
            job_id: "JOB-2".to_string(),
            project_id: "proj-1".to_string(),
            title: "Full task".to_string(),
            subtitle: Some("with everything".to_string()),
            summary: "A task exercising every nested field".to_string(),
            assignee: "bob".to_string(),
            priority: "high".to_string(),
            status: "in-progress".to_string(),
            created_at: "2026-01-02T00:00:00.000Z".to_string(),
            updated_at: Some("2026-01-03T00:00:00.000Z".to_string()),
            due_date: Some("2026-01-10T00:00:00.000Z".to_string()),
            subtasks: vec![
                SubtaskRecord { id: "sub-1".to_string(), title: "Step 1".to_string(), completed: true },
                SubtaskRecord { id: "sub-2".to_string(), title: "Step 2".to_string(), completed: false },
            ],
            attachments: vec![
                AttachmentRecord {
                    id: "att-1".to_string(),
                    name: "spec.pdf".to_string(),
                    url: "file:///spec.pdf".to_string(),
                    kind: "file".to_string(),
                },
                AttachmentRecord {
                    id: "att-2".to_string(),
                    name: "design doc".to_string(),
                    url: "https://example.com/design".to_string(),
                    kind: "link".to_string(),
                },
            ],
            custom_field_values: Some(serde_json::json!({ "storyPoints": 5, "team": "core" })),
            links: Some(vec![
                TaskLinkRecord { target_task_id: "task-9".to_string(), kind: "blocks".to_string() },
                TaskLinkRecord { target_task_id: "task-10".to_string(), kind: "relates-to".to_string() },
            ]),
            tags: vec!["backend".to_string(), "urgent".to_string()],
            time_estimate: 120,
            time_spent: 45,
            recurring: Some(RecurringConfigRecord {
                enabled: true,
                frequency: "weekly".to_string(),
                interval: 2,
                days_of_week: Some(vec![1, 3, 5]),
                day_of_month: None,
                end_date: Some("2026-06-01T00:00:00.000Z".to_string()),
                next_occurrence: Some("2026-01-17T00:00:00.000Z".to_string()),
            }),
            completed_at: None,
            error_logs: Some(vec![ErrorLogRecord {
                timestamp: "2026-01-04T00:00:00.000Z".to_string(),
                message: "agent run failed".to_string(),
            }]),
            activity: Some(vec![ActivityItemRecord {
                id: "act-1".to_string(),
                kind: "update".to_string(),
                timestamp: "2026-01-05T00:00:00.000Z".to_string(),
                user_id: "user".to_string(),
                details: "changed priority".to_string(),
                field: Some("priority".to_string()),
                old_value: Some(serde_json::json!("low")),
                new_value: Some(serde_json::json!("high")),
            }]),
            order: Some(3),
            github_issue: Some(GithubIssueRecord {
                owner: "acme".to_string(),
                repo: "widgets".to_string(),
                number: 42,
                url: "https://github.com/acme/widgets/issues/42".to_string(),
            }),
        }
    }

    fn sample_project() -> ProjectRecord {
        ProjectRecord {
            id: "proj-1".to_string(),
            name: "Core Platform".to_string(),
            kind: "engineering".to_string(),
            icon: Some("rocket".to_string()),
            parent_id: None,
            pinned: Some(true),
            order: Some(1),
            workspace_paths: Some(vec!["/Users/bharath/Code/LiquiTask".to_string()]),
        }
    }

    fn sample_project_minimal() -> ProjectRecord {
        ProjectRecord {
            id: "proj-2".to_string(),
            name: "Side Project".to_string(),
            kind: "personal".to_string(),
            icon: None,
            parent_id: Some("proj-1".to_string()),
            pinned: None,
            order: None,
            workspace_paths: None,
        }
    }

    fn sample_column() -> ColumnRecord {
        ColumnRecord {
            id: "col-1".to_string(),
            title: "In Progress".to_string(),
            color: "#00ff00".to_string(),
            is_completed: Some(false),
            wip_limit: Some(5),
        }
    }

    fn sample_column_minimal() -> ColumnRecord {
        ColumnRecord {
            id: "col-2".to_string(),
            title: "Done".to_string(),
            color: "#888888".to_string(),
            is_completed: None,
            wip_limit: None,
        }
    }

    #[test]
    fn schema_creates_all_tables() {
        let conn = memory_conn();
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap();
        let names: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(names.contains(&"tasks".to_string()));
        assert!(names.contains(&"projects".to_string()));
        assert!(names.contains(&"board_columns".to_string()));
    }

    #[test]
    fn round_trips_minimal_task() {
        let conn = memory_conn();
        let task = sample_task_minimal();
        insert_task(&conn, &task).unwrap();
        let tasks = read_tasks(&conn).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0], task);
    }

    #[test]
    fn round_trips_full_task_with_nested_fields() {
        let conn = memory_conn();
        let task = sample_task_full();
        insert_task(&conn, &task).unwrap();
        let tasks = read_tasks(&conn).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0], task);

        // Spot-check nested structures decode to equivalent values, not just
        // that the outer struct derives Eq correctly.
        assert_eq!(tasks[0].subtasks.len(), 2);
        assert_eq!(tasks[0].subtasks[0].title, "Step 1");
        assert!(tasks[0].subtasks[0].completed);
        assert_eq!(tasks[0].attachments.len(), 2);
        assert_eq!(tasks[0].attachments[1].kind, "link");
        assert_eq!(
            tasks[0].custom_field_values.as_ref().unwrap()["storyPoints"],
            serde_json::json!(5)
        );
        assert_eq!(tasks[0].links.as_ref().unwrap()[0].target_task_id, "task-9");
        assert_eq!(tasks[0].tags, vec!["backend".to_string(), "urgent".to_string()]);
        assert_eq!(tasks[0].recurring.as_ref().unwrap().days_of_week, Some(vec![1, 3, 5]));
        assert_eq!(tasks[0].error_logs.as_ref().unwrap()[0].message, "agent run failed");
        assert_eq!(tasks[0].activity.as_ref().unwrap()[0].field, Some("priority".to_string()));
        assert_eq!(tasks[0].github_issue.as_ref().unwrap().number, 42);
    }

    #[test]
    fn round_trips_projects_full_and_minimal() {
        let conn = memory_conn();
        let full = sample_project();
        let minimal = sample_project_minimal();
        insert_project(&conn, &full).unwrap();
        insert_project(&conn, &minimal).unwrap();
        let projects = read_projects(&conn).unwrap();
        assert_eq!(projects.len(), 2);
        assert_eq!(projects[0], full);
        assert_eq!(projects[1], minimal);
        assert_eq!(
            projects[0].workspace_paths.as_ref().unwrap()[0],
            "/Users/bharath/Code/LiquiTask"
        );
    }

    #[test]
    fn round_trips_columns_full_and_minimal() {
        let conn = memory_conn();
        let full = sample_column();
        let minimal = sample_column_minimal();
        insert_column(&conn, &full).unwrap();
        insert_column(&conn, &minimal).unwrap();
        let columns = read_columns(&conn).unwrap();
        assert_eq!(columns.len(), 2);
        assert_eq!(columns[0], full);
        assert_eq!(columns[1], minimal);
    }

    #[test]
    fn upsert_on_conflict_overwrites_task_in_place() {
        let conn = memory_conn();
        let mut task = sample_task_minimal();
        insert_task(&conn, &task).unwrap();
        task.title = "Updated title".to_string();
        task.tags = vec!["updated".to_string()];
        insert_task(&conn, &task).unwrap();

        let tasks = read_tasks(&conn).unwrap();
        assert_eq!(tasks.len(), 1, "conflicting id must upsert, not duplicate");
        assert_eq!(tasks[0].title, "Updated title");
        assert_eq!(tasks[0].tags, vec!["updated".to_string()]);
    }

    #[test]
    fn export_summary_and_full_snapshot_round_trip_via_task_store() {
        // Exercise the TaskStore struct itself (not just the free insert/read
        // helpers) against an in-memory-equivalent Connection stashed
        // directly into the Mutex, bypassing the AppHandle-dependent
        // db_path() lookup.
        let store = TaskStore::default();
        {
            let conn = memory_conn();
            *store.conn.lock().unwrap() = Some(conn);
        }

        let tasks = vec![sample_task_minimal(), sample_task_full()];
        let projects = vec![sample_project(), sample_project_minimal()];
        let columns = vec![sample_column(), sample_column_minimal()];

        // export_snapshot() takes an AppHandle to compute db_path for the
        // summary; since with_conn() only calls db_path() when the guard is
        // empty (already populated above), and the summary's db_path field
        // is derived separately, we instead call db_path-independent pieces
        // directly here to keep the test AppHandle-free.
        let guard = store.conn.lock().unwrap();
        let conn = guard.as_ref().unwrap();
        for t in &tasks {
            insert_task(conn, t).unwrap();
        }
        for p in &projects {
            insert_project(conn, p).unwrap();
        }
        for c in &columns {
            insert_column(conn, c).unwrap();
        }
        drop(guard);

        let guard = store.conn.lock().unwrap();
        let conn = guard.as_ref().unwrap();
        let read_back_tasks = read_tasks(conn).unwrap();
        let read_back_projects = read_projects(conn).unwrap();
        let read_back_columns = read_columns(conn).unwrap();
        drop(guard);

        assert_eq!(read_back_tasks.len(), 2);
        assert_eq!(read_back_projects.len(), 2);
        assert_eq!(read_back_columns.len(), 2);
        assert!(read_back_tasks.contains(&tasks[0]));
        assert!(read_back_tasks.contains(&tasks[1]));
    }

    #[test]
    fn empty_snapshot_round_trips_to_empty_lists() {
        let conn = memory_conn();
        assert_eq!(read_tasks(&conn).unwrap().len(), 0);
        assert_eq!(read_projects(&conn).unwrap().len(), 0);
        assert_eq!(read_columns(&conn).unwrap().len(), 0);
    }
}
