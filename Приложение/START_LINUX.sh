#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
: "${PORT:=8080}"
export PORT
exec node server.mjs
