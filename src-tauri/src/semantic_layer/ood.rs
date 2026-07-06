//! Online out-of-distribution detection via diagonal Mahalanobis distance.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OodState {
    pub dim: usize,
    pub min_samples: usize,
    pub count: usize,
    pub mean: Vec<f64>,
    pub m2: Vec<f64>,
}

pub struct OodDetector {
    dim: usize,
    pub min_samples: usize,
    count: usize,
    mean: Vec<f64>,
    m2: Vec<f64>,
}

impl OodDetector {
    pub fn new(dim: usize, min_samples: usize) -> Self {
        Self {
            dim,
            min_samples,
            count: 0,
            mean: vec![0.0; dim],
            m2: vec![0.0; dim],
        }
    }

    pub fn update(&mut self, embedding: &[f32]) {
        if embedding.len() != self.dim {
            return;
        }
        self.count += 1;
        for i in 0..self.dim {
            let x = embedding[i] as f64;
            let delta = x - self.mean[i];
            self.mean[i] += delta / self.count as f64;
            let delta2 = x - self.mean[i];
            self.m2[i] += delta * delta2;
        }
    }

    pub fn ready(&self) -> bool {
        self.count >= self.min_samples
    }

    pub fn sample_count(&self) -> usize {
        self.count
    }

    pub fn score(&self, embedding: &[f32]) -> f32 {
        if !self.ready() || embedding.len() != self.dim {
            return 0.0;
        }
        let mut sum = 0.0f64;
        for i in 0..self.dim {
            let variance = self.m2[i] / (self.count.saturating_sub(1).max(1) as f64);
            let diff = embedding[i] as f64 - self.mean[i];
            sum += (diff * diff) / (variance + 1e-6);
        }
        sum.sqrt() as f32
    }

    pub fn state(&self) -> OodState {
        OodState {
            dim: self.dim,
            min_samples: self.min_samples,
            count: self.count,
            mean: self.mean.clone(),
            m2: self.m2.clone(),
        }
    }

    pub fn load_state(&mut self, state: &OodState) -> bool {
        if state.mean.len() != self.dim || state.m2.len() != self.dim {
            return false;
        }
        self.count = state.count;
        self.mean = state.mean.clone();
        self.m2 = state.m2.clone();
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cold_start_returns_zero_score() {
        let detector = OodDetector::new(8, 5);
        let emb = vec![1.0 / (8.0f32).sqrt(); 8];
        assert_eq!(detector.score(&emb), 0.0);
        assert!(!detector.ready());
    }

    #[test]
    fn state_round_trip() {
        let mut detector = OodDetector::new(8, 5);
        for seed in 0..20 {
            let emb: Vec<f32> = (0..8)
                .map(|i| ((seed + i) as f32 * 0.01).sin())
                .collect();
            detector.update(&emb);
        }
        let state = detector.state();
        let mut restored = OodDetector::new(8, 5);
        assert!(restored.load_state(&state));
        let probe = vec![1.0; 8];
        assert_eq!(restored.sample_count(), detector.sample_count());
        assert!((restored.score(&probe) - detector.score(&probe)).abs() < 1e-6);
    }
}
