from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Pattern

import numpy as np
from numpy.typing import NDArray

from .config import ModelTier, SemanticLayerConfig


@dataclass
class RouteDecision:
    tier: ModelTier
    model_name: str
    complexity_score: float
    intent: str
    reasoning: str


class SemanticRouter:
    """
    Hybrid router: lexical complexity heuristics + embedding norm signals.
    Classifies intent and routes to SMALL / MEDIUM / LARGE model tiers.
    """

    COMPLEX_PATTERNS: List[str] = [
        r"\b(prove|derive|theorem|optimize|architect|design\s+system)\b",
        r"\b(multi.?step|chain.?of.?thought|reasoning|analysis)\b",
        r"\b(code|implement|debug|refactor|sql|python|rust)\b",
        r"\b(compare|evaluate|trade.?off|pros?\s+and\s+cons?)\b",
    ]

    SIMPLE_PATTERNS: List[str] = [
        r"^(hi|hello|hey|thanks|thank you)\b",
        r"\b(what is|define|who is|when was)\b",
        r"\b(yes|no|ok|sure)\b",
    ]

    INTENT_KEYWORDS = {
        "coding": ["code", "function", "bug", "api", "sql"],
        "factual": ["what", "who", "when", "define", "explain"],
        "creative": ["write", "story", "poem", "brainstorm"],
        "reasoning": ["why", "analyze", "compare", "prove"],
    }

    def __init__(self, config: SemanticLayerConfig) -> None:
        self.config = config
        self._complex_res = [re.compile(p, re.I) for p in self.COMPLEX_PATTERNS]
        self._simple_res = [re.compile(p, re.I) for p in self.SIMPLE_PATTERNS]
        # Word-boundary matchers per intent keyword. Substring matching
        # (`kw in prompt`) produced false hits — "somewhat" -> "what" ->
        # factual, "apindex" -> "api" -> coding — and intent is a hard cache
        # partition key, so those misfires silently fragment the cache.
        self._intent_res: Dict[str, List[Pattern[str]]] = {
            intent: [re.compile(rf"\b{re.escape(kw)}\b", re.I) for kw in kws]
            for intent, kws in self.INTENT_KEYWORDS.items()
        }

    def classify_intent(self, prompt: str) -> str:
        scores = {
            intent: sum(1 for r in regexes if r.search(prompt))
            for intent, regexes in self._intent_res.items()
        }
        best = max(scores, key=scores.get)
        return best if scores[best] > 0 else "general"

    def complexity_score(
        self, prompt: str, embedding: Optional[NDArray[np.float32]] = None
    ) -> float:
        """Score in [0, 1]. Higher = more complex.

        `embedding` is accepted for backwards compatibility but no longer used:
        the former "embedding norm deviation" signal was always ~0 because the
        embedder L2-normalizes every vector, so it contributed nothing while
        eating 15% of the score weight. The two remaining signals are reweighted
        to sum to 1.
        """
        tokens = len(prompt.split())
        length_score = min(tokens / 512.0, 1.0)

        complex_hits = sum(1 for r in self._complex_res if r.search(prompt))
        simple_hits = sum(1 for r in self._simple_res if r.search(prompt))
        pattern_score = float(np.clip((complex_hits - simple_hits) / 4.0 + 0.5, 0, 1))

        return float(0.6 * length_score + 0.4 * pattern_score)

    def route(
        self,
        prompt: str,
        embedding: Optional[NDArray[np.float32]] = None,
        *,
        force_large: bool = False,
    ) -> RouteDecision:
        intent = self.classify_intent(prompt)
        score = self.complexity_score(prompt)

        if force_large:
            tier = ModelTier.LARGE
            reason = f"OOD bump; base complexity ({score:.2f})"
        elif score < self.config.complexity_threshold * 0.5:
            tier = ModelTier.SMALL
            reason = f"low complexity ({score:.2f})"
        elif score < self.config.complexity_threshold:
            tier = ModelTier.MEDIUM
            reason = f"medium complexity ({score:.2f})"
        else:
            tier = ModelTier.LARGE
            reason = f"high complexity ({score:.2f})"

        if intent == "reasoning" and tier == ModelTier.SMALL:
            tier = ModelTier.MEDIUM
            reason += "; reasoning intent bump"

        model_name = self.config.tier_models[tier]
        return RouteDecision(
            tier=tier,
            model_name=model_name,
            complexity_score=score,
            intent=intent,
            reasoning=reason,
        )
