#!/bin/zsh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

chmod +x ./easy.sh ./run.sh ./ignore ./scripts/sync_to_smb.sh >/dev/null 2>&1 || true
./easy.sh
