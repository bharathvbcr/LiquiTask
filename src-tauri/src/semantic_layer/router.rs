//! Intent classification and model-tier routing.

use regex::Regex;

use super::config::{ModelTier, SemanticLayerConfig};

#[derive(Debug, Clone)]
pub struct RouteDecision {
    pub tier: ModelTier,
    pub model_name: String,
    pub complexity_score: f32,
    pub intent: String,
    pub reasoning: String,
}

pub struct SemanticRouter {
    config: SemanticLayerConfig,
    complex_patterns: Vec<Regex>,
    simple_patterns: Vec<Regex>,
    intent_patterns: Vec<(String, Vec<Regex>)>,
}

impl SemanticRouter {
    const COMPLEX_PATTERNS: &'static [&'static str] = &[
        r"(?i)\b(prove|derive|theorem|optimize|architect|design\s+system)\b",
        r"(?i)\b(multi.?step|chain.?of.?thought|reasoning|analysis)\b",
        r"(?i)\b(code|implement|debug|refactor|sql|python|rust)\b",
        r"(?i)\b(compare|evaluate|trade.?off|pros?\s+and\s+cons?)\b",
    ];

    const SIMPLE_PATTERNS: &'static [&'static str] = &[
        r"(?i)^(hi|hello|hey|thanks|thank you)\b",
        r"(?i)\b(what is|define|who is|when was)\b",
        r"(?i)\b(yes|no|ok|sure)\b",
    ];

    const INTENT_KEYWORDS: &'static [(&'static str, &'static [&'static str])] = &[
        ("coding", &["code", "function", "bug", "api", "sql"]),
        ("factual", &["what", "who", "when", "define", "explain"]),
        ("creative", &["write", "story", "poem", "brainstorm"]),
        ("reasoning", &["why", "analyze", "compare", "prove"]),
    ];

    pub fn new(config: SemanticLayerConfig) -> Self {
        let complex_patterns = Self::COMPLEX_PATTERNS
            .iter()
            .filter_map(|p| Regex::new(p).ok())
            .collect();
        let simple_patterns = Self::SIMPLE_PATTERNS
            .iter()
            .filter_map(|p| Regex::new(p).ok())
            .collect();
        let intent_patterns = Self::INTENT_KEYWORDS
            .iter()
            .map(|(intent, keywords)| {
                let regexes = keywords
                    .iter()
                    .filter_map(|kw| Regex::new(&format!(r"(?i)\b{}\b", regex::escape(kw))).ok())
                    .collect();
                (intent.to_string(), regexes)
            })
            .collect();

        Self {
            config,
            complex_patterns,
            simple_patterns,
            intent_patterns,
        }
    }

    pub fn set_config(&mut self, config: SemanticLayerConfig) {
        self.config = config;
    }

    pub fn classify_intent(&self, prompt: &str) -> String {
        let mut best_intent = "general".to_string();
        let mut best_score = 0usize;

        for (intent, regexes) in &self.intent_patterns {
            let score = regexes.iter().filter(|r| r.is_match(prompt)).count();
            if score > best_score {
                best_score = score;
                best_intent = intent.clone();
            }
        }

        if best_score > 0 {
            best_intent
        } else {
            "general".to_string()
        }
    }

    pub fn complexity_score(&self, prompt: &str) -> f32 {
        let tokens = prompt.split_whitespace().count();
        let length_score = (tokens as f32 / 512.0).min(1.0);

        let complex_hits = self
            .complex_patterns
            .iter()
            .filter(|r| r.is_match(prompt))
            .count();
        let simple_hits = self
            .simple_patterns
            .iter()
            .filter(|r| r.is_match(prompt))
            .count();
        let pattern_score = ((complex_hits as f32 - simple_hits as f32) / 4.0 + 0.5)
            .clamp(0.0, 1.0);

        0.6 * length_score + 0.4 * pattern_score
    }

    pub fn route(&self, prompt: &str, force_large: bool) -> RouteDecision {
        let intent = self.classify_intent(prompt);
        let score = self.complexity_score(prompt);

        let (mut tier, mut reason) = if force_large {
            (ModelTier::Large, format!("OOD bump; base complexity ({score:.2})"))
        } else if score < self.config.complexity_threshold * 0.5 {
            (ModelTier::Small, format!("low complexity ({score:.2})"))
        } else if score < self.config.complexity_threshold {
            (ModelTier::Medium, format!("medium complexity ({score:.2})"))
        } else {
            (ModelTier::Large, format!("high complexity ({score:.2})"))
        };

        if intent == "reasoning" && tier == ModelTier::Small {
            tier = ModelTier::Medium;
            reason.push_str("; reasoning intent bump");
        }

        let model_name = self.config.model_for_tier(tier);
        RouteDecision {
            tier,
            model_name,
            complexity_score: score,
            intent,
            reasoning: reason,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_simple_prompt_to_small_tier() {
        let router = SemanticRouter::new(SemanticLayerConfig::default());
        let decision = router.route("What is photosynthesis?", false);
        assert_eq!(decision.tier, ModelTier::Small);
        assert_eq!(decision.intent, "factual");
    }

    #[test]
    fn word_boundary_intent_avoids_substring_false_positive() {
        let router = SemanticRouter::new(SemanticLayerConfig::default());
        assert_ne!(router.classify_intent("Tell me somewhat about foxes"), "factual");
        assert_eq!(router.classify_intent("what is a fox"), "factual");
    }

    #[test]
    fn force_large_on_ood() {
        let router = SemanticRouter::new(SemanticLayerConfig::default());
        let decision = router.route("hi", true);
        assert_eq!(decision.tier, ModelTier::Large);
    }
}
