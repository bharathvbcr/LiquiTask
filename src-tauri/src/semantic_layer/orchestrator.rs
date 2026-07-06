//! Pipeline orchestration: embed → OOD → cache → route → compress → LLM.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::Semaphore;

use super::cache::SemanticCache;
use super::compressor::SemanticCompressor;
use super::config::SemanticLayerConfig;
use super::embedder::{build_embedder, Embedder};
use super::ollama::OllamaBackend;
use super::ood::{OodDetector, OodState};
use super::router::SemanticRouter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineMetrics {
    pub embed_ms: f32,
    pub cache_ms: f32,
    pub route_ms: f32,
    pub compress_ms: f32,
    pub llm_ms: f32,
    pub total_semantic_ms: f32,
    pub cache_hit: bool,
    pub cache_bypassed: bool,
    pub route_tier: String,
    pub ood_score: f32,
    pub is_ood: bool,
    pub rag_context_used: bool,
    pub compress_dropped: usize,
    pub compress_context_tokens: usize,
}

#[derive(Debug, Clone)]
pub struct PipelineResult {
    pub text: String,
    pub metrics: PipelineMetrics,
    pub model_used: String,
    pub cache_entry_id: Option<String>,
}

pub fn rag_fingerprint(rag_documents: &[(String, String)]) -> String {
    if rag_documents.is_empty() {
        return String::new();
    }
    let mut hasher = Sha256::new();
    for (source, text) in rag_documents {
        hasher.update(source.as_bytes());
        hasher.update([0]);
        hasher.update(text.as_bytes());
        hasher.update([0]);
    }
    let digest = hasher.finalize();
    digest.iter().take(8).map(|b| format!("{b:02x}")).collect()
}

pub struct SemanticOrchestrator {
    config: SemanticLayerConfig,
    embedder: Box<dyn Embedder>,
    cache: SemanticCache,
    router: SemanticRouter,
    compressor: SemanticCompressor,
    ood: OodDetector,
    backend: OllamaBackend,
    llm_semaphore: Option<Semaphore>,
    persist_path: Option<PathBuf>,
}

impl SemanticOrchestrator {
    pub fn new(config: SemanticLayerConfig, ollama_url: impl Into<String>) -> Self {
        let embedder = build_embedder(&config);
        let max_concurrent = config.max_concurrent_llm;
        let llm_semaphore = if max_concurrent > 0 {
            Some(Semaphore::new(max_concurrent))
        } else {
            None
        };
        let persist_path = default_cache_dir();
        let mut orchestrator = Self {
            cache: SemanticCache::new(config.clone()),
            router: SemanticRouter::new(config.clone()),
            compressor: SemanticCompressor::new(config.clone()),
            ood: OodDetector::new(config.embed_dim, config.ood_min_samples),
            config,
            embedder,
            backend: OllamaBackend::new(ollama_url),
            llm_semaphore,
            persist_path,
        };
        orchestrator.load_state();
        orchestrator
    }

    pub fn apply_config(&mut self, config: SemanticLayerConfig) {
        let prev_threshold = self.config.cache_initial_threshold;
        let prev_concurrency = self.config.max_concurrent_llm;
        self.config = config.clone();
        self.cache.set_config(config.clone());
        self.router.set_config(config.clone());
        self.compressor.set_config(config.clone());
        self.ood.min_samples = config.ood_min_samples;

        if (config.cache_initial_threshold - prev_threshold).abs() > f32::EPSILON {
            self.cache.set_threshold(config.cache_initial_threshold);
        }
        if config.max_concurrent_llm != prev_concurrency {
            self.llm_semaphore = if config.max_concurrent_llm > 0 {
                Some(Semaphore::new(config.max_concurrent_llm))
            } else {
                None
            };
        }
    }

    pub fn set_ollama_url(&mut self, url: impl Into<String>) {
        self.backend = OllamaBackend::new(url);
    }

    pub fn config(&self) -> &SemanticLayerConfig {
        &self.config
    }

    pub fn stats(&self) -> HashMap<String, serde_json::Value> {
        let mut stats = self.cache.stats();
        stats.insert(
            "ood_samples".to_string(),
            serde_json::Value::from(self.ood.sample_count()),
        );
        stats.insert(
            "ood_ready".to_string(),
            serde_json::Value::from(self.ood.ready()),
        );
        stats
    }

