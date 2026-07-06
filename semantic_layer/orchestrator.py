from __future__ import annotations

import asyncio
import hashlib
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .backends.base import LLMBackend
from .backends.ollama import OllamaBackend
from .cache import SemanticCache
from .compressor import SemanticCompressor
from .config import SemanticLayerConfig
from .embedder import Embedder
from .ood import OODDetector
from .router import SemanticRouter


@dataclass
class PipelineMetrics:
    embed_ms: float = 0.0
    cache_ms: float = 0.0
    route_ms: float = 0.0
    compress_ms: float = 0.0
    llm_ms: float = 0.0
    total_semantic_ms: float = 0.0
    cache_hit: bool = False
    cache_bypassed: bool = False
    route_tier: str = ""
    ood_score: float = 0.0
    is_ood: bool = False
    # RAG compression observability: whether retrieved context survived the
    # relevance filter, how many chunks were dropped, and the packed token count.
    rag_context_used: bool = False
    compress_dropped: int = 0
    compress_context_tokens: int = 0


@dataclass
class PipelineResult:
    text: str
    metrics: PipelineMetrics
    model_used: str
    cache_entry_id: Optional[str] = None


def rag_fingerprint(rag_documents: Optional[List[Tuple[str, str]]]) -> str:
    """Order-sensitive content hash of the retrieved documents.

    Folded into the cache key so the same prompt with different context does not
    collide onto a stale answer. Empty string when there are no documents.
    """
    if not rag_documents:
        return ""
    h = hashlib.sha256()
    for source, text in rag_documents:
        h.update(source.encode())
        h.update(b"\x00")
        h.update(text.encode())
        h.update(b"\x00")
    return h.hexdigest()[:16]


