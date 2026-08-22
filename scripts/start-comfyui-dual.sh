#!/usr/bin/env bash
# One ComfyUI instance per GPU: engine-0 on GPU0/:8188, engine-1 on GPU1/:8189.
# Skips any instance already listening on its port.
set -euo pipefail
COMFY_DIR="${COMFY_DIR:-$HOME/ComfyUI}"

start() { # port cuda_device
  if curl -s -m 2 "http://127.0.0.1:$1/system_stats" >/dev/null 2>&1; then
    echo "engine on :$1 already up"
  else
    (cd "$COMFY_DIR" && setsid nohup .venv/bin/python main.py --cuda-device "$2" --port "$1" \
      > "/tmp/comfyui-$1.log" 2>&1 < /dev/null &)
    echo "started ComfyUI on :$1 (GPU$2)"
  fi
}

start 8188 0
start 8189 1
echo "wait for both: curl -s http://127.0.0.1:8188/system_stats >/dev/null && curl -s http://127.0.0.1:8189/system_stats >/dev/null"
