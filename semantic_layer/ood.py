from __future__ import annotations

from typing import Any, Dict

import numpy as np
from numpy.typing import NDArray


class OODDetector:
    """
    Diagonal Mahalanobis distance using Welford's online mean/variance.
    Cold start: returns 0.0 until min_samples reached (no OOD blocking).
    """

    def __init__(self, dim: int, min_samples: int = 50) -> None:
        self.dim = dim
        self.min_samples = min_samples
        self._count = 0
        self._mean = np.zeros(dim, dtype=np.float64)
        # Welford's aggregate sum of squared deviations. MUST start at zero;
        # seeding it with ones inflated every dimension's variance (~9x for
        # L2-normalized MiniLM embeddings), which deflated the Mahalanobis
        # distance ~3x and effectively disabled the strict-OOD path while the
        # detector was young. The `ready` gate (count >= min_samples) plus the
        # epsilon floor in `score` already prevent divide-by-zero.
        self._m2 = np.zeros(dim, dtype=np.float64)

    def update(self, embedding: NDArray[np.float32]) -> None:
        self._count += 1
        x = embedding.astype(np.float64)
        delta = x - self._mean
        self._mean += delta / self._count
        delta2 = x - self._mean
        self._m2 += delta * delta2

    @property
    def ready(self) -> bool:
        return self._count >= self.min_samples

    @property
    def sample_count(self) -> int:
        return self._count

    def score(self, embedding: NDArray[np.float32]) -> float:
        if not self.ready:
            return 0.0
        variance = self._m2 / max(self._count - 1, 1)
        diff = embedding.astype(np.float64) - self._mean
        return float(np.sqrt(np.sum((diff**2) / (variance + 1e-6))))

    def is_ood(self, embedding: NDArray[np.float32], threshold: float) -> bool:
        return self.score(embedding) > threshold

    def state(self) -> Dict[str, Any]:
        """Serializable snapshot for persistence across restarts."""
        return {
            "dim": self.dim,
            "min_samples": self.min_samples,
            "count": self._count,
            "mean": self._mean.tolist(),
            "m2": self._m2.tolist(),
        }

    def load_state(self, state: Dict[str, Any]) -> bool:
        """Restore a previously saved snapshot. Ignores dimension mismatches."""
        mean = np.asarray(state.get("mean", []), dtype=np.float64)
        m2 = np.asarray(state.get("m2", []), dtype=np.float64)
        if mean.shape != (self.dim,) or m2.shape != (self.dim,):
            return False
        self._count = int(state.get("count", 0))
        self._mean = mean
        self._m2 = m2
        return True
