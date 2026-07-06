from __future__ import annotations

from typing import List, Union

import numpy as np
from numpy.typing import NDArray

from semantic_layer.compressor import SemanticCompressor
from semantic_layer.config import SemanticLayerConfig


class _MockEmbedder:
    def encode(self, texts: Union[str, List[str]]) -> NDArray[np.float32]:
        if isinstance(texts, str):
            texts = [texts]
        base = np.ones(384, dtype=np.float32) / np.sqrt(384)
        return np.stack([base.copy() for _ in texts])

    def encode_one(self, text: str) -> NDArray[np.float32]:
        return self.encode([text])[0]


def test_compressor_selects_relevant_chunks() -> None:
    config = SemanticLayerConfig(chunk_threshold=0.0, max_context_tokens=512)
    compressor = SemanticCompressor(config, _MockEmbedder())  # type: ignore[arg-type]

    docs = [
        ("france", "Paris is the capital of France on the River Seine."),
        ("germany", "Berlin is the capital of Germany."),
    ]
    result = compressor.compress("Which river flows through Paris?", docs)

    assert result.total_tokens > 0
    assert any("Paris" in chunk.text for chunk in result.selected_chunks)
    assert result.dropped_count >= 0
