#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Users/yoona/.local/bin"
export LINEAR_WEBHOOK_SECRET="$(security find-generic-password -a yoona -s anasa-linear-webhook -w)"

cd /Users/yoona/Documents/anasa/workspace/_diagnosis_worker
exec /usr/bin/env node worker.mjs --loop
