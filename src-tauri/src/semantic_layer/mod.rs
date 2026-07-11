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
mod url_allowlist;

pub use config::SemanticLayerConfig;
pub use orchestrator::{PipelineMetrics, SemanticOrchestrator};

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use rand::RngCore;
use serde::{Deserialize, Serialize};
use tauri::State;

#[cfg(test)]
use config::ModelTier;
use orchestrator::PipelineResult;
use url_allowlist::{
    register_configured_host, secure_cache_dir, validate_ollama_url,
    MAX_CACHE_MAX_ENTRIES, MAX_MAX_TOKENS, MAX_PROMPT_CHARS, MAX_RAG_DOCUMENTS,
    MAX_RAG_DOC_CONTENT_CHARS, MAX_SYSTEM_PROMPT_CHARS,
};

const ENGINE_VERSION: &str = "1.0.0";

pub struct SemanticLayerState(pub tokio::sync::Mutex<SemanticLayerRuntime>);

pub struct SemanticLayerRuntime {
    engine: Option<SemanticOrchestrator>,
    python_sidecar: Option<PythonSidecar>,
    configured_ollama_hosts: HashSet<String>,
}

struct PythonSidecar {
    child: Child,
    auth_token: String,
    port: u16,
}

impl SemanticLayerRuntime {
    fn new() -> Self {
        Self {
            engine: None,
            python_sidecar: None,
            configured_ollama_hosts: HashSet::new(),
        }
    }

    fn is_running(&mut self) -> bool {
        if self.engine.is_some() {
            return true;
        }
        if let Some(sidecar) = self.python_sidecar.as_mut() {
            return sidecar.child.try_wait().ok().flatten().is_none();
        }
        false
    }

    fn stop(&mut self) {
        if let Some(engine) = self.engine.take() {
            let _ = engine.save_state();
        }
        if let Some(mut sidecar) = self.python_sidecar.take() {
            kill_sidecar_child(&mut sidecar.child);
        }
    }
}

impl Default for SemanticLayerRuntime {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticLayerSpawnResult {
    pub ok: bool,
    pub runtime: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_token: Option<String>,
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

fn generate_auth_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, bytes)
}

fn validate_chat_bounds(request: &SemanticLayerChatRequest) -> Result<(), String> {
    if request.prompt.trim().is_empty() {
        return Err("prompt is required".to_string());
    }
    if request.prompt.len() > MAX_PROMPT_CHARS {
        return Err("prompt exceeds maximum length".to_string());
    }
    if request.system_prompt.len() > MAX_SYSTEM_PROMPT_CHARS {
        return Err("system_prompt exceeds maximum length".to_string());
    }
    if request.rag_documents.len() > MAX_RAG_DOCUMENTS {
        return Err("too many rag_documents".to_string());
    }
    for doc in &request.rag_documents {
        if doc.content.len() > MAX_RAG_DOC_CONTENT_CHARS {
            return Err("rag document content too large".to_string());
        }
    }
    if request.max_tokens > MAX_MAX_TOKENS {
        return Err("max_tokens exceeds limit".to_string());
    }
    Ok(())
}

fn with_engine<T>(
    state: &State<'_, SemanticLayerState>,
    f: impl FnOnce(&mut SemanticOrchestrator, &mut HashSet<String>) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state.0.blocking_lock();
    let mut hosts = std::mem::take(&mut guard.configured_ollama_hosts);
    let engine = guard
        .engine
        .as_mut()
        .ok_or_else(|| "Semantic layer is not running. Call semantic_layer_spawn first.".to_string())?;
    let result = f(engine, &mut hosts);
    guard.configured_ollama_hosts = hosts;
    result
}

