//! Runtime configuration for the semantic layer pipeline.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelTier {
    Small,
    Medium,
    Large,
}

impl ModelTier {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Small => "small",
            Self::Medium => "medium",
            Self::Large => "large",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SemanticLayerConfig {
    pub embed_dim: usize,
    pub embed_model: String,
    pub cache_max_entries: usize,
    pub cache_ttl_seconds: u64,
    pub cache_initial_threshold: f32,
    pub cache_fp_epsilon: f32,
    pub cache_ann_top_k: usize,
    pub cache_skip_intents: Vec<String>,
    pub cache_max_cacheable_temperature: f32,
    pub complexity_threshold: f32,
    pub small_model: String,
    pub medium_model: String,
    pub large_model: String,
    pub chunk_threshold: f32,
    pub max_context_tokens: usize,
    pub avg_chars_per_token: f32,
    pub chunk_size: usize,
    pub chunk_overlap: usize,
    pub ood_sigma_threshold: f32,
    pub ood_threshold_boost: f32,
    pub ood_min_samples: usize,
    pub target_overhead_ms: f32,
    pub max_concurrent_llm: usize,
    pub enable_cache: bool,
    pub enable_compression: bool,
}

impl Default for SemanticLayerConfig {
    fn default() -> Self {
        Self {
            embed_dim: 384,
            embed_model: "sentence-transformers/all-MiniLM-L6-v2".to_string(),
            cache_max_entries: 10_000,
            cache_ttl_seconds: 86_400,
            cache_initial_threshold: 0.88,
            cache_fp_epsilon: 0.02,
            cache_ann_top_k: 5,
            cache_skip_intents: vec!["creative".to_string()],
            cache_max_cacheable_temperature: 0.7,
            complexity_threshold: 0.62,
            small_model: "llama3.2:1b".to_string(),
            medium_model: "llama3.2:3b".to_string(),
            large_model: "llama3.1:8b".to_string(),
            chunk_threshold: 0.55,
            max_context_tokens: 2048,
            avg_chars_per_token: 4.0,
            chunk_size: 512,
            chunk_overlap: 64,
            ood_sigma_threshold: 3.5,
            ood_threshold_boost: 0.05,
            ood_min_samples: 50,
            target_overhead_ms: 15.0,
            max_concurrent_llm: 2,
            enable_cache: true,
            enable_compression: true,
        }
    }
}

impl SemanticLayerConfig {
    pub fn tier_models(&self) -> HashMap<ModelTier, String> {
        let mut map = HashMap::new();
        map.insert(ModelTier::Small, self.small_model.clone());
        map.insert(ModelTier::Medium, self.medium_model.clone());
        map.insert(ModelTier::Large, self.large_model.clone());
        map
    }

    pub fn model_for_tier(&self, tier: ModelTier) -> String {
        match tier {
            ModelTier::Small => self.small_model.clone(),
            ModelTier::Medium => self.medium_model.clone(),
            ModelTier::Large => self.large_model.clone(),
        }
    }
}
