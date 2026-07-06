//! Text embedding — deterministic for tests, fastembed for production.

use sha2::{Digest, Sha256};
use std::sync::Mutex;

use super::config::SemanticLayerConfig;

pub trait Embedder: Send + Sync {
    fn encode_one(&self, text: &str) -> Vec<f32>;
    fn encode(&self, texts: &[&str]) -> Vec<Vec<f32>> {
        texts.iter().map(|text| self.encode_one(text)).collect()
    }
}

/// Deterministic per-text unit vectors — same text yields the same vector.
pub struct DeterministicEmbedder {
    dim: usize,
}

impl DeterministicEmbedder {
    pub fn new(dim: usize) -> Self {
        Self { dim }
    }

    fn vector_for(&self, text: &str) -> Vec<f32> {
        let digest = Sha256::digest(text.as_bytes());
        let seed = u64::from_le_bytes(digest[..8].try_into().unwrap_or([0; 8]));
        let mut v: Vec<f32> = (0..self.dim)
            .map(|i| {
                let x = (seed.wrapping_add(i as u64)) as f32 * 0.0001;
                (x.sin() * 43758.5453).fract() * 2.0 - 1.0
            })
            .collect();
        let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-9);
        v.iter_mut().for_each(|x| *x /= norm);
        v
    }
}

impl Embedder for DeterministicEmbedder {
    fn encode_one(&self, text: &str) -> Vec<f32> {
        self.vector_for(text)
    }
}

struct FastEmbedInner {
    model: fastembed::TextEmbedding,
}

/// Production embedder using all-MiniLM-L6-v2 (384-dim), matching the Python sidecar.
pub struct FastEmbedder {
    inner: Mutex<FastEmbedInner>,
    dim: usize,
}

impl FastEmbedder {
    pub fn new(config: &SemanticLayerConfig) -> Result<Self, String> {
        let model = fastembed::TextEmbedding::try_new(
            fastembed::InitOptions::new(fastembed::EmbeddingModel::AllMiniLML6V2)
                .with_show_download_progress(false),
        )
        .map_err(|error| format!("Failed to load embedding model: {error}"))?;
        Ok(Self {
            inner: Mutex::new(FastEmbedInner { model }),
            dim: config.embed_dim,
        })
    }
}

impl Embedder for FastEmbedder {
    fn encode_one(&self, text: &str) -> Vec<f32> {
        let Ok(guard) = self.inner.lock() else {
            return vec![0.0; self.dim];
        };
        match guard.model.embed(vec![text], None) {
            Ok(mut vectors) => vectors.pop().unwrap_or_else(|| vec![0.0; self.dim]),
            Err(_) => vec![0.0; self.dim],
        }
    }

    fn encode(&self, texts: &[&str]) -> Vec<Vec<f32>> {
        let Ok(guard) = self.inner.lock() else {
            return texts.iter().map(|_| vec![0.0; self.dim]).collect();
        };
        match guard.model.embed(texts.to_vec(), None) {
            Ok(vectors) => vectors,
            Err(_) => texts.iter().map(|_| vec![0.0; self.dim]).collect(),
        }
    }
}

pub fn build_embedder(config: &SemanticLayerConfig) -> Box<dyn Embedder> {
    if cfg!(test) {
        return Box::new(DeterministicEmbedder::new(config.embed_dim));
    }
    match FastEmbedder::new(config) {
        Ok(embedder) => Box::new(embedder),
        Err(error) => {
            eprintln!("[SemanticLayer] {error}; falling back to deterministic embeddings");
            Box::new(DeterministicEmbedder::new(config.embed_dim))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_embeddings_are_stable() {
        let embedder = DeterministicEmbedder::new(384);
        let a = embedder.encode_one("hello world");
        let b = embedder.encode_one("hello world");
        assert_eq!(a, b);
        assert!((a.iter().map(|x| x * x).sum::<f32>().sqrt() - 1.0).abs() < 1e-5);
    }
}
