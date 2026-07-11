from __future__ import annotations

import hashlib
import json
import stat
import time
from dataclasses import dataclass, field
from pathlib import Path
from threading import RLock
from typing import Dict, List, Optional, Tuple

import numpy as np
from numpy.typing import NDArray

from .config import ModelTier, SemanticLayerConfig
from .security import secure_cache_dir


@dataclass
class CacheEntry:
    id: int
    prompt: str
    response: str
    intent: str
    model_tier: ModelTier
    params_hash: str
    created_at: float
    last_accessed: float
    expires_at: float
    hit_count: int = 0
    doc_version: str = "v1"


@dataclass
class CacheLookupResult:
    hit: bool
    response: Optional[str] = None
    similarity: float = 0.0
    entry_id: Optional[str] = None
    bypassed: bool = False  # True when strict OOD bypasses cache entirely


@dataclass
class ThresholdCalibrator:
    """Online threshold tuning with false-positive guard."""

    threshold: float
    alpha: float = 0.01
    beta: float = 0.05
    margin: float = 0.02
    fp_events: List[float] = field(default_factory=list)

    def record_hit(self, similarity: float, accepted: bool) -> None:
        if accepted:
            if similarity < self.threshold:
                self.threshold -= self.alpha * (self.threshold - similarity)
        else:
            self.threshold = min(
                0.99,
                self.threshold + self.beta * (similarity - self.threshold + self.margin),
            )
            self.fp_events.append(similarity)

    def auto_tune(self, events: List[Tuple[float, bool]], epsilon: float) -> float:
        """Offline sweep over labeled (similarity, accepted) events."""
        best_t, best_hr = self.threshold, 0.0
        for t in np.linspace(0.75, 0.98, 46):
            tp = fp = tn = fn = 0
            for sim, accepted in events:
                predicted_hit = sim >= t
                if predicted_hit and accepted:
                    tp += 1
                elif predicted_hit and not accepted:
                    fp += 1
                elif not predicted_hit and accepted:
                    fn += 1
                else:
                    tn += 1
            fpr = fp / (fp + tn + 1e-9)
            hr = (tp + fp) / (len(events) + 1e-9)
            if fpr <= epsilon and hr > best_hr:
                best_hr, best_t = hr, float(t)
        self.threshold = best_t
        return best_t


