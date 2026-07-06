//! In-process semantic layer for local Ollama routing, caching, and compression.
//!
//! Core pipeline logic runs in Rust. Python sidecar spawn is retained only when
//! `LIQUITASK_USE_PYTHON=1` or as a dev fallback; the default path uses Tauri
//! commands from the frontend.

mod cache;
mod compressor;
mod config;
mod embedder;
mod ollama;
mod ood;
mod orchestrator;
mod router;

pub use config::SemanticLayerConfig;
pub use orchestrator::{PipelineMetrics, SemanticOrchestrator};

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::State;

use config::ModelTier;
use orchestrator::PipelineResult;

const ENGINE_VERSION: &str = "1.0.0";

pub struct SemanticLayerState(pub tokio::sync::Mutex<Option<SemanticOrchestrator>>);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticLayerSpawnArgs {
    pub port: Option<u16>,
    pub ollama_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticLayerChatRequest {
    pub prompt: String,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default)]
    pub rag_documents: Vec<RagDocument>,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    #[serde(default)]
    pub tools_version: String,
    #[serde(default = "default_doc_version")]
    pub doc_version: String,
    pub ollama_base_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RagDocument {
    pub id: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticLayerChatResponse {
    pub text: String,
    pub cache_entry_id: Option<String>,
    pub cache_hit: bool,
    pub model_used: String,
    pub metrics: PipelineMetrics,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticLayerConfigUpdate {
    pub cache_initial_threshold: Option<f32>,
    pub cache_max_entries: Option<usize>,
    pub enable_cache: Option<bool>,
    pub enable_compression: Option<bool>,
    pub small_model: Option<String>,
    pub medium_model: Option<String>,
    pub large_model: Option<String>,
    pub ollama_base_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticLayerFeedbackRequest {
    pub entry_id: String,
    pub accepted: bool,
    #[serde(default = "default_similarity")]
    pub similarity: f32,
}

fn default_temperature() -> f32 {
    0.4
}

fn default_max_tokens() -> u32 {
    2048
}

fn default_doc_version() -> String {
    "v1".to_string()
}

fn default_similarity() -> f32 {
    1.0
}

fn default_ollama_url() -> String {
    "http://127.0.0.1:11434".to_string()
}

fn with_engine<T>(
    state: &State<'_, SemanticLayerState>,
    f: impl FnOnce(&mut SemanticOrchestrator) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state.0.blocking_lock();
    let engine = guard
        .as_mut()
        .ok_or_else(|| "Semantic layer is not running. Call semantic_layer_spawn first.".to_string())?;
    f(engine)
}

#[tauri::command]
pub fn semantic_layer_spawn(
    state: State<'_, SemanticLayerState>,
    port: Option<u16>,
    ollama_url: Option<String>,
) -> Result<(), String> {
    let _port = port.unwrap_or(8765);
    let ollama = ollama_url.unwrap_or_else(default_ollama_url);

    if std::env::var("LIQUITASK_USE_PYTHON").is_ok() {
        return spawn_python_fallback(_port, &ollama);
    }

    let mut guard = state.0.blocking_lock();
    if guard.is_some() {
        return Ok(());
    }

    *guard = Some(SemanticOrchestrator::new(SemanticLayerConfig::default(), ollama));
    Ok(())
}

#[tauri::command]
pub fn semantic_layer_stop(state: State<'_, SemanticLayerState>) -> Result<(), String> {
    let mut guard = state.0.blocking_lock();
    if let Some(engine) = guard.take() {
        let _ = engine.save_state();
    }
    Ok(())
}

#[tauri::command]
pub fn semantic_layer_health(state: State<'_, SemanticLayerState>) -> Result<serde_json::Value, String> {
    let running = state.0.blocking_lock().is_some();
    Ok(serde_json::json!({
        "status": if running { "ok" } else { "off" },
        "version": ENGINE_VERSION,
        "runtime": "rust",
    }))
}

#[tauri::command]
pub async fn semantic_layer_chat(
    state: State<'_, SemanticLayerState>,
    request: SemanticLayerChatRequest,
) -> Result<SemanticLayerChatResponse, String> {
    if request.prompt.trim().is_empty() {
        return Err("prompt is required".to_string());
    }

    let rag_docs: Vec<(String, String)> = request
        .rag_documents
        .into_iter()
        .map(|doc| (doc.id, doc.content))
        .collect();

    let tools_version = if request.tools_version.is_empty() {
        "v0".to_string()
    } else {
        request.tools_version
    };

    let result = {
        let mut guard = state.0.lock().await;
        let engine = guard.as_mut().ok_or_else(|| {
            "Semantic layer is not running. Call semantic_layer_spawn first.".to_string()
        })?;

        if let Some(url) = &request.ollama_base_url {
            engine.set_ollama_url(url);
        }

        engine
            .run(
                &request.prompt,
                &rag_docs,
                &request.system_prompt,
                request.temperature,
                request.max_tokens,
                &tools_version,
                &request.doc_version,
            )
            .await?
    };

    Ok(map_pipeline_result(result))
}

#[tauri::command]
pub fn semantic_layer_config(
    state: State<'_, SemanticLayerState>,
    update: SemanticLayerConfigUpdate,
) -> Result<serde_json::Value, String> {
    with_engine(&state, |engine| {
        let current = engine.config().clone();
        let next = SemanticLayerConfig {
            cache_initial_threshold: update
                .cache_initial_threshold
                .unwrap_or(current.cache_initial_threshold),
            cache_max_entries: update
                .cache_max_entries
                .unwrap_or(current.cache_max_entries),
            enable_cache: update.enable_cache.unwrap_or(current.enable_cache),
            enable_compression: update
                .enable_compression
                .unwrap_or(current.enable_compression),
            small_model: update.small_model.unwrap_or(current.small_model),
            medium_model: update.medium_model.unwrap_or(current.medium_model),
            large_model: update.large_model.unwrap_or(current.large_model),
            ..current
        };

        if let Some(url) = update.ollama_base_url {
            engine.set_ollama_url(url.trim_end_matches('/'));
        }

        engine.apply_config(next.clone());

        let tier_models: serde_json::Map<String, serde_json::Value> = next
            .tier_models()
            .into_iter()
            .map(|(tier, model)| (tier.as_str().to_string(), serde_json::Value::String(model)))
            .collect();

        Ok(serde_json::json!({
            "ok": true,
            "cache_initial_threshold": next.cache_initial_threshold,
            "cache_max_entries": next.cache_max_entries,
            "enable_cache": next.enable_cache,
            "enable_compression": next.enable_compression,
            "tier_models": tier_models,
        }))
    })
}

#[tauri::command]
pub fn semantic_layer_feedback(
    state: State<'_, SemanticLayerState>,
    request: SemanticLayerFeedbackRequest,
) -> Result<serde_json::Value, String> {
    with_engine(&state, |engine| {
        engine.record_feedback(&request.entry_id, request.accepted, request.similarity);
        let _ = engine.save_state();
        Ok(serde_json::json!({ "ok": true }))
    })
}

#[tauri::command]
pub fn semantic_layer_stats(
    state: State<'_, SemanticLayerState>,
) -> Result<serde_json::Value, String> {
    with_engine(&state, |engine| {
        let mut payload = engine.stats();
        let config = engine.config();
        payload.insert(
            "config".to_string(),
            serde_json::json!({
                "target_overhead_ms": config.target_overhead_ms,
                "cache_initial_threshold": config.cache_initial_threshold,
                "enable_cache": config.enable_cache,
                "enable_compression": config.enable_compression,
                "max_concurrent_llm": config.max_concurrent_llm,
            }),
        );
        Ok(serde_json::Value::Object(
            payload
                .into_iter()
                .collect::<serde_json::Map<String, serde_json::Value>>(),
        ))
    })
}

fn map_pipeline_result(result: PipelineResult) -> SemanticLayerChatResponse {
    SemanticLayerChatResponse {
        text: result.text,
        cache_entry_id: result.cache_entry_id,
        cache_hit: result.metrics.cache_hit,
        model_used: result.model_used,
        metrics: result.metrics,
    }
}

// ---------------------------------------------------------------------------
// Optional Python sidecar fallback (legacy packaging path)
// ---------------------------------------------------------------------------

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

pub struct SemanticLayerProcess(pub Mutex<Option<Child>>);

fn sidecar_binary_name() -> &'static str {
    #[cfg(windows)]
    {
        "semantic-layer.exe"
    }
    #[cfg(not(windows))]
    {
        "semantic-layer"
    }
}

fn resolve_repo_root() -> Option<PathBuf> {
    if let Ok(root) = std::env::var("LIQUITASK_REPO_ROOT") {
        let path = PathBuf::from(root);
        if path.join("semantic_layer").is_dir() {
            return Some(path);
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        if cwd.join("semantic_layer").is_dir() {
            return Some(cwd);
        }
        let parent = cwd.join("..");
        if parent.join("semantic_layer").is_dir() {
            return parent.canonicalize().ok();
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(Path::to_path_buf);
        for _ in 0..6 {
            let Some(current) = dir else {
                break;
            };
            if current.join("semantic_layer").is_dir() {
                return Some(current);
            }
            dir = current.parent().map(Path::to_path_buf);
        }
    }

    None
}

fn resolve_bundled_sidecar() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let candidate = dir.join(sidecar_binary_name());
    candidate.is_file().then_some(candidate)
}

fn python_candidates() -> Vec<String> {
    if let Ok(from_env) = std::env::var("LIQUITASK_PYTHON") {
        return vec![from_env];
    }
    vec![
        "python3".to_string(),
        "python".to_string(),
        "py".to_string(),
    ]
}

fn spawn_python_sidecar(repo_root: &Path, port: u16, ollama: &str) -> Result<Child, String> {
    let mut last_error = String::from("No Python interpreter found");
    for python in python_candidates() {
        let mut command = Command::new(&python);
        command
            .arg("-m")
            .arg("semantic_layer")
            .arg("--port")
            .arg(port.to_string())
            .arg("--ollama-url")
            .arg(ollama)
            .current_dir(repo_root)
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        match command.spawn() {
            Ok(child) => return Ok(child),
            Err(error) => {
                last_error = format!("Failed to spawn {python}: {error}");
            }
        }
    }

    Err(last_error)
}

fn spawn_bundled_sidecar(path: &Path, port: u16, ollama: &str) -> Result<Child, String> {
    Command::new(path)
        .arg("--port")
        .arg(port.to_string())
        .arg("--ollama-url")
        .arg(ollama)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Failed to spawn bundled sidecar {}: {error}", path.display()))
}

fn spawn_python_fallback(port: u16, ollama: &str) -> Result<(), String> {
    if let Some(sidecar) = resolve_bundled_sidecar() {
        let _child = spawn_bundled_sidecar(&sidecar, port, ollama)?;
        return Ok(());
    }
    let repo_root = resolve_repo_root().ok_or_else(|| {
        "Could not locate semantic_layer package. Set LIQUITASK_REPO_ROOT or run from the repo."
            .to_string()
    })?;
    let _child = spawn_python_sidecar(&repo_root, port, ollama)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidecar_name_is_platform_specific() {
        let name = sidecar_binary_name();
        #[cfg(windows)]
        assert!(name.ends_with(".exe"));
        #[cfg(not(windows))]
        assert!(!name.contains('.'));
    }

    #[test]
    fn model_tier_serializes_lowercase() {
        assert_eq!(ModelTier::Large.as_str(), "large");
    }
}
