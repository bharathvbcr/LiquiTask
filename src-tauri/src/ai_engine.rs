//! Direct Ollama HTTP client for AI requests (complements semantic layer).

use std::time::Instant;

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaGenerateRequest {
    pub base_url: Option<String>,
    pub model: String,
    pub prompt: String,
    #[serde(default)]
    pub system: Option<String>,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaGenerateResponse {
    pub text: String,
    pub latency_ms: f32,
    pub model: String,
}

fn default_temperature() -> f32 {
    0.4
}

fn default_max_tokens() -> u32 {
    2048
}

#[derive(Serialize)]
struct GenerateOptions {
    temperature: f32,
    num_predict: u32,
}

fn normalize_base_url(base_url: Option<String>) -> String {
    base_url
        .unwrap_or_else(|| "http://127.0.0.1:11434".to_string())
        .trim_end_matches('/')
        .to_string()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ai_ollama_generate(
    request: OllamaGenerateRequest,
) -> Result<OllamaGenerateResponse, String> {
    #[derive(Serialize)]
    struct Payload<'a> {
        model: &'a str,
        prompt: &'a str,
        stream: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        system: Option<&'a str>,
        options: GenerateOptions,
    }

    let base = normalize_base_url(request.base_url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let payload = Payload {
        model: &request.model,
        prompt: &request.prompt,
        stream: false,
        system: request.system.as_deref(),
        options: GenerateOptions {
            temperature: request.temperature,
            num_predict: request.max_tokens,
        },
    };

    let start = Instant::now();
    let response = client
        .post(format!("{base}/api/generate"))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Ollama returned {status}: {body}"));
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Invalid Ollama response: {e}"))?;

    Ok(OllamaGenerateResponse {
        text: data
            .get("response")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        latency_ms: start.elapsed().as_secs_f32() * 1000.0,
        model: request.model,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaHealthRequest {
    pub base_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaHealthResponse {
    pub ok: bool,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ai_ollama_health(
    request: OllamaHealthRequest,
) -> Result<OllamaHealthResponse, String> {
    let base = normalize_base_url(request.base_url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;
    let ok = client
        .get(format!("{base}/api/tags"))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false);
    Ok(OllamaHealthResponse { ok })
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaChatRequest {
    pub base_url: Option<String>,
    pub model: String,
    pub messages: Vec<OllamaChatMessage>,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    #[serde(default)]
    pub format_json: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaChatResponse {
    pub content: String,
    pub latency_ms: f32,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ai_ollama_chat(request: OllamaChatRequest) -> Result<OllamaChatResponse, String> {
    #[derive(Serialize)]
    struct Payload<'a> {
        model: &'a str,
        messages: &'a [OllamaChatMessage],
        stream: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        format: Option<&'static str>,
        options: GenerateOptions,
    }

    let base = normalize_base_url(request.base_url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let format = if request.format_json {
        Some("json")
    } else {
        None
    };

    let payload = Payload {
        model: &request.model,
        messages: &request.messages,
        stream: false,
        format,
        options: GenerateOptions {
            temperature: request.temperature,
            num_predict: default_max_tokens(),
        },
    };

    let start = Instant::now();
    let response = client
        .post(format!("{base}/api/chat"))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Ollama chat request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Ollama returned {status}: {body}"));
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Invalid Ollama chat response: {e}"))?;

    Ok(OllamaChatResponse {
        content: data
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        latency_ms: start.elapsed().as_secs_f32() * 1000.0,
    })
}
