from __future__ import annotations

import asyncio
import hashlib
from typing import List, Union

import numpy as np
from numpy.typing import NDArray

from semantic_layer.backends.base import LLMResponse
from semantic_layer.config import SemanticLayerConfig
from semantic_layer.orchestrator import SemanticOrchestrator


class FakeEmbedder:
    """Deterministic per-text unit vectors — same text -> same vector."""

    def __init__(self, dim: int = 384) -> None:
        self.dim = dim

    def _vec(self, text: str) -> NDArray[np.float32]:
        seed = int.from_bytes(hashlib.sha256(text.encode()).digest()[:8], "little")
        v = np.random.default_rng(seed).standard_normal(self.dim).astype(np.float32)
        return v / np.linalg.norm(v)

    def encode(self, texts: Union[str, List[str]]) -> NDArray[np.float32]:
        if isinstance(texts, str):
            texts = [texts]
        return np.stack([self._vec(t) for t in texts])

    def encode_one(self, text: str) -> NDArray[np.float32]:
        return self.encode([text])[0]


class FakeBackend:
    """Records calls and returns a unique response each time."""

    def __init__(self) -> None:
        self.calls = 0
        self.base_url = "http://fake"

    async def generate(self, model, prompt, system=None, temperature=0.7, max_tokens=1024):
        self.calls += 1
        return LLMResponse(text=f"resp-{self.calls}", model=model, latency_ms=1.0)


def _make(config=None):
    backend = FakeBackend()
    orch = SemanticOrchestrator(
        config or SemanticLayerConfig(),
        backend=backend,
        embedder=FakeEmbedder(),
    )
    return orch, backend


def test_repeat_query_hits_cache() -> None:
    orch, backend = _make()
    r1 = asyncio.run(orch.run("what is the capital of France", temperature=0.2))
    r2 = asyncio.run(orch.run("what is the capital of France", temperature=0.2))
    assert backend.calls == 1  # second served from cache
    assert r2.metrics.cache_hit
    assert r1.text == r2.text == "resp-1"


def test_different_rag_context_does_not_reuse_cached_answer() -> None:
    # C-1: identical prompt, different retrieved docs -> must NOT reuse answer.
    orch, backend = _make()
    docs_a = [("ctx", "Overdue: buy milk")]
    docs_b = [("ctx", "Overdue: file taxes")]

    r1 = asyncio.run(orch.run("summarize overdue", rag_documents=docs_a, temperature=0.2))
    r2 = asyncio.run(orch.run("summarize overdue", rag_documents=docs_b, temperature=0.2))
    r3 = asyncio.run(orch.run("summarize overdue", rag_documents=docs_a, temperature=0.2))

    assert backend.calls == 2  # a and b each hit the model once
    assert r1.text != r2.text  # different context -> different (fresh) answer
    assert r3.metrics.cache_hit  # repeating context a hits the cache
    assert r3.text == r1.text


def test_creative_intent_is_not_cached() -> None:
    # M-5: non-deterministic intents skip the cache entirely.
    orch, backend = _make()
    asyncio.run(orch.run("write a story about a fox", temperature=0.2))
    asyncio.run(orch.run("write a story about a fox", temperature=0.2))
    assert backend.calls == 2
    assert orch.cache.size == 0


def test_high_temperature_is_not_cached() -> None:
    orch, backend = _make(SemanticLayerConfig(cache_max_cacheable_temperature=0.7))
    asyncio.run(orch.run("what is the capital of France", temperature=0.9))
    asyncio.run(orch.run("what is the capital of France", temperature=0.9))
    assert backend.calls == 2
    assert orch.cache.size == 0


def test_apply_config_preserves_calibrated_threshold_and_semaphore() -> None:
    # C-2: hot-reloading config with an unchanged base must not reset the
    # online-calibrated threshold nor rebuild the concurrency semaphore.
    orch, _ = _make(SemanticLayerConfig(cache_initial_threshold=0.88, max_concurrent_llm=2))
    orch.cache.set_threshold(0.93)  # simulate online calibration
    sem_before = orch._llm_semaphore

    orch.apply_config(SemanticLayerConfig(cache_initial_threshold=0.88, max_concurrent_llm=2))
    assert orch.cache.dynamic_threshold == 0.93  # not clobbered
    assert orch._llm_semaphore is sem_before  # same object -> permit accounting intact

    # Changing the configured base *does* re-apply it.
    orch.apply_config(SemanticLayerConfig(cache_initial_threshold=0.80, max_concurrent_llm=3))
    assert orch.cache.dynamic_threshold == 0.80
    assert orch._llm_semaphore is not sem_before


def test_cache_survives_config_apply() -> None:
    # C-3 (orchestrator half): applying config keeps the populated cache.
    orch, backend = _make()
    asyncio.run(orch.run("what is the capital of France", temperature=0.2))
    assert orch.cache.size == 1
    orch.apply_config(SemanticLayerConfig(cache_max_entries=5000))
    assert orch.cache.size == 1  # cache not discarded
    r = asyncio.run(orch.run("what is the capital of France", temperature=0.2))
    assert r.metrics.cache_hit and backend.calls == 1


def test_state_persists_across_orchestrators(tmp_path) -> None:
    # M-4: a fresh orchestrator with the same persist path warm-starts its cache.
    cfg = SemanticLayerConfig(cache_persist_path=str(tmp_path))
    orch1 = SemanticOrchestrator(cfg, backend=FakeBackend(), embedder=FakeEmbedder())
    asyncio.run(orch1.run("what is the capital of France", temperature=0.2))
    assert orch1.cache.size == 1
    orch1.save_state()

    backend2 = FakeBackend()
    orch2 = SemanticOrchestrator(cfg, backend=backend2, embedder=FakeEmbedder())
    assert orch2.cache.size == 1  # loaded from disk during __init__
    result = asyncio.run(orch2.run("what is the capital of France", temperature=0.2))
    assert result.metrics.cache_hit and backend2.calls == 0
