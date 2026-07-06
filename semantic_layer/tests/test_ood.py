from __future__ import annotations

import numpy as np

from semantic_layer.ood import OODDetector


def test_cold_start_returns_zero_score() -> None:
    detector = OODDetector(dim=8, min_samples=5)
    emb = np.ones(8, dtype=np.float32) / np.sqrt(8)
    assert detector.score(emb) == 0.0
    assert not detector.ready


def test_detects_outlier_after_warmup() -> None:
    detector = OODDetector(dim=8, min_samples=5)
    center = np.zeros(8, dtype=np.float32)
    for _ in range(10):
        noise = center + np.random.default_rng(0).normal(0, 0.01, 8).astype(np.float32)
        detector.update(noise)

    outlier = np.ones(8, dtype=np.float32)
    assert detector.score(outlier) > detector.score(center)


def test_variance_not_inflated_by_init() -> None:
    # M-1: with M2 seeded at zeros, a tight cluster yields a genuinely large
    # Mahalanobis distance for a true outlier (the old ones-seed deflated it).
    rng = np.random.default_rng(2)
    detector = OODDetector(dim=16, min_samples=10)
    for _ in range(200):
        detector.update(rng.normal(0.0, 0.05, 16).astype(np.float32))
    outlier = np.full(16, 1.0, dtype=np.float32)
    assert detector.score(outlier) > 3.5  # clears a typical sigma threshold


def test_state_round_trip() -> None:
    d = OODDetector(dim=8, min_samples=5)
    rng = np.random.default_rng(1)
    for _ in range(20):
        d.update(rng.normal(0, 0.1, 8).astype(np.float32))
    restored = OODDetector(dim=8, min_samples=5)
    assert restored.load_state(d.state())
    probe = np.ones(8, dtype=np.float32)
    assert restored.sample_count == d.sample_count
    assert abs(restored.score(probe) - d.score(probe)) < 1e-9


def test_load_state_rejects_dim_mismatch() -> None:
    d = OODDetector(dim=4)
    assert not d.load_state({"mean": [0.0] * 8, "m2": [0.0] * 8, "count": 10})
