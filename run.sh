#!/bin/sh
set -eu
export NODE_ENV=production
export HOST=0.0.0.0
export PORT=4800
export DATA_DIR="${DATA_DIR:-/data/studio}"
export STUDIO_READ_ENDPOINTS_FILE="${STUDIO_READ_ENDPOINTS_FILE:-}"
exec node --import tsx /app/server/launch.ts
