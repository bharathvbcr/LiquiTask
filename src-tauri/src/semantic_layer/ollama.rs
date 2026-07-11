//! Async Ollama HTTP backend for LLM generation.

use serde::Serialize;
use std::time::Instant;

#[derive(Debug, Clone)]
pub struct LlmResponse {
    pub text: String,
    pub latency_ms: f32,
}

pub struct OllamaBackend {
    pub base_url: String,
    client: reqwest::Client,
}

impl OllamaBackend {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }

    pub async fn generate(
        &self,
        model: &str,
        prompt: &str,
        system: Option<&str>,
        temperature: f32,
        max_tokens: u32,
    ) -> Result<LlmResponse, String> {
        #[derive(Serialize)]
        struct Payload<'a> {
            model: &'a str,
            prompt: &'a str,
            stream: bool,
            #[serde(skip_serializing_if = "Option::is_none")]
            system: Option<&'a str>,
            options: GenerateOptions,
        }

        #[derive(Serialize)]
        struct GenerateOptions {
            temperature: f32,
            num_predict: u32,
        }

        let payload = Payload {
            model,
            prompt,
            stream: false,
            system,
            options: GenerateOptions {
                temperature,
                num_predict: max_tokens,
            },
        };

        let start = Instant::now();
        let response = self
            .client
            .post(format!("{}/api/generate", self.base_url))
            .json(&payload)
            .send()
            .await
            .map_err(|error| format!("Ollama request failed: {error}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Ollama returned {status}: {body}"));
        }

        let data: serde_json::Value = response
            .json()
            .await
            .map_err(|error| format!("Invalid Ollama response: {error}"))?;
        let text = data
            .get("response")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string();

        Ok(LlmResponse {
            text,
            latency_ms: start.elapsed().as_secs_f32() * 1000.0,
        })
    }
}