class SemanticOrchestrator:
    """
    Main entry point: wires cache → router → compressor → LLM.
    Target: <15 ms semantic overhead on cache hits.
    """

    def __init__(
        self,
        config: Optional[SemanticLayerConfig] = None,
        backend: Optional[LLMBackend] = None,
        embedder: Optional[Embedder] = None,
    ) -> None:
        self.config = config or SemanticLayerConfig()
        self.embedder = embedder or Embedder(self.config)
        self.cache = SemanticCache(self.config)
        self.router = SemanticRouter(self.config)
        self.compressor = SemanticCompressor(self.config, self.embedder)
        self.ood = OODDetector(
            dim=self.config.embed_dim,
            min_samples=self.config.ood_min_samples,
        )
        self.backend = backend or OllamaBackend()
        self._llm_semaphore = (
            asyncio.Semaphore(self.config.max_concurrent_llm)
            if self.config.max_concurrent_llm > 0
            else None
        )
        self.load_state()

    def apply_config(self, config: SemanticLayerConfig) -> None:
        """Hot-reload tunables in place, preserving the live cache/OOD/calibration.

        Only side effects that actually depend on a *changed* value are applied:
        the online-calibrated threshold is left untouched unless the configured
        base threshold moved, and the concurrency semaphore is only rebuilt when
        the bound changes (rebuilding it every call reset in-flight permit
        accounting and defeated the concurrency cap). The embedder singleton is
        never rebuilt — model/device changes require a full restart.
        """
        prev = self.config
        self.config = config
        # Propagate to sub-components so tunables like cache size, TTL, chunk
        # thresholds, and model tiers actually take effect.
        self.cache.config = config
        self.router.config = config
        self.compressor.config = config
        self.ood.min_samples = config.ood_min_samples

        if config.cache_initial_threshold != prev.cache_initial_threshold:
            self.cache.set_threshold(config.cache_initial_threshold)

        if config.max_concurrent_llm != prev.max_concurrent_llm:
            self._llm_semaphore = (
                asyncio.Semaphore(config.max_concurrent_llm)
                if config.max_concurrent_llm > 0
                else None
            )

    def _is_cacheable(self, intent: str, temperature: float) -> bool:
        """Guard against caching non-deterministic / low-reuse generations."""
        if intent in self.config.cache_skip_intents:
            return False
        if temperature > self.config.cache_max_cacheable_temperature:
            return False
        return True

    def stats(self) -> Dict[str, Any]:
        return {
            "cache": self.cache.stats(),
            "ood_samples": self.ood.sample_count,
            "ood_ready": self.ood.ready,
        }

    async def run(
        self,
        prompt: str,
        rag_documents: Optional[List[Tuple[str, str]]] = None,
        system_prompt: str = "",
        temperature: float = 0.7,
        max_tokens: int = 1024,
        tools_version: str = "v0",
        doc_version: str = "v1",
    ) -> PipelineResult:
        metrics = PipelineMetrics()
        t0 = time.perf_counter()

        t_embed = time.perf_counter()
        query_emb = self.embedder.encode_one(prompt)
        metrics.embed_ms = (time.perf_counter() - t_embed) * 1000

        ood_score = self.ood.score(query_emb)
        metrics.ood_score = ood_score
        is_ood = ood_score > self.config.ood_sigma_threshold
        metrics.is_ood = is_ood
        self.ood.update(query_emb)

        t_route = time.perf_counter()
        route = self.router.route(prompt, query_emb, force_large=is_ood)
        metrics.route_ms = (time.perf_counter() - t_route) * 1000
        metrics.route_tier = route.tier.value

        params_hash = SemanticCache.params_hash(
            temperature,
            system_prompt,
            tools_version,
            rag_fingerprint=rag_fingerprint(rag_documents),
            max_tokens=max_tokens,
        )
        cacheable = self._is_cacheable(route.intent, temperature)

        if self.config.enable_cache and cacheable:
            t_cache = time.perf_counter()
            cache_result = self.cache.lookup(
                query_emb,
                intent=route.intent,
                model_tier=route.tier,
                params_hash=params_hash,
                ood_score=ood_score,
                doc_version=doc_version,
            )
            metrics.cache_ms = (time.perf_counter() - t_cache) * 1000
            metrics.cache_bypassed = cache_result.bypassed

            if cache_result.hit and cache_result.response is not None:
                metrics.cache_hit = True
                metrics.total_semantic_ms = (time.perf_counter() - t0) * 1000
                return PipelineResult(
                    text=cache_result.response,
                    metrics=metrics,
                    model_used="cache",
                    cache_entry_id=cache_result.entry_id,
                )

        final_prompt = prompt
        if rag_documents and self.config.enable_compression:
            t_compress = time.perf_counter()
            compressed = self.compressor.compress(prompt, rag_documents)
            metrics.compress_dropped = compressed.dropped_count
            metrics.compress_context_tokens = compressed.total_tokens
            if compressed.compressed_context:
                metrics.rag_context_used = True
                final_prompt = (
                    f"Context:\n{compressed.compressed_context}\n\n"
                    f"Question: {prompt}"
                )
            metrics.compress_ms = (time.perf_counter() - t_compress) * 1000

        metrics.total_semantic_ms = (time.perf_counter() - t0) * 1000

        if self._llm_semaphore is not None:
            async with self._llm_semaphore:
                llm_response = await self.backend.generate(
                    model=route.model_name,
                    prompt=final_prompt,
                    system=system_prompt or None,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
        else:
            llm_response = await self.backend.generate(
                model=route.model_name,
                prompt=final_prompt,
                system=system_prompt or None,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        metrics.llm_ms = llm_response.latency_ms

        entry_id: Optional[str] = None
        if self.config.enable_cache and cacheable and not is_ood:
            entry_id = self.cache.store(
                query_emb=query_emb,
                prompt=prompt,
                response=llm_response.text,
                intent=route.intent,
                model_tier=route.tier,
                params_hash=params_hash,
                doc_version=doc_version,
            )

        return PipelineResult(
            text=llm_response.text,
            metrics=metrics,
            model_used=route.model_name,
            cache_entry_id=entry_id,
        )

    def record_feedback(self, entry_id: str, accepted: bool, similarity: float) -> None:
        """Call after user rates response to tune dynamic threshold."""
        self.cache.feedback(entry_id, accepted, similarity)

    def invalidate_stale_docs(self, current_version: str) -> int:
        return self.cache.invalidate_by_doc_version(current_version)

    # ------------------------------------------------------------------
    # Persistence (no-op unless config.cache_persist_path is set)
    # ------------------------------------------------------------------
    def _ood_state_file(self) -> Optional[Path]:
        if not self.config.cache_persist_path:
            return None
        return Path(self.config.cache_persist_path) / "ood.json"

    def save_state(self) -> None:
        path = self.config.cache_persist_path
        if not path:
            return
        try:
            self.cache.save(path)
            ood_file = self._ood_state_file()
            if ood_file is not None:
                ood_file.write_text(json.dumps(self.ood.state()))
        except OSError:
            pass

    def load_state(self) -> None:
        path = self.config.cache_persist_path
        if not path:
            return
        try:
            self.cache.load(path)
            ood_file = self._ood_state_file()
            if ood_file is not None and ood_file.is_file():
                self.ood.load_state(json.loads(ood_file.read_text()))
        except (OSError, ValueError, json.JSONDecodeError):
            pass
