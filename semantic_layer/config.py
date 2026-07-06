from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Dict, Optional, Tuple


class ModelTier(str, Enum):
    SMALL = "small"  # 1B–3B
    MEDIUM = "medium"  # 4B–8B
    LARGE = "large"  # 13B–70B


@dataclass(frozen=True)
class SemanticLayerConfig:
    # Embedding
    embed_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embed_dim: int = 384
    embed_batch_size: int = 32
    embed_device: str = "cpu"

    # Cache
    cache_backend: str = "faiss"
    cache_max_entries: int = 10_000
    cache_ttl_seconds: int = 86_400
    cache_initial_threshold: float = 0.88
    cache_fp_epsilon: float = 0.02
    cache_ann_top_k: int = 5
    # Caching is skipped for these intents (non-deterministic / low-reuse) and
    # for requests hotter than the temperature ceiling, so we never serve a
    # cached generation where the caller expected fresh sampling.
    cache_skip_intents: Tuple[str, ...] = ("creative",)
    cache_max_cacheable_temperature: float = 0.7
    # Optional directory for on-disk persistence of the cache + OOD state.
    # None (the default) keeps everything in-memory, which is what the unit
    # tests rely on. The server wires a real path so hit-rate survives restarts.
    cache_persist_path: Optional[str] = None

    # Router
    complexity_threshold: float = 0.62
    small_model: str = "llama3.2:1b"
    medium_model: str = "llama3.2:3b"
    large_model: str = "llama3.1:8b"

    # Compressor
    chunk_threshold: float = 0.55
    max_context_tokens: int = 2048
    avg_chars_per_token: float = 4.0
    chunk_size: int = 512
    chunk_overlap: int = 64

    # OOD
    ood_sigma_threshold: float = 3.5
    ood_threshold_boost: float = 0.05
    ood_min_samples: int = 50

    # Performance / resource limits
    target_overhead_ms: float = 15.0
    max_concurrent_llm: int = 2
    enable_cache: bool = True
    enable_compression: bool = True

    @property
    def tier_models(self) -> Dict[ModelTier, str]:
        """Single source of truth: derived from the scalar model fields.

        Previously this was a separate ``field`` holding a duplicate of the
        three ``*_model`` defaults, which could silently drift out of sync when
        a config was constructed with only the scalar fields set.
        """
        return {
            ModelTier.SMALL: self.small_model,
            ModelTier.MEDIUM: self.medium_model,
            ModelTier.LARGE: self.large_model,
        }
