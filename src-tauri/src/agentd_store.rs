//! SQLite index for agentd runs/events/agents (Rework Plan §3.3).
//!
//! Deliberately separate from `run_store.rs`, which stays a file-based journal
//! for the legacy claude-only `agent_runner.rs` path. This module is the
//! queryable local store the new agentd-routed runs write into as events
//! stream in over the JSON-RPC bridge (`agentd.rs`), so later phases (Inbox,
//! Agents surface, DevCouncil evidence graph) have one place to query run
//! history without re-parsing NDJSON logs.

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

const DB_FILE: &str = "agentd.sqlite3";

pub struct AgentdStore {
    conn: Mutex<Option<Connection>>,
}

impl Default for AgentdStore {
    fn default() -> Self {
        Self { conn: Mutex::new(None) }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredRun {
    pub run_id: String,
    pub task_id: String,
    pub runtime: String,
    pub model: Option<String>,
    pub cwd: Option<String>,
    pub status: String,
    pub started_at_ms: i64,
    pub finished_at_ms: Option<i64>,
    pub session_id: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredRunEvent {
    pub id: i64,
    pub run_id: String,
    pub kind: String,
    pub payload_json: String,
    pub ts_ms: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredAgent {
    pub id: String,
    pub name: String,
    pub binary: String,
    pub path: Option<String>,
    pub version: Option<String>,
    pub ready: bool,
    pub last_detected_at_ms: i64,
}

/// Mirrored row shapes for the DevCouncil evidence graph (Rework Plan §3.4
/// item 4). These are LiquiTask's own copies, upserted from DevCouncil's
/// `.devcouncil/state.db` by `agent_devcouncil_evidence::mirror_evidence_graph` —
/// kept here (not in that module) so they live next to the schema that owns
/// them, matching this file's existing `Stored*` convention.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredDevCouncilRequirement {
    pub id: String,
    pub title: String,
    pub description: String,
    pub priority: Option<String>,
    pub source: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredDevCouncilTask {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: Option<String>,
    pub requirement_ids_json: Option<String>,
    pub planned_files_json: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredDevCouncilEvidence {
    pub id: i64,
    pub kind: String,
    pub task_id: Option<String>,
    pub requirement_id: Option<String>,
    pub data_json: Option<String>,
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
        CREATE TABLE IF NOT EXISTS runs (
            run_id          TEXT PRIMARY KEY,
            task_id         TEXT NOT NULL,
            runtime         TEXT NOT NULL,
            model           TEXT,
            cwd             TEXT,
            status          TEXT NOT NULL,
            started_at_ms   INTEGER NOT NULL,
            finished_at_ms  INTEGER,
            exit_code       INTEGER,
            session_id      TEXT,
            duration_ms     INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_runs_task_id ON runs(task_id);
        CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

        CREATE TABLE IF NOT EXISTS run_events (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id       TEXT NOT NULL,
            kind         TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            ts_ms        INTEGER NOT NULL,
            FOREIGN KEY (run_id) REFERENCES runs(run_id)
        );
        CREATE INDEX IF NOT EXISTS idx_run_events_run_id ON run_events(run_id);

        CREATE TABLE IF NOT EXISTS agents (
            id                  TEXT PRIMARY KEY,
            name                TEXT NOT NULL,
            binary              TEXT NOT NULL,
            path                TEXT,
            version             TEXT,
            ready               INTEGER NOT NULL,
            last_detected_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS devcouncil_requirements (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            description TEXT NOT NULL,
            priority    TEXT,
            source      TEXT
        );

        CREATE TABLE IF NOT EXISTS devcouncil_tasks (
            id                     TEXT PRIMARY KEY,
            title                  TEXT NOT NULL,
            description            TEXT NOT NULL,
            status                 TEXT,
            requirement_ids_json   TEXT,
            planned_files_json     TEXT
        );

        CREATE TABLE IF NOT EXISTS devcouncil_evidence (
            id             INTEGER PRIMARY KEY,
            kind           TEXT NOT NULL,
            task_id        TEXT,
            requirement_id TEXT,
            data_json      TEXT
        );
        ",
    )
    .map_err(|e| format!("Failed to init agentd store schema: {e}"))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl AgentdStore {
    /// Lazily open (or reuse) the SQLite connection, matching `AgentdState`'s
    /// lazy-start pattern — no `setup()` hook wiring needed.
    fn with_conn<T>(&self, app: &AppHandle, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
        let mut guard = self.conn.lock().map_err(|_| "agentd store lock poisoned".to_string())?;
        if guard.is_none() {
            let path = db_path(app)?;
            let conn = Connection::open(&path).map_err(|e| format!("Failed to open agentd store: {e}"))?;
            init_schema(&conn)?;
            *guard = Some(conn);
        }
        let conn = guard.as_ref().expect("just initialised");
        f(conn)
    }

    pub fn record_run_start(
        &self,
        app: &AppHandle,
        run_id: &str,
        task_id: &str,
        runtime: &str,
        model: Option<&str>,
        cwd: Option<&str>,
    ) -> Result<(), String> {
        self.with_conn(app, |conn| {
            conn.execute(
                "INSERT OR REPLACE INTO runs (run_id, task_id, runtime, model, cwd, status, started_at_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6)",
                rusqlite::params![run_id, task_id, runtime, model, cwd, now_ms()],
            )
            .map_err(|e| format!("Failed to record run start: {e}"))?;
            Ok(())
        })
    }

    /// Append a streamed event and, for terminal `result` events, finalize the
    /// run row (status/session/duration) in the same call.
    pub fn record_event(&self, app: &AppHandle, run_id: &str, kind: &str, payload: &Value) -> Result<(), String> {
        self.with_conn(app, |conn| {
            let payload_json = serde_json::to_string(payload).unwrap_or_else(|_| "{}".to_string());
            conn.execute(
                "INSERT INTO run_events (run_id, kind, payload_json, ts_ms) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![run_id, kind, payload_json, now_ms()],
            )
            .map_err(|e| format!("Failed to record run event: {e}"))?;

            if kind == "result" {
                let status = payload
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("completed")
                    .to_string();
                let session_id = payload.get("sessionId").and_then(Value::as_str);
                let duration_ms = payload.get("durationMs").and_then(Value::as_i64);
                conn.execute(
                    "UPDATE runs SET status = ?1, finished_at_ms = ?2, session_id = COALESCE(?3, session_id), duration_ms = ?4
                     WHERE run_id = ?5",
                    rusqlite::params![status, now_ms(), session_id, duration_ms, run_id],
                )
                .map_err(|e| format!("Failed to finalize run: {e}"))?;
            }
            Ok(())
        })
    }

    pub fn upsert_agent(
        &self,
        app: &AppHandle,
        id: &str,
        name: &str,
        binary: &str,
        path: Option<&str>,
        version: Option<&str>,
        ready: bool,
    ) -> Result<(), String> {
        self.with_conn(app, |conn| {
            conn.execute(
                "INSERT INTO agents (id, name, binary, path, version, ready, last_detected_at_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name, binary = excluded.binary, path = excluded.path,
                    version = excluded.version, ready = excluded.ready,
                    last_detected_at_ms = excluded.last_detected_at_ms",
                rusqlite::params![id, name, binary, path, version, ready as i64, now_ms()],
            )
            .map_err(|e| format!("Failed to upsert agent: {e}"))?;
            Ok(())
        })
    }

    pub fn list_runs(&self, app: &AppHandle, limit: i64) -> Result<Vec<StoredRun>, String> {
        self.with_conn(app, |conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT run_id, task_id, runtime, model, cwd, status, started_at_ms, finished_at_ms, session_id
                     FROM runs ORDER BY started_at_ms DESC LIMIT ?1",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(rusqlite::params![limit], |row| {
                    Ok(StoredRun {
                        run_id: row.get(0)?,
                        task_id: row.get(1)?,
                        runtime: row.get(2)?,
                        model: row.get(3)?,
                        cwd: row.get(4)?,
                        status: row.get(5)?,
                        started_at_ms: row.get(6)?,
                        finished_at_ms: row.get(7)?,
                        session_id: row.get(8)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
        })
    }

    pub fn list_run_events(&self, app: &AppHandle, run_id: &str) -> Result<Vec<StoredRunEvent>, String> {
        self.with_conn(app, |conn| {
            let mut stmt = conn
                .prepare("SELECT id, run_id, kind, payload_json, ts_ms FROM run_events WHERE run_id = ?1 ORDER BY id ASC")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(rusqlite::params![run_id], |row| {
                    Ok(StoredRunEvent {
                        id: row.get(0)?,
                        run_id: row.get(1)?,
                        kind: row.get(2)?,
                        payload_json: row.get(3)?,
                        ts_ms: row.get(4)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
        })
    }

    pub fn list_agents(&self, app: &AppHandle) -> Result<Vec<StoredAgent>, String> {
        self.with_conn(app, |conn| {
            let mut stmt = conn
                .prepare("SELECT id, name, binary, path, version, ready, last_detected_at_ms FROM agents ORDER BY name ASC")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(StoredAgent {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        binary: row.get(2)?,
                        path: row.get(3)?,
                        version: row.get(4)?,
                        ready: row.get::<_, i64>(5)? != 0,
                        last_detected_at_ms: row.get(6)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
        })
    }

    // -----------------------------------------------------------------
    // DevCouncil evidence-graph mirror (Rework Plan §3.4 item 4)
    // -----------------------------------------------------------------

    pub fn upsert_devcouncil_requirement(
        &self,
        app: &AppHandle,
        id: &str,
        title: &str,
        description: &str,
        priority: Option<&str>,
        source: Option<&str>,
    ) -> Result<(), String> {
        self.with_conn(app, |conn| {
            conn.execute(
                "INSERT INTO devcouncil_requirements (id, title, description, priority, source)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title, description = excluded.description,
                    priority = excluded.priority, source = excluded.source",
                rusqlite::params![id, title, description, priority, source],
            )
            .map_err(|e| format!("Failed to upsert devcouncil requirement: {e}"))?;
            Ok(())
        })
    }

    pub fn upsert_devcouncil_task(
        &self,
        app: &AppHandle,
        id: &str,
        title: &str,
        description: &str,
        status: Option<&str>,
        requirement_ids_json: Option<&str>,
        planned_files_json: Option<&str>,
    ) -> Result<(), String> {
        self.with_conn(app, |conn| {
            conn.execute(
                "INSERT INTO devcouncil_tasks (id, title, description, status, requirement_ids_json, planned_files_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET
                    title = excluded.title, description = excluded.description, status = excluded.status,
                    requirement_ids_json = excluded.requirement_ids_json,
                    planned_files_json = excluded.planned_files_json",
                rusqlite::params![id, title, description, status, requirement_ids_json, planned_files_json],
            )
            .map_err(|e| format!("Failed to upsert devcouncil task: {e}"))?;
            Ok(())
        })
    }

    pub fn upsert_devcouncil_evidence(
        &self,
        app: &AppHandle,
        id: i64,
        kind: &str,
        task_id: Option<&str>,
        requirement_id: Option<&str>,
        data_json: Option<&str>,
    ) -> Result<(), String> {
        self.with_conn(app, |conn| {
            conn.execute(
                "INSERT INTO devcouncil_evidence (id, kind, task_id, requirement_id, data_json)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(id) DO UPDATE SET
                    kind = excluded.kind, task_id = excluded.task_id,
                    requirement_id = excluded.requirement_id, data_json = excluded.data_json",
                rusqlite::params![id, kind, task_id, requirement_id, data_json],
            )
            .map_err(|e| format!("Failed to upsert devcouncil evidence: {e}"))?;
            Ok(())
        })
    }

    pub fn list_devcouncil_requirements(&self, app: &AppHandle) -> Result<Vec<StoredDevCouncilRequirement>, String> {
        self.with_conn(app, |conn| {
            let mut stmt = conn
                .prepare("SELECT id, title, description, priority, source FROM devcouncil_requirements ORDER BY id ASC")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(StoredDevCouncilRequirement {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        description: row.get(2)?,
                        priority: row.get(3)?,
                        source: row.get(4)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
        })
    }

    pub fn list_devcouncil_tasks(&self, app: &AppHandle) -> Result<Vec<StoredDevCouncilTask>, String> {
        self.with_conn(app, |conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT id, title, description, status, requirement_ids_json, planned_files_json
                     FROM devcouncil_tasks ORDER BY id ASC",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(StoredDevCouncilTask {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        description: row.get(2)?,
                        status: row.get(3)?,
                        requirement_ids_json: row.get(4)?,
                        planned_files_json: row.get(5)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
        })
    }

    pub fn list_devcouncil_evidence(&self, app: &AppHandle) -> Result<Vec<StoredDevCouncilEvidence>, String> {
        self.with_conn(app, |conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT id, kind, task_id, requirement_id, data_json
                     FROM devcouncil_evidence ORDER BY id ASC",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(StoredDevCouncilEvidence {
                        id: row.get(0)?,
                        kind: row.get(1)?,
                        task_id: row.get(2)?,
                        requirement_id: row.get(3)?,
                        data_json: row.get(4)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
        })
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_store_list_runs(app: AppHandle, store: tauri::State<'_, AgentdStore>, limit: Option<i64>) -> Result<Vec<StoredRun>, String> {
    store.list_runs(&app, limit.unwrap_or(200))
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_store_list_run_events(
    app: AppHandle,
    store: tauri::State<'_, AgentdStore>,
    run_id: String,
) -> Result<Vec<StoredRunEvent>, String> {
    store.list_run_events(&app, &run_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_store_list_agents(app: AppHandle, store: tauri::State<'_, AgentdStore>) -> Result<Vec<StoredAgent>, String> {
    store.list_agents(&app)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_store_list_devcouncil_requirements(
    app: AppHandle,
    store: tauri::State<'_, AgentdStore>,
) -> Result<Vec<StoredDevCouncilRequirement>, String> {
    store.list_devcouncil_requirements(&app)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_store_list_devcouncil_tasks(
    app: AppHandle,
    store: tauri::State<'_, AgentdStore>,
) -> Result<Vec<StoredDevCouncilTask>, String> {
    store.list_devcouncil_tasks(&app)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_store_list_devcouncil_evidence(
    app: AppHandle,
    store: tauri::State<'_, AgentdStore>,
) -> Result<Vec<StoredDevCouncilEvidence>, String> {
    store.list_devcouncil_evidence(&app)
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

    #[test]
    fn records_run_start_and_lists_it() {
        let conn = memory_conn();
        conn.execute(
            "INSERT INTO runs (run_id, task_id, runtime, model, cwd, status, started_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6)",
            rusqlite::params!["r1", "t1", "claude", Some("opus"), Option::<&str>::None, 1000i64],
        )
        .unwrap();
        let mut stmt = conn.prepare("SELECT run_id, status FROM runs WHERE run_id = 'r1'").unwrap();
        let (run_id, status): (String, String) = stmt.query_row([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(run_id, "r1");
        assert_eq!(status, "running");
    }

    #[test]
    fn result_event_finalizes_run_status_and_session() {
        let conn = memory_conn();
        conn.execute(
            "INSERT INTO runs (run_id, task_id, runtime, status, started_at_ms) VALUES ('r1', 't1', 'claude', 'running', 1000)",
            [],
        )
        .unwrap();
        let payload = serde_json::json!({ "status": "completed", "sessionId": "sess-1", "durationMs": 4200 });
        conn.execute(
            "INSERT INTO run_events (run_id, kind, payload_json, ts_ms) VALUES ('r1', 'result', ?1, 2000)",
            rusqlite::params![payload.to_string()],
        )
        .unwrap();
        conn.execute(
            "UPDATE runs SET status = ?1, finished_at_ms = ?2, session_id = COALESCE(?3, session_id), duration_ms = ?4 WHERE run_id = 'r1'",
            rusqlite::params!["completed", 2000i64, Some("sess-1"), Some(4200i64)],
        )
        .unwrap();
        let mut stmt = conn
            .prepare("SELECT status, session_id, duration_ms FROM runs WHERE run_id = 'r1'")
            .unwrap();
        let (status, session_id, duration_ms): (String, String, i64) =
            stmt.query_row([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!(status, "completed");
        assert_eq!(session_id, "sess-1");
        assert_eq!(duration_ms, 4200);
    }

    #[test]
    fn upserts_agent_on_conflict() {
        let conn = memory_conn();
        let upsert = |ready: i64| {
            conn.execute(
                "INSERT INTO agents (id, name, binary, path, version, ready, last_detected_at_ms) VALUES ('claude', 'Claude Code', 'claude', '/usr/bin/claude', '1.0.0', ?1, 1000)
                 ON CONFLICT(id) DO UPDATE SET ready = excluded.ready, last_detected_at_ms = excluded.last_detected_at_ms",
                rusqlite::params![ready],
            )
            .unwrap();
        };
        upsert(1);
        upsert(0);
        let mut stmt = conn.prepare("SELECT COUNT(*), ready FROM agents").unwrap();
        let (count, ready): (i64, i64) = stmt.query_row([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(count, 1, "upsert must not create duplicate rows");
        assert_eq!(ready, 0);
    }

    #[test]
    fn devcouncil_requirement_upsert_is_idempotent() {
        let conn = memory_conn();
        let upsert = |title: &str| {
            conn.execute(
                "INSERT INTO devcouncil_requirements (id, title, description, priority, source)
                 VALUES ('REQ-1', ?1, 'desc', 'high', 'user')
                 ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description,
                    priority = excluded.priority, source = excluded.source",
                rusqlite::params![title],
            )
            .unwrap();
        };
        upsert("First title");
        upsert("Updated title");
        let mut stmt = conn.prepare("SELECT COUNT(*), title FROM devcouncil_requirements").unwrap();
        let (count, title): (i64, String) = stmt.query_row([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(count, 1, "upsert must not create duplicate requirement rows");
        assert_eq!(title, "Updated title");
    }

    #[test]
    fn devcouncil_task_and_evidence_roundtrip() {
        let conn = memory_conn();
        conn.execute(
            "INSERT INTO devcouncil_tasks (id, title, description, status, requirement_ids_json, planned_files_json)
             VALUES ('TASK-1', 'Do it', 'desc', 'planned', '[\"REQ-1\"]', '[]')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO devcouncil_evidence (id, kind, task_id, requirement_id, data_json)
             VALUES (1, 'command', 'TASK-1', 'REQ-1', '{\"exit_code\":0}')",
            [],
        )
        .unwrap();

        let mut task_stmt = conn.prepare("SELECT id, status FROM devcouncil_tasks WHERE id = 'TASK-1'").unwrap();
        let (task_id, status): (String, String) =
            task_stmt.query_row([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(task_id, "TASK-1");
        assert_eq!(status, "planned");

        let mut ev_stmt = conn.prepare("SELECT kind, task_id FROM devcouncil_evidence WHERE id = 1").unwrap();
        let (kind, ev_task_id): (String, String) = ev_stmt.query_row([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(kind, "command");
        assert_eq!(ev_task_id, "TASK-1");
    }
}
