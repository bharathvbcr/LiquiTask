//! Semantic cache with dynamic threshold calibration and linear ANN search.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::config::{ModelTier, SemanticLayerConfig};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CacheEntry {
    id: u64,
    prompt: String,
    response: String,
    intent: String,
    model_tier: ModelTier,
    params_hash: String,
    created_at: f64,
    last_accessed: f64,
    expires_at: f64,
    hit_count: u64,
    doc_version: String,
    embedding: Vec<f32>,
}

#[derive(Debug, Clone)]
pub struct CacheLookupResult {
    pub hit: bool,
    pub response: Option<String>,
    pub entry_id: Option<String>,
    pub bypassed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ThresholdCalibrator {
    threshold: f32,
    alpha: f32,
    beta: f32,
    margin: f32,
    fp_events: Vec<f32>,
}

impl ThresholdCalibrator {
    fn new(threshold: f32) -> Self {
        Self {
            threshold,
            alpha: 0.01,
            beta: 0.05,
            margin: 0.02,
            fp_events: Vec::new(),
        }
    }

    fn record_hit(&mut self, similarity: f32, accepted: bool) {
        if accepted {
            if similarity < self.threshold {
                self.threshold -= self.alpha * (self.threshold - similarity);
            }
        } else {
            self.threshold = (self.threshold
                + self.beta * (similarity - self.threshold + self.margin))
            .min(0.99);
            self.fp_events.push(similarity);
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CacheMeta {
    next_id: u64,
    threshold: f32,
    fp_events: Vec<f32>,
    entries: Vec<CacheEntry>,
}

pub struct SemanticCache {
    config: SemanticLayerConfig,
    inner: Mutex<CacheInner>,
}

struct CacheInner {
    entries: HashMap<u64, CacheEntry>,
    next_id: u64,
    calibrator: ThresholdCalibrator,
}

impl SemanticCache {
    pub fn new(config: SemanticLayerConfig) -> Self {
        let threshold = config.cache_initial_threshold;
        Self {
            config,
            inner: Mutex::new(CacheInner {
                entries: HashMap::new(),
                next_id: 0,
                calibrator: ThresholdCalibrator::new(threshold),
            }),
        }
    }

    pub fn set_config(&mut self, config: SemanticLayerConfig) {
        self.config = config;
    }

    pub fn params_hash(
        temperature: f32,
        system_prompt: &str,
        tools_version: &str,
        rag_fingerprint: &str,
        max_tokens: u32,
    ) -> String {
        let raw = format!(
            "{temperature:.2}|{system_prompt}|{tools_version}|{rag_fingerprint}|{max_tokens}"
        );
        let digest = Sha256::digest(raw.as_bytes());
        hex_prefix(&digest, 16)
    }

    pub fn lookup(
        &self,
        query_emb: &[f32],
        intent: &str,
        model_tier: ModelTier,
        params_hash: &str,
        ood_score: f32,
        doc_version: Option<&str>,
    ) -> CacheLookupResult {
        let mut inner = self.inner.lock().unwrap();

        if inner.entries.is_empty() {
            return CacheLookupResult {
                hit: false,
                response: None,
                entry_id: None,
                bypassed: false,
            };
        }

        if ood_score > self.config.ood_sigma_threshold {
            return CacheLookupResult {
                hit: false,
                response: None,
                entry_id: None,
                bypassed: true,
            };
        }

        let effective_tau = Self::effective_threshold(
            inner.calibrator.threshold,
            ood_score,
            self.config.ood_sigma_threshold,
            self.config.ood_threshold_boost,
        );

        let candidates = cosine_top_k(&inner.entries, query_emb, self.config.cache_ann_top_k);
        let now = now_secs();

        for (entry_id, sim) in candidates {
            if sim < effective_tau {
                break;
            }
            let Some(entry) = inner.entries.get_mut(&entry_id) else {
                continue;
            };
            if now > entry.expires_at {
                continue;
            }
            if entry.intent != intent {
                continue;
            }
            if entry.model_tier != model_tier {
                continue;
            }
            if entry.params_hash != params_hash {
                continue;
            }
            if let Some(version) = doc_version {
                if entry.doc_version != version {
                    continue;
                }
            }

            entry.last_accessed = now;
            entry.hit_count += 1;
            return CacheLookupResult {
                hit: true,
                response: Some(entry.response.clone()),
                entry_id: Some(entry_id.to_string()),
                bypassed: false,
            };
        }

        CacheLookupResult {
            hit: false,
            response: None,
            entry_id: None,
            bypassed: false,
        }
    }

    pub fn store(
        &self,
        query_emb: Vec<f32>,
        prompt: &str,
        response: &str,
        intent: &str,
        model_tier: ModelTier,
        params_hash: &str,
        ttl_seconds: Option<u64>,
        doc_version: &str,
    ) -> String {
        let mut inner = self.inner.lock().unwrap();
        Self::evict_if_needed(&mut inner, &self.config);

        let entry_id = inner.next_id;
        inner.next_id += 1;
        let now = now_secs();
        let ttl = ttl_seconds.unwrap_or(self.config.cache_ttl_seconds) as f64;

        inner.entries.insert(
            entry_id,
            CacheEntry {
                id: entry_id,
                prompt: prompt.to_string(),
                response: response.to_string(),
                intent: intent.to_string(),
                model_tier,
                params_hash: params_hash.to_string(),
                created_at: now,
                last_accessed: now,
                expires_at: now + ttl,
                hit_count: 0,
                doc_version: doc_version.to_string(),
                embedding: query_emb,
            },
        );

        entry_id.to_string()
    }

    pub fn feedback(&self, _entry_id: &str, accepted: bool, similarity: f32) {
        let mut inner = self.inner.lock().unwrap();
        inner.calibrator.record_hit(similarity, accepted);
    }

    pub fn set_threshold(&self, threshold: f32) {
        let mut inner = self.inner.lock().unwrap();
        inner.calibrator.threshold = threshold.clamp(0.75, 0.99);
    }

    pub fn stats(&self) -> HashMap<String, serde_json::Value> {
        let inner = self.inner.lock().unwrap();
        let mut map = HashMap::new();
        map.insert(
            "size".to_string(),
            serde_json::Value::from(inner.entries.len()),
        );
        map.insert(
            "dynamic_threshold".to_string(),
            serde_json::Value::from(inner.calibrator.threshold as f64),
        );
        map.insert(
            "fp_events".to_string(),
            serde_json::Value::from(inner.calibrator.fp_events.len()),
        );
        map
    }

    pub fn save(&self, directory: &Path) -> Result<(), String> {
        let inner = self.inner.lock().unwrap();
        super::url_allowlist::secure_cache_dir(directory)?;
        let meta = CacheMeta {
            next_id: inner.next_id,
            threshold: inner.calibrator.threshold,
            fp_events: inner.calibrator.fp_events.clone(),
            entries: inner.entries.values().cloned().collect(),
        };
        let tmp = directory.join("cache.meta.json.tmp");
        let data = serde_json::to_string(&meta).map_err(|e| e.to_string())?;
        fs::write(&tmp, data).map_err(|e| e.to_string())?;
        fs::rename(&tmp, directory.join("cache.meta.json")).map_err(|e| e.to_string())?;
        super::url_allowlist::secure_cache_dir(directory)
    }

    pub fn load(&self, directory: &Path) -> bool {
        let meta_file = directory.join("cache.meta.json");
        if !meta_file.is_file() {
            return false;
        }
        let Ok(text) = fs::read_to_string(&meta_file) else {
            return false;
        };
        let Ok(meta) = serde_json::from_str::<CacheMeta>(&text) else {
            return false;
        };

        let mut inner = self.inner.lock().unwrap();
        inner.next_id = meta.next_id;
        inner.calibrator.threshold = meta.threshold;
        inner.calibrator.fp_events = meta.fp_events;
        inner.entries.clear();

        let now = now_secs();
        for entry in meta.entries {
            if entry.embedding.len() != self.config.embed_dim {
                continue;
            }
            if now > entry.expires_at {
                continue;
            }
            inner.entries.insert(entry.id, entry);
        }
        true
    }

    fn effective_threshold(
        base: f32,
        ood_score: f32,
        sigma: f32,
        boost: f32,
    ) -> f32 {
        if ood_score <= 0.0 {
            return base;
        }
        if ood_score >= sigma {
            return base;
        }
        let ratio = ood_score / sigma;
        (base + boost * ratio).min(0.99)
    }

    fn evict_if_needed(inner: &mut CacheInner, config: &SemanticLayerConfig) {
        let now = now_secs();
        let mut dead: Vec<u64> = inner
            .entries
            .iter()
            .filter(|(_, entry)| now > entry.expires_at)
            .map(|(id, _)| *id)
            .collect();
        let dead_set: std::collections::HashSet<u64> = dead.iter().copied().collect();

        while inner.entries.len().saturating_sub(dead_set.len()) >= config.cache_max_entries {
            let lru_id = inner
                .entries
                .iter()
                .filter(|(id, _)| !dead_set.contains(id))
                .min_by(|a, b| {
                    a.1.last_accessed
                        .partial_cmp(&b.1.last_accessed)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .map(|(id, _)| *id);
            let Some(lru_id) = lru_id else {
                break;
            };
            dead.push(lru_id);
        }

        for id in dead {
            inner.entries.remove(&id);
        }
    }
}

fn cosine_top_k(
    entries: &HashMap<u64, CacheEntry>,
    query_emb: &[f32],
    k: usize,
) -> Vec<(u64, f32)> {
    let mut scored: Vec<(u64, f32)> = entries
        .iter()
        .map(|(id, entry)| (*id, dot_product(query_emb, &entry.embedding)))
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(k);
    scored
}

fn dot_product(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

fn now_secs() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

fn hex_prefix(digest: &[u8], len: usize) -> String {
    digest.iter().take(len / 2).map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    fn unit_vector(seed: u64) -> Vec<f32> {
        let mut v: Vec<f32> = (0..384)
            .map(|i| ((seed as f32 + i as f32) * PI / 384.0).sin())
            .collect();
        let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        v.iter_mut().for_each(|x| *x /= norm);
        v
    }

    #[test]
    fn cache_hit_on_near_duplicate() {
        let cache = SemanticCache::new(SemanticLayerConfig {
            cache_initial_threshold: 0.85,
            ..SemanticLayerConfig::default()
        });
        let emb = unit_vector(1);
        let params = SemanticCache::params_hash(0.4, "sys", "v0", "", 0);

        cache.store(
            emb.clone(),
            "capital of France",
            "Paris",
            "factual",
            ModelTier::Small,
            &params,
            None,
            "v1",
        );

        let mut near = unit_vector(2);
        for i in 0..384 {
            near[i] = emb[i] * 0.99 + near[i] * 0.01;
        }
        let norm: f32 = near.iter().map(|x| x * x).sum::<f32>().sqrt();
        for x in &mut near {
            *x /= norm;
        }

        let result = cache.lookup(
            &near,
            "factual",
            ModelTier::Small,
            &params,
            0.0,
            Some("v1"),
        );
        assert!(result.hit);
        assert_eq!(result.response.as_deref(), Some("Paris"));
    }

    #[test]
    fn strict_ood_bypasses_cache() {
        let cache = SemanticCache::new(SemanticLayerConfig {
            cache_initial_threshold: 0.70,
            ood_sigma_threshold: 3.5,
            ..SemanticLayerConfig::default()
        });
        let emb = unit_vector(4);
        let params = SemanticCache::params_hash(0.4, "sys", "v0", "", 0);
        cache.store(
            emb.clone(),
            "hello",
            "hi",
            "general",
            ModelTier::Small,
            &params,
            None,
            "v1",
        );

        let result = cache.lookup(
            &emb,
            "general",
            ModelTier::Small,
            &params,
            4.0,
            Some("v1"),
        );
        assert!(!result.hit);
        assert!(result.bypassed);
    }

    #[test]
    fn params_hash_includes_rag_and_max_tokens() {
        let base = SemanticCache::params_hash(0.4, "sys", "v0", "", 0);
        let with_rag = SemanticCache::params_hash(0.4, "sys", "v0", "abc", 0);
        let other_rag = SemanticCache::params_hash(0.4, "sys", "v0", "xyz", 0);
        let with_tokens = SemanticCache::params_hash(0.4, "sys", "v0", "", 256);
        assert_ne!(base, with_rag);
        assert_ne!(with_rag, other_rag);
        assert_ne!(base, with_tokens);
    }
}
