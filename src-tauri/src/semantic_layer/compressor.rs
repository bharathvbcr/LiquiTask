//! RAG document chunking, relevance filtering, and greedy packing.

use regex::Regex;

use super::config::SemanticLayerConfig;
use super::embedder::Embedder;

#[derive(Debug, Clone)]
pub struct DocumentChunk {
    pub text: String,
    pub source: String,
    pub token_estimate: usize,
    pub relevance: f32,
}

#[derive(Debug, Clone)]
pub struct CompressionResult {
    pub total_tokens: usize,
    pub dropped_count: usize,
    pub compressed_context: String,
}

pub struct SemanticCompressor {
    config: SemanticLayerConfig,
}

impl SemanticCompressor {
    pub fn new(config: SemanticLayerConfig) -> Self {
        Self { config }
    }

    pub fn set_config(&mut self, config: SemanticLayerConfig) {
        self.config = config;
    }

    pub fn chunk_text(&self, text: &str) -> Vec<String> {
        let chunk_size = self.config.chunk_size;
        let overlap = self.config.chunk_overlap;
        let paragraph_split = Regex::new(r"\n{2,}").unwrap();
        let paragraphs: Vec<&str> = paragraph_split.split(text.trim()).collect();

        let mut chunks = Vec::new();
        let mut buffer = String::new();

        for para in paragraphs {
            if buffer.len() + para.len() < chunk_size {
                if !buffer.is_empty() {
                    buffer.push_str("\n\n");
                }
                buffer.push_str(para);
            } else {
                if !buffer.is_empty() {
                    chunks.push(buffer.clone());
                }
                buffer = para.to_string();
            }
        }
        if !buffer.is_empty() {
            chunks.push(buffer);
        }

        let mut final_chunks = Vec::new();
        for chunk in chunks {
            if chunk.len() <= chunk_size {
                final_chunks.push(chunk);
            } else {
                let step = (chunk_size - overlap).max(1);
                let mut start = 0;
                while start < chunk.len() {
                    let end = (start + chunk_size).min(chunk.len());
                    final_chunks.push(chunk[start..end].to_string());
                    start += step;
                }
            }
        }
        final_chunks
    }

    fn estimate_tokens(&self, text: &str) -> usize {
        (text.len() as f32 / self.config.avg_chars_per_token).max(1.0) as usize
    }

    fn score_and_filter(
        &self,
        query_emb: &[f32],
        chunks: Vec<DocumentChunk>,
        embedder: &dyn Embedder,
    ) -> Vec<DocumentChunk> {
        if chunks.is_empty() {
            return Vec::new();
        }
        let texts: Vec<&str> = chunks.iter().map(|c| c.text.as_str()).collect();
        let embeddings = embedder.encode(&texts);
        let mut scored = Vec::new();
        for (mut chunk, emb) in chunks.into_iter().zip(embeddings) {
            let relevance = dot_product(query_emb, &emb);
            if relevance >= self.config.chunk_threshold {
                chunk.relevance = relevance;
                scored.push(chunk);
            }
        }
        scored
    }

    fn pack(&self, chunks: Vec<DocumentChunk>) -> CompressionResult {
        let budget = self.config.max_context_tokens;
        let mut sorted = chunks;
        sorted.sort_by(|a, b| {
            let ratio_a = a.relevance / a.token_estimate.max(1) as f32;
            let ratio_b = b.relevance / b.token_estimate.max(1) as f32;
            ratio_b
                .partial_cmp(&ratio_a)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let mut selected = Vec::new();
        let mut used_tokens = 0usize;
        for chunk in &sorted {
            if used_tokens + chunk.token_estimate <= budget {
                used_tokens += chunk.token_estimate;
                selected.push(chunk.clone());
            }
        }

        let dropped_count = sorted.len().saturating_sub(selected.len());
        let compressed_context = selected
            .iter()
            .map(|c| format!("[{}]\n{}", c.source, c.text))
            .collect::<Vec<_>>()
            .join("\n\n---\n\n");

        CompressionResult {
            total_tokens: used_tokens,
            dropped_count,
            compressed_context,
        }
    }

    pub fn compress(
        &self,
        query: &str,
        documents: &[(String, String)],
        embedder: &dyn Embedder,
    ) -> CompressionResult {
        let query_emb = embedder.encode_one(query);
        let mut all_chunks = Vec::new();

        for (source, text) in documents {
            for chunk_text in self.chunk_text(text) {
                let token_estimate = self.estimate_tokens(&chunk_text);
                all_chunks.push(DocumentChunk {
                    text: chunk_text,
                    source: source.clone(),
                    token_estimate,
                    relevance: 0.0,
                });
            }
        }

        if all_chunks.is_empty() {
            return CompressionResult {
                total_tokens: 0,
                dropped_count: 0,
                compressed_context: String::new(),
            };
        }

        let filtered = self.score_and_filter(&query_emb, all_chunks, embedder);
        self.pack(filtered)
    }
}

fn dot_product(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_text_splits_long_paragraphs() {
        let compressor = SemanticCompressor::new(SemanticLayerConfig {
            chunk_size: 20,
            chunk_overlap: 5,
            ..SemanticLayerConfig::default()
        });
        let text = "a".repeat(50);
        let chunks = compressor.chunk_text(&text);
        assert!(chunks.len() > 1);
    }
}