    pub async fn run(
        &mut self,
        prompt: &str,
        rag_documents: &[(String, String)],
        system_prompt: &str,
        temperature: f32,
        max_tokens: u32,
        tools_version: &str,
        doc_version: &str,
    ) -> Result<PipelineResult, String> {
        let pipeline_start = Instant::now();
        let mut metrics = PipelineMetrics {
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
        };

        let embed_start = Instant::now();
        let query_emb = self.embedder.encode_one(prompt);
        metrics.embed_ms = embed_start.elapsed().as_secs_f32() * 1000.0;

        let ood_score = self.ood.score(&query_emb);
        metrics.ood_score = ood_score;
        let is_ood = ood_score > self.config.ood_sigma_threshold;
        metrics.is_ood = is_ood;
        self.ood.update(&query_emb);

        let route_start = Instant::now();
        let route = self.router.route(prompt, is_ood);
        metrics.route_ms = route_start.elapsed().as_secs_f32() * 1000.0;
        metrics.route_tier = route.tier.as_str().to_string();

        let params_hash = SemanticCache::params_hash(
            temperature,
            system_prompt,
            tools_version,
            &rag_fingerprint(rag_documents),
            max_tokens,
        );
        let cacheable = self.is_cacheable(&route.intent, temperature);

        if self.config.enable_cache && cacheable {
            let cache_start = Instant::now();
            let cache_result = self.cache.lookup(
                &query_emb,
                &route.intent,
                route.tier,
                &params_hash,
                ood_score,
                Some(doc_version),
            );
            metrics.cache_ms = cache_start.elapsed().as_secs_f32() * 1000.0;
            metrics.cache_bypassed = cache_result.bypassed;

            if cache_result.hit {
                if let Some(response) = cache_result.response {
                    metrics.cache_hit = true;
                    metrics.total_semantic_ms =
                        pipeline_start.elapsed().as_secs_f32() * 1000.0;
                    let _ = self.save_state();
                    return Ok(PipelineResult {
                        text: response,
                        metrics,
                        model_used: "cache".to_string(),
                        cache_entry_id: cache_result.entry_id,
                    });
                }
            }
        }

        let mut final_prompt = prompt.to_string();
        if !rag_documents.is_empty() && self.config.enable_compression {
            let compress_start = Instant::now();
            let compressed = self
                .compressor
                .compress(prompt, rag_documents, self.embedder.as_ref());
            metrics.compress_dropped = compressed.dropped_count;
            metrics.compress_context_tokens = compressed.total_tokens;
            if !compressed.compressed_context.is_empty() {
                metrics.rag_context_used = true;
                final_prompt = format!(
                    "Context:\n{}\n\nQuestion: {}",
                    compressed.compressed_context, prompt
                );
            }
            metrics.compress_ms = compress_start.elapsed().as_secs_f32() * 1000.0;
        }

        metrics.total_semantic_ms = pipeline_start.elapsed().as_secs_f32() * 1000.0;

        let system = if system_prompt.is_empty() {
            None
        } else {
            Some(system_prompt)
        };

        let llm_response = if let Some(semaphore) = &self.llm_semaphore {
            let _permit = semaphore
                .acquire()
                .await
                .map_err(|error| format!("LLM semaphore closed: {error}"))?;
            self.backend
                .generate(
                    &route.model_name,
                    &final_prompt,
                    system,
                    temperature,
                    max_tokens,
                )
                .await?
        } else {
            self.backend
                .generate(
                    &route.model_name,
                    &final_prompt,
                    system,
                    temperature,
                    max_tokens,
                )
                .await?
        };
        metrics.llm_ms = llm_response.latency_ms;

        let mut entry_id = None;
        if self.config.enable_cache && cacheable && !is_ood {
            entry_id = Some(self.cache.store(
                query_emb,
                prompt,
                &llm_response.text,
                &route.intent,
                route.tier,
                &params_hash,
                None,
                doc_version,
            ));
        }

        let _ = self.save_state();

        Ok(PipelineResult {
            text: llm_response.text,
            metrics,
            model_used: route.model_name,
            cache_entry_id: entry_id,
        })
    }

    pub fn record_feedback(&self, _entry_id: &str, accepted: bool, similarity: f32) {
        self.cache.feedback(_entry_id, accepted, similarity);
    }

    pub fn save_state(&self) -> Result<(), String> {
        let Some(path) = &self.persist_path else {
            return Ok(());
        };
        fs::create_dir_all(path).map_err(|e| e.to_string())?;
        self.cache.save(path)?;
        let ood_file = path.join("ood.json");
        let state = self.ood.state();
        let data = serde_json::to_string(&state).map_err(|e| e.to_string())?;
        fs::write(ood_file, data).map_err(|e| e.to_string())
    }

    fn load_state(&mut self) {
        let Some(path) = &self.persist_path else {
            return;
        };
        let _ = self.cache.load(path);
        let ood_file = path.join("ood.json");
        if ood_file.is_file() {
            if let Ok(text) = fs::read_to_string(ood_file) {
                if let Ok(state) = serde_json::from_str::<OodState>(&text) {
                    let _ = self.ood.load_state(&state);
                }
            }
        }
    }

    fn is_cacheable(&self, intent: &str, temperature: f32) -> bool {
        if self.config.cache_skip_intents.iter().any(|i| i == intent) {
            return false;
        }
        temperature <= self.config.cache_max_cacheable_temperature
    }
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
    fn rag_fingerprint_changes_with_documents() {
        let a = rag_fingerprint(&[("ctx".to_string(), "one".to_string())]);
        let b = rag_fingerprint(&[("ctx".to_string(), "two".to_string())]);
        assert_ne!(a, b);
    }
}
