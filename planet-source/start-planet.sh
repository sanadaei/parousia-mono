#!/bin/sh
set -eu
cd "$(dirname "$0")"
exec node --max-old-space-size=256 scripts/start-planet.mjs "$@"