#[tauri::command]
pub fn semantic_layer_spawn(
    state: State<'_, SemanticLayerState>,
    port: Option<u16>,
    ollama_url: Option<String>,
) -> Result<SemanticLayerSpawnResult, String> {
    let port = port.unwrap_or(8765);
    let ollama = ollama_url.unwrap_or_else(default_ollama_url);

    let mut guard = state.0.blocking_lock();
    let validated = validate_ollama_url(&ollama, &guard.configured_ollama_hosts)?;
    register_configured_host(&mut guard.configured_ollama_hosts, &validated);

    if std::env::var("LIQUITASK_USE_PYTHON").is_ok() {
        let auth_token = spawn_python_fallback(&mut guard, port, &validated)?;
        return Ok(SemanticLayerSpawnResult {
            ok: true,
            runtime: "python".to_string(),
            auth_token: Some(auth_token),
        });
    }

    if guard.engine.is_some() {
        return Ok(SemanticLayerSpawnResult {
            ok: true,
            runtime: "rust".to_string(),
            auth_token: None,
        });
    }

    let validated = validate_ollama_url(&ollama, &guard.configured_ollama_hosts)?;
    register_configured_host(&mut guard.configured_ollama_hosts, &validated);
    if let Some(path) = default_cache_dir() {
        let _ = secure_cache_dir(&path);
    }
    guard.engine = Some(SemanticOrchestrator::new(
        SemanticLayerConfig::default(),
        validated,
    ));
    Ok(SemanticLayerSpawnResult {
        ok: true,
        runtime: "rust".to_string(),
        auth_token: None,
    })
}

#[tauri::command]
pub fn semantic_layer_stop(state: State<'_, SemanticLayerState>) -> Result<(), String> {
    state.0.blocking_lock().stop();
    Ok(())
}

#[tauri::command]
pub fn semantic_layer_health(state: State<'_, SemanticLayerState>) -> Result<serde_json::Value, String> {
    let mut guard = state.0.blocking_lock();
    let running = guard.is_running();
    let runtime = if guard.engine.is_some() {
        "rust"
    } else if guard.python_sidecar.is_some() {
        "python"
    } else {
        "off"
    };
    Ok(serde_json::json!({
        "status": if running { "ok" } else { "off" },
        "version": ENGINE_VERSION,
        "runtime": runtime,
    }))
}

