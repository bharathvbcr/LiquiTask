from __future__ import annotations

import numpy as np

from semantic_layer.benchmark import evaluate_routing
from semantic_layer.config import ModelTier, SemanticLayerConfig
from semantic_layer.router import SemanticRouter


def test_routes_simple_prompt_to_small_tier() -> None:
    router = SemanticRouter(SemanticLayerConfig())
    emb = np.ones(384, dtype=np.float32) / np.sqrt(384)
    decision = router.route("What is photosynthesis?", emb)
    assert decision.tier == ModelTier.SMALL
    assert decision.intent == "factual"


def test_routes_complex_prompt_to_large_tier() -> None:
    config = SemanticLayerConfig(complexity_threshold=0.35)
    router = SemanticRouter(config)
    emb = np.ones(384, dtype=np.float32) / np.sqrt(384)
    prompt = (
        "Prove and derive a multi-step chain-of-thought analysis to architect, "
        "implement, debug, and refactor a Rust microservice with SQL trade-offs."
    )
    decision = router.route(prompt, emb)
    assert decision.tier == ModelTier.LARGE


def test_force_large_on_ood() -> None:
    router = SemanticRouter(SemanticLayerConfig())
    emb = np.ones(384, dtype=np.float32) / np.sqrt(384)
    decision = router.route("hi", emb, force_large=True)
    assert decision.tier == ModelTier.LARGE


def test_word_boundary_intent_avoids_substring_false_positive() -> None:
    # M-2: "somewhat" must not match the factual keyword "what".
    router = SemanticRouter(SemanticLayerConfig())
    assert router.classify_intent("Tell me somewhat about foxes") != "factual"
    assert router.classify_intent("what is a fox") == "factual"


def test_complexity_is_independent_of_embedding() -> None:
    # M-3: the (dead) embedding-norm term is gone, so score is identical whether
    # or not an embedding is supplied.
    router = SemanticRouter(SemanticLayerConfig())
    with_emb = router.complexity_score(
        "prove and derive the theorem", np.zeros(384, dtype=np.float32)
    )
    without_emb = router.complexity_score("prove and derive the theorem")
    assert with_emb == without_emb


def test_evaluate_routing_reports_accuracy() -> None:
    router = SemanticRouter(SemanticLayerConfig(complexity_threshold=0.35))
    labeled = [
        ("hello", ModelTier.SMALL),
        (
            "Prove and derive a multi-step chain-of-thought analysis to architect, "
            "implement, and refactor a Rust microservice with SQL trade-offs.",
            ModelTier.LARGE,
        ),
    ]
    report = evaluate_routing(router, labeled)
    assert report.n == 2
    assert report.accuracy == 1.0
    assert report.confusions == []
