from __future__ import annotations

import threading
from typing import List, Optional, Union

import numpy as np
from numpy.typing import NDArray

from ._frozen import bundled_embed_model_path, configure_frozen_environment
from .config import SemanticLayerConfig


class Embedder:
    """
    Thread-safe singleton embedder using sentence-transformers.
    Warm-up on first init eliminates cold-start JIT overhead.
    """

    _instance: Optional["Embedder"] = None
    _lock = threading.Lock()

    def __new__(cls, config: SemanticLayerConfig) -> "Embedder":
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self, config: SemanticLayerConfig) -> None:
        if getattr(self, "_initialized", False):
            return
        self.config = config
        configure_frozen_environment()
        from sentence_transformers import SentenceTransformer

        model_name = config.embed_model
        bundled_model = bundled_embed_model_path()
        if bundled_model is not None:
            model_name = str(bundled_model)

        self._model = SentenceTransformer(
            model_name,
            device=config.embed_device,
        )
        _ = self._model.encode(["warmup"], normalize_embeddings=True)
        self._initialized = True

    def encode(self, texts: Union[str, List[str]]) -> NDArray[np.float32]:
        """Return L2-normalized embeddings, shape (n, embed_dim)."""
        if isinstance(texts, str):
            texts = [texts]
        vectors: NDArray[np.float32] = self._model.encode(
            texts,
            batch_size=self.config.embed_batch_size,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return vectors.astype(np.float32)

    def encode_one(self, text: str) -> NDArray[np.float32]:
        return self.encode([text])[0]

    @classmethod
    def reset_singleton(cls) -> None:
        """Reset singleton (primarily for tests)."""
        with cls._lock:
            cls._instance = None