class SemanticCache:
    """
    FAISS IndexIDMap2(IndexFlatIP) cache (cosine similarity via L2-normalized
    vectors). Supports dynamic threshold calibration, TTL + LRU eviction,
    multi-signal guards, and optional on-disk persistence.

    Entries are keyed by a monotonic integer id which is also the FAISS id, so
    removals are a single C-level ``remove_ids`` call instead of rebuilding the
    whole index (the previous design re-added every vector on every eviction —
    O(n) work per removal, O(n^2) when a batch expired at once).
    """

    def __init__(self, config: SemanticLayerConfig) -> None:
        self.config = config
        self._lock = RLock()
        self._entries: Dict[int, CacheEntry] = {}
        self._next_id = 0
        self._calibrator = ThresholdCalibrator(threshold=config.cache_initial_threshold)

        import faiss

        self._faiss = faiss
        self._index = faiss.IndexIDMap2(faiss.IndexFlatIP(config.embed_dim))

    @property
    def dynamic_threshold(self) -> float:
        return self._calibrator.threshold

    @property
    def size(self) -> int:
        return len(self._entries)

    @staticmethod
    def params_hash(
        temperature: float,
        system_prompt: str,
        tools_version: str,
        rag_fingerprint: str = "",
        max_tokens: int = 0,
    ) -> str:
        """Content-addressed key over everything that changes the answer.

        ``rag_fingerprint`` and ``max_tokens`` are part of the key so that the
        same prompt with different retrieved context (or a different generation
        budget) never collides onto a stale cached response.
        """
        raw = (
            f"{temperature:.2f}|{system_prompt}|{tools_version}"
            f"|{rag_fingerprint}|{max_tokens}"
        )
        return hashlib.sha256(raw.encode()).hexdigest()[:16]

    def _cosine_top_k(
        self, query_emb: NDArray[np.float32], k: int
    ) -> List[Tuple[int, float]]:
        if self._index.ntotal == 0:
            return []
        q = query_emb.reshape(1, -1).astype(np.float32)
        similarities, ids = self._index.search(q, min(k, self._index.ntotal))
        results: List[Tuple[int, float]] = []
        for sim, fid in zip(similarities[0], ids[0]):
            if fid < 0:
                continue
            results.append((int(fid), float(sim)))
        return results

    def lookup(
        self,
        query_emb: NDArray[np.float32],
        intent: str,
        model_tier: ModelTier,
        params_hash: str,
        ood_score: float = 0.0,
        doc_version: Optional[str] = None,
    ) -> CacheLookupResult:
        """
        Multi-signal cache lookup with dynamic threshold and OOD guard.

        Strict OOD (score > threshold): bypass cache entirely — no ANN search,
        no threshold boost that could still allow a hit on a subsequent code path.

        This method never mutates the FAISS index: expired entries are skipped
        (not served) and swept lazily on the next ``store``, keeping the hot
        cache-hit path free of index maintenance.
        """
        with self._lock:
            if self._index.ntotal == 0:
                return CacheLookupResult(hit=False)

            # Strict OOD: bypass cache entirely (do not search or serve cached responses)
            if ood_score > self.config.ood_sigma_threshold:
                return CacheLookupResult(hit=False, similarity=0.0, bypassed=True)

            effective_tau = self._effective_threshold(ood_score)
            candidates = self._cosine_top_k(query_emb, self.config.cache_ann_top_k)
            now = time.time()

            for entry_id, sim in candidates:
                if sim < effective_tau:
                    break

                entry = self._entries.get(entry_id)
                if entry is None:
                    continue

                if now > entry.expires_at:
                    continue  # expired: skip, swept on next store
                if entry.intent != intent:
                    continue
                if entry.model_tier != model_tier:
                    continue
                if entry.params_hash != params_hash:
                    continue
                if doc_version is not None and entry.doc_version != doc_version:
                    continue

                entry.last_accessed = now
                entry.hit_count += 1
                return CacheLookupResult(
                    hit=True,
                    response=entry.response,
                    similarity=sim,
                    entry_id=str(entry_id),
                )

            best_sim = candidates[0][1] if candidates else 0.0
            return CacheLookupResult(hit=False, similarity=best_sim)

    def store(
        self,
        query_emb: NDArray[np.float32],
        prompt: str,
        response: str,
        intent: str,
        model_tier: ModelTier,
        params_hash: str,
        ttl_seconds: Optional[int] = None,
        doc_version: str = "v1",
    ) -> str:
        with self._lock:
            self._evict_if_needed()

            entry_id = self._next_id
            self._next_id += 1
            now = time.time()
            ttl = ttl_seconds or self.config.cache_ttl_seconds

            entry = CacheEntry(
                id=entry_id,
                prompt=prompt,
                response=response,
                intent=intent,
                model_tier=model_tier,
                params_hash=params_hash,
                created_at=now,
                last_accessed=now,
                expires_at=now + ttl,
                doc_version=doc_version,
            )
            self._entries[entry_id] = entry
            self._index.add_with_ids(
                query_emb.reshape(1, -1).astype(np.float32),
                np.array([entry_id], dtype=np.int64),
            )
            return str(entry_id)

    def invalidate_by_doc_version(self, current_version: str) -> int:
        """Remove entries whose doc_version does not match the current corpus version."""
        with self._lock:
            stale = [
                eid
                for eid, entry in self._entries.items()
                if entry.doc_version != current_version
            ]
            self._remove_entries(stale)
            return len(stale)

    def _evict_if_needed(self) -> None:
        now = time.time()
        dead = [eid for eid, e in self._entries.items() if now > e.expires_at]
        dead_set = set(dead)

        # LRU: evict oldest live entries until there is room for one more.
        max_entries = self.config.cache_max_entries
        while len(self._entries) - len(dead_set) >= max_entries:
            live = (eid for eid in self._entries if eid not in dead_set)
            try:
                lru_id = min(live, key=lambda k: self._entries[k].last_accessed)
            except ValueError:
                break
            dead.append(lru_id)
            dead_set.add(lru_id)

        self._remove_entries(dead)

    def _remove_entries(self, ids: List[int]) -> None:
        """Batch-remove entries from the dict and the FAISS index in one call."""
        if not ids:
            return
        for eid in ids:
            self._entries.pop(eid, None)
        self._index.remove_ids(np.array(ids, dtype=np.int64))

    def feedback(self, entry_id: str, accepted: bool, similarity: float) -> None:
        self._calibrator.record_hit(similarity, accepted)

    def set_threshold(self, threshold: float) -> None:
        """Apply runtime config sync from the LiquiTask settings UI."""
        self._calibrator.threshold = float(np.clip(threshold, 0.75, 0.99))

    def _effective_threshold(self, ood_score: float) -> float:
        """
        Dynamic cosine threshold τ(q).

        Base τ comes from online calibration. Moderate OOD (0 < score ≤ σ)
        raises τ proportionally to reduce false-positive cache hits on
        distribution-shifted queries without fully bypassing the cache.
        """
        tau = self.dynamic_threshold
        if ood_score <= 0:
            return tau
        sigma = self.config.ood_sigma_threshold
        if ood_score >= sigma:
            return tau
        ratio = ood_score / sigma
        boosted = tau + self.config.ood_threshold_boost * ratio
        return float(min(boosted, 0.99))

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------
    def save(self, directory: str) -> None:
        """Persist the FAISS index + entry metadata + calibrated threshold."""
        with self._lock:
            path = Path(directory)
            secure_cache_dir(path)
            self._faiss.write_index(self._index, str(path / "cache.index"))
            meta = {
                "next_id": self._next_id,
                "threshold": self._calibrator.threshold,
                "fp_events": self._calibrator.fp_events,
                "entries": [
                    {
                        "id": e.id,
                        "prompt": e.prompt,
                        "response": e.response,
                        "intent": e.intent,
                        "model_tier": e.model_tier.value,
                        "params_hash": e.params_hash,
                        "created_at": e.created_at,
                        "last_accessed": e.last_accessed,
                        "expires_at": e.expires_at,
                        "hit_count": e.hit_count,
                        "doc_version": e.doc_version,
                    }
                    for e in self._entries.values()
                ],
            }
            tmp = path / "cache.meta.json.tmp"
            tmp.write_text(json.dumps(meta))
            try:
                tmp.chmod(stat.S_IRUSR | stat.S_IWUSR)
            except OSError:
                pass
            tmp.replace(path / "cache.meta.json")
            secure_cache_dir(path)

    def load(self, directory: str) -> bool:
        """Restore a previously saved cache. Returns False if nothing on disk."""
        path = Path(directory)
        index_file = path / "cache.index"
        meta_file = path / "cache.meta.json"
        if not index_file.is_file() or not meta_file.is_file():
            return False

        with self._lock:
            try:
                index = self._faiss.read_index(str(index_file))
                meta = json.loads(meta_file.read_text())
            except (OSError, ValueError, json.JSONDecodeError):
                return False

            if index.d != self.config.embed_dim:
                return False  # embedding model/dim changed — discard stale cache

            self._index = index
            self._next_id = int(meta.get("next_id", 0))
            self._calibrator.threshold = float(
                meta.get("threshold", self.config.cache_initial_threshold)
            )
            self._calibrator.fp_events = list(meta.get("fp_events", []))

            now = time.time()
            self._entries = {}
            expired: List[int] = []
            for d in meta.get("entries", []):
                entry = CacheEntry(
                    id=int(d["id"]),
                    prompt=d["prompt"],
                    response=d["response"],
                    intent=d["intent"],
                    model_tier=ModelTier(d["model_tier"]),
                    params_hash=d["params_hash"],
                    created_at=d["created_at"],
                    last_accessed=d["last_accessed"],
                    expires_at=d["expires_at"],
                    hit_count=d.get("hit_count", 0),
                    doc_version=d.get("doc_version", "v1"),
                )
                if now > entry.expires_at:
                    expired.append(entry.id)
                else:
                    self._entries[entry.id] = entry

            # Drop any vectors whose metadata expired so index and dict align.
            if expired:
                self._index.remove_ids(np.array(expired, dtype=np.int64))
            return True

    def stats(self) -> Dict[str, float | int]:
        """Snapshot for /v1/stats and benchmarking."""
        return {
            "size": len(self._entries),
            "dynamic_threshold": self.dynamic_threshold,
            "fp_events": len(self._calibrator.fp_events),
        }
