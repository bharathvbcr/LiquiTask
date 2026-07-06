# LiquiTask agent sandbox image for apple/container (macOS 26+, Apple silicon).
#
# Build (from this directory):
#   container build -t liquitask-agent:latest .
# The repo is mounted at /work by the app; auth comes from ANTHROPIC_API_KEY
# passed through by the runner (or run `claude setup-token` and bake a token
# via a build secret — do NOT hardcode credentials here).

FROM node:22-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ripgrep ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

# Non-root user; the mounted repo at /work stays owned by the host user.
RUN useradd -m agent
USER agent
WORKDIR /work

ENTRYPOINT []
CMD ["claude", "--help"]
