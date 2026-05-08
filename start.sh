#!/bin/bash
DEBUG_LOG="/tmp/nanoclaw-start-debug.log"
echo "[$(date)] start.sh invoked, PID=$$, USER=$(id -u)" >> "$DEBUG_LOG"
echo "[$(date)] PATH=$PATH" >> "$DEBUG_LOG"
echo "[$(date)] PWD=$PWD" >> "$DEBUG_LOG"

export PATH="/usr/local/opt/node@22/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/local/bin:/usr/bin:/bin:/Users/franke/.local/bin"
export HOME="/Users/franke"
cd /Volumes/overflow/nanoclaw-workspace/nanoclaw-v2 || { echo "[$(date)] cd failed" >> "$DEBUG_LOG"; exit 1; }

echo "[$(date)] About to exec node" >> "$DEBUG_LOG"
exec /usr/local/opt/node@22/bin/node dist/index.js
