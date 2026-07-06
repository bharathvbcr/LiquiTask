"""PyInstaller entrypoint for the bundled semantic layer sidecar."""

from __future__ import annotations

from semantic_layer._frozen import configure_frozen_environment
from semantic_layer.server import main

if __name__ == "__main__":
    configure_frozen_environment()
    main()