#[tauri::command]
pub async fn semantic_layer_chat(
    state: State<'_, SemanticLayerState>,
    request: SemanticLayerChatRequest,
) -> Result<SemanticLayerChatResponse, String> {
    validate_chat_bounds(&request)?;

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

    let max_tokens = request.max_tokens.min(MAX_MAX_TOKENS);

    {
        let guard = state.0.lock().await;
        if guard.python_sidecar.is_some() {
            let sidecar = guard.python_sidecar.as_ref().unwrap();
            let body = serde_json::json!({
                "prompt": request.prompt,
                "system_prompt": request.system_prompt,
                "rag_documents": rag_docs.iter().map(|(id, content)| {
                    serde_json::json!({"id": id, "content": content})
                }).collect::<Vec<_>>(),
                "temperature": request.temperature,
                "max_tokens": max_tokens,
                "tools_version": tools_version,
                "doc_version": request.doc_version,
            });
            let data = sidecar_http_post(
                sidecar.port,
                &sidecar.auth_token,
                "/v1/chat",
                &body,
            )
            .await?;
            return parse_chat_response(data);
        }
    }

    let result = {
        let mut guard = state.0.lock().await;
        let engine = guard.engine.as_mut().ok_or_else(|| {
            "Semantic layer is not running. Call semantic_layer_spawn first.".to_string()
        })?;

        // Per-request URL overrides from callers are ignored (SSRF guard).
        let _ = &request.ollama_base_url;

        engine
            .run(
                &request.prompt,
                &rag_docs,
                &request.system_prompt,
                request.temperature,
                max_tokens,
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
    if let Some(max_entries) = update.cache_max_entries {
        if max_entries > MAX_CACHE_MAX_ENTRIES {
            return Err("cache_max_entries exceeds limit".to_string());
        }
    }

    {
        let guard = state.0.blocking_lock();
        if let Some(sidecar) = guard.python_sidecar.as_ref() {
            let body = serde_json::json!({
                "cache_initial_threshold": update.cache_initial_threshold,
                "cache_max_entries": update.cache_max_entries,
                "enable_cache": update.enable_cache,
                "enable_compression": update.enable_compression,
                "small_model": update.small_model,
                "medium_model": update.medium_model,
                "large_model": update.large_model,
                "ollama_base_url": update.ollama_base_url,
            });
            return sidecar_http_post_blocking(
                sidecar.port,
                &sidecar.auth_token,
                "/v1/config",
                &body,
            );
        }
    }

    with_engine(&state, |engine, configured_hosts| {
        let current = engine.config().clone();
        let cache_max = update
            .cache_max_entries
            .unwrap_or(current.cache_max_entries)
            .min(MAX_CACHE_MAX_ENTRIES);
        let next = SemanticLayerConfig {
            cache_initial_threshold: update
                .cache_initial_threshold
                .unwrap_or(current.cache_initial_threshold),
            cache_max_entries: cache_max,
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
            let validated = validate_ollama_url(url.trim_end_matches('/'), configured_hosts)?;
            register_configured_host(configured_hosts, &validated);
            engine.set_ollama_url(validated);
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
    {
        let guard = state.0.blocking_lock();
        if let Some(sidecar) = guard.python_sidecar.as_ref() {
            let body = serde_json::json!({
                "entry_id": request.entry_id,
                "accepted": request.accepted,
                "similarity": request.similarity,
            });
            return sidecar_http_post_blocking(
                sidecar.port,
                &sidecar.auth_token,
                "/v1/feedback",
                &body,
            );
        }
    }

    with_engine(&state, |engine, _| {
        engine.record_feedback(&request.entry_id, request.accepted, request.similarity);
        let _ = engine.save_state();
        Ok(serde_json::json!({ "ok": true }))
    })
}

#[tauri::command]
pub fn semantic_layer_stats(
    state: State<'_, SemanticLayerState>,
) -> Result<serde_json::Value, String> {
    {
        let guard = state.0.blocking_lock();
        if let Some(sidecar) = guard.python_sidecar.as_ref() {
            return sidecar_http_get_blocking(sidecar.port, &sidecar.auth_token, "/v1/stats");
        }
    }

    with_engine(&state, |engine, _| {
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

async fn sidecar_http_post(
    port: u16,
    auth_token: &str,
    path: &str,
    body: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("http://127.0.0.1:{port}{path}");
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {auth_token}"))
        .header("Host", "127.0.0.1")
        .json(body)
        .send()
        .await
        .map_err(|e| format!("Sidecar request failed: {e}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Sidecar returned {status}: {text}"));
    }
    response.json().await.map_err(|e| e.to_string())
}

fn sidecar_http_post_blocking(
    port: u16,
    auth_token: &str,
    path: &str,
    body: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::block_on(sidecar_http_post(port, auth_token, path, body))
}

fn sidecar_http_get_blocking(
    port: u16,
    auth_token: &str,
    path: &str,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::block_on(async {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| e.to_string())?;
        let url = format!("http://127.0.0.1:{port}{path}");
        let response = client
            .get(&url)
            .header("Authorization", format!("Bearer {auth_token}"))
            .header("Host", "127.0.0.1")
            .send()
            .await
            .map_err(|e| format!("Sidecar request failed: {e}"))?;
        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(format!("Sidecar returned {status}: {text}"));
        }
        response.json().await.map_err(|e| e.to_string())
    })
}

fn parse_chat_response(data: serde_json::Value) -> Result<SemanticLayerChatResponse, String> {
    let text = data
        .get("text")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Sidecar chat response missing text".to_string())?;
    Ok(SemanticLayerChatResponse {
        text: text.to_string(),
        cache_entry_id: data
            .get("cache_entry_id")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        cache_hit: data.get("cache_hit").and_then(|v| v.as_bool()).unwrap_or(false),
        model_used: data
            .get("model_used")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        metrics: data
            .get("metrics")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or(PipelineMetrics {
                embed_ms: 0.0,
                cache_ms: 0.0,
                route_ms: 0.0,
                compress_ms: 0.0,
                llm_ms: 0.0,
                total_semantic_ms: 0.0,
                cache_hit: false,
                cache_bypassed: false,
                route_tier: String::new(),
                ood_score: 0.0,
                is_ood: false,
                rag_context_used: false,
                compress_dropped: 0,
                compress_context_tokens: 0,
            }),
    })
}

pub fn stop_on_app_exit(state: &SemanticLayerState) {
    state.0.blocking_lock().stop();
}

// ---------------------------------------------------------------------------
// Optional Python sidecar fallback (legacy packaging path)
// ---------------------------------------------------------------------------

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

fn spawn_python_sidecar(
    repo_root: &Path,
    port: u16,
    ollama: &str,
    auth_token: &str,
) -> Result<Child, String> {
    let mut last_error = String::from("No Python interpreter found");
    for python in python_candidates() {
        let mut command = Command::new(&python);
        command
            .env("LIQUITASK_SEMANTIC_AUTH_TOKEN", auth_token)
            .arg("-m")
            .arg("semantic_layer")
            .arg("--port")
            .arg(port.to_string())
            .arg("--ollama-url")
            .arg(ollama)
            .current_dir(repo_root)
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }

        match command.spawn() {
            Ok(child) => return Ok(child),
            Err(error) => {
                last_error = format!("Failed to spawn {python}: {error}");
            }
        }
    }

    Err(last_error)
}

fn spawn_bundled_sidecar(path: &Path, port: u16, ollama: &str, auth_token: &str) -> Result<Child, String> {
    let mut command = Command::new(path);
    command
        .env("LIQUITASK_SEMANTIC_AUTH_TOKEN", auth_token)
        .arg("--port")
        .arg(port.to_string())
        .arg("--ollama-url")
        .arg(ollama)
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
        .spawn()
        .map_err(|error| format!("Failed to spawn bundled sidecar {}: {error}", path.display()))
}

fn spawn_python_fallback(
    runtime: &mut SemanticLayerRuntime,
    port: u16,
    ollama: &str,
) -> Result<String, String> {
    let auth_token = std::env::var("LIQUITASK_SEMANTIC_AUTH_TOKEN")
        .ok()
        .filter(|t| !t.is_empty())
        .unwrap_or_else(generate_auth_token);

    let child = if let Some(sidecar) = resolve_bundled_sidecar() {
        spawn_bundled_sidecar(&sidecar, port, ollama, &auth_token)?
    } else {
        let repo_root = resolve_repo_root().ok_or_else(|| {
            "Could not locate semantic_layer package. Set LIQUITASK_REPO_ROOT or run from the repo."
                .to_string()
        })?;
        spawn_python_sidecar(&repo_root, port, ollama, &auth_token)?
    };

    if let Some(mut existing) = runtime.python_sidecar.take() {
        kill_sidecar_child(&mut existing.child);
    }
    runtime.python_sidecar = Some(PythonSidecar {
        child,
        auth_token: auth_token.clone(),
        port,
    });
    Ok(auth_token)
}

#[cfg(unix)]
fn kill_sidecar_child(child: &mut Child) {
    let pgid = child.id();
    unsafe {
        libc::kill(-(pgid as i32), libc::SIGTERM);
    }
    let _ = child.wait();
}

#[cfg(windows)]
fn kill_sidecar_child(child: &mut Child) {
    use std::os::windows::process::CommandExt;
    let _ = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .creation_flags(0x08000000)
        .status();
    let _ = child.wait();
}

fn default_cache_dir() -> Option<PathBuf> {
    if let Ok(home) = std::env::var("HOME") {
        return Some(PathBuf::from(home).join(".liquitask").join("semantic-layer"));
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        return Some(
            PathBuf::from(profile)
                .join(".liquitask")
                .join("semantic-layer"),
        );
    }
    None
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

    #[test]
    fn chat_bounds_reject_oversized_prompt() {
        let request = SemanticLayerChatRequest {
            prompt: "x".repeat(MAX_PROMPT_CHARS + 1),
            system_prompt: String::new(),
            rag_documents: vec![],
            temperature: 0.4,
            max_tokens: 100,
            tools_version: String::new(),
            doc_version: "v1".to_string(),
            ollama_base_url: None,
        };
        assert!(validate_chat_bounds(&request).is_err());
    }
}
