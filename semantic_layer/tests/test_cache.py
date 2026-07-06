from __future__ import annotations

import time

import numpy as np

from semantic_layer.cache import SemanticCache, ThresholdCalibrator
from semantic_layer.config import ModelTier, SemanticLayerConfig


def _unit_vector(seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    v = rng.standard_normal(384).astype(np.float32)
    return v / np.linalg.norm(v)


def test_cache_hit_on_near_duplicate() -> None:
    config = SemanticLayerConfig(cache_initial_threshold=0.85, embed_dim=384)
    cache = SemanticCache(config)
    emb = _unit_vector(1)
    params = SemanticCache.params_hash(0.4, "sys", "v0")

    cache.store(
        query_emb=emb,
        prompt="capital of France",
        response="Paris",
        intent="factual",
        model_tier=ModelTier.SMALL,
        params_hash=params,
    )

    near = emb * 0.99 + _unit_vector(2) * 0.01
    near /= np.linalg.norm(near)
    result = cache.lookup(
        near,
        intent="factual",
        model_tier=ModelTier.SMALL,
        params_hash=params,
    )
    assert result.hit
    assert result.response == "Paris"


def test_cache_miss_on_intent_mismatch() -> None:
    config = SemanticLayerConfig(cache_initial_threshold=0.80, embed_dim=384)
    cache = SemanticCache(config)
    emb = _unit_vector(3)
    params = SemanticCache.params_hash(0.4, "sys", "v0")

    cache.store(
        query_emb=emb,
        prompt="write a poem",
        response="roses are red",
        intent="creative",
        model_tier=ModelTier.SMALL,
        params_hash=params,
    )

    result = cache.lookup(
        emb,
        intent="factual",
        model_tier=ModelTier.SMALL,
        params_hash=params,
    )
    assert not result.hit


def test_strict_ood_bypasses_cache() -> None:
    config = SemanticLayerConfig(
        cache_initial_threshold=0.70,
        ood_sigma_threshold=3.5,
        embed_dim=384,
    )
    cache = SemanticCache(config)
    emb = _unit_vector(4)
    params = SemanticCache.params_hash(0.4, "sys", "v0")

    cache.store(
        query_emb=emb,
        prompt="hello",
        response="hi",
        intent="general",
        model_tier=ModelTier.SMALL,
        params_hash=params,
    )

    result = cache.lookup(
        emb,
        intent="general",
        model_tier=ModelTier.SMALL,
        params_hash=params,
        ood_score=4.0,
    )
    assert not result.hit
    assert result.bypassed


def test_lru_eviction() -> None:
    config = SemanticLayerConfig(cache_max_entries=2, embed_dim=384)
    cache = SemanticCache(config)
    params = SemanticCache.params_hash(0.4, "sys", "v0")

    for seed in (10, 11, 12):
        cache.store(
            query_emb=_unit_vector(seed),
            prompt=f"q{seed}",
            response=f"r{seed}",
            intent="general",
            model_tier=ModelTier.SMALL,
            params_hash=params,
        )
        time.sleep(0.001)

    assert cache.size == 2


def test_threshold_calibrator_raises_on_false_positive() -> None:
    cal = ThresholdCalibrator(threshold=0.88)
    cal.record_hit(similarity=0.91, accepted=False)
    assert cal.threshold > 0.88


def test_effective_threshold_boosts_under_moderate_ood() -> None:
    config = SemanticLayerConfig(
        cache_initial_threshold=0.88,
        ood_sigma_threshold=4.0,
        ood_threshold_boost=0.10,
    )
    cache = SemanticCache(config)
    boosted = cache._effective_threshold(ood_score=2.0)
    assert boosted == 0.93


def test_params_hash_includes_rag_and_max_tokens() -> None:
    # C-1: the same prompt/system with different retrieved context or a
    # different generation budget must produce a different cache key.
    base = SemanticCache.params_hash(0.4, "sys", "v0")
    with_rag = SemanticCache.params_hash(0.4, "sys", "v0", rag_fingerprint="abc")
    other_rag = SemanticCache.params_hash(0.4, "sys", "v0", rag_fingerprint="xyz")
    with_tokens = SemanticCache.params_hash(0.4, "sys", "v0", max_tokens=256)

    assert base != with_rag
    assert with_rag != other_rag
    assert base != with_tokens


def test_doc_version_guard() -> None:
    config = SemanticLayerConfig(cache_initial_threshold=0.80, embed_dim=384)
    cache = SemanticCache(config)
    emb = _unit_vector(7)
    params = SemanticCache.params_hash(0.4, "sys", "v0")

    cache.store(
        query_emb=emb,
        prompt="q",
        response="stale",
        intent="factual",
        model_tier=ModelTier.SMALL,
        params_hash=params,
        doc_version="v1",
    )

    miss = cache.lookup(
        emb, intent="factual", model_tier=ModelTier.SMALL,
        params_hash=params, doc_version="v2",
    )
    assert not miss.hit

    hit = cache.lookup(
        emb, intent="factual", model_tier=ModelTier.SMALL,
        params_hash=params, doc_version="v1",
    )
    assert hit.hit


def test_eviction_keeps_index_and_dict_consistent() -> None:
    # C-4: heavy churn must not desync the FAISS index from the entry dict,
    # and a surviving (recently accessed) entry must still be retrievable.
    config = SemanticLayerConfig(cache_max_entries=20, cache_initial_threshold=0.5)
    cache = SemanticCache(config)
    params = SemanticCache.params_hash(0.4, "sys", "v0")

    hot = _unit_vector(999)
    cache.store(hot, "hot", "HOT", "factual", ModelTier.SMALL, params)

    for seed in range(100):
        cache.store(_unit_vector(seed), f"q{seed}", f"r{seed}",
                    "factual", ModelTier.SMALL, params)
        # keep the hot entry fresh so LRU never evicts it
        cache.lookup(hot, intent="factual", model_tier=ModelTier.SMALL, params_hash=params)

    assert cache.size <= 20
    assert cache._index.ntotal == cache.size  # invariant: index aligned with dict
    result = cache.lookup(hot, intent="factual", model_tier=ModelTier.SMALL, params_hash=params)
    assert result.hit and result.response == "HOT"


def test_invalidate_by_doc_version_batches() -> None:
    config = SemanticLayerConfig(cache_initial_threshold=0.5)
    cache = SemanticCache(config)
    params = SemanticCache.params_hash(0.4, "sys", "v0")
    for seed in range(5):
        cache.store(_unit_vector(seed), f"q{seed}", f"r{seed}",
                    "factual", ModelTier.SMALL, params, doc_version="old")
    cache.store(_unit_vector(50), "new", "new", "factual", ModelTier.SMALL, params,
                doc_version="new")

    removed = cache.invalidate_by_doc_version("new")
    assert removed == 5
    assert cache.size == 1
    assert cache._index.ntotal == 1


def test_persistence_round_trip(tmp_path) -> None:
    # M-4: cache + calibrated threshold survive a save/load cycle.
    config = SemanticLayerConfig(cache_initial_threshold=0.80, embed_dim=384)
    cache = SemanticCache(config)
    params = SemanticCache.params_hash(0.4, "sys", "v0")
    emb = _unit_vector(3)
    cache.store(emb, "capital of France", "Paris", "factual", ModelTier.SMALL, params)
    cache.feedback("0", accepted=False, similarity=0.95)  # nudges threshold up
    tuned = cache.dynamic_threshold
    cache.save(str(tmp_path))

    restored = SemanticCache(config)
    assert restored.load(str(tmp_path))
    assert restored.size == 1
    assert restored._index.ntotal == 1
    assert abs(restored.dynamic_threshold - tuned) < 1e-9
    hit = restored.lookup(emb, intent="factual", model_tier=ModelTier.SMALL, params_hash=params)
    assert hit.hit and hit.response == "Paris"


def test_load_returns_false_when_absent(tmp_path) -> None:
    cache = SemanticCache(SemanticLayerConfig())
    assert cache.load(str(tmp_path)) is False
