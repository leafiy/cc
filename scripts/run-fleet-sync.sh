#!/usr/bin/env bash
set -euo pipefail

repo_dir="${1:-/Volumes/2/code/cc}"
cd "$repo_dir"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.bun/bin:$HOME/.local/bin:$PATH"

node_bin=""
for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node "$(command -v node 2>/dev/null || true)"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    node_bin="$candidate"
    break
  fi
done

if [ -z "$node_bin" ]; then
  echo "node not found" >&2
  exit 127
fi

exec "$node_bin" "$repo_dir/scripts/fleet-sync.mjs" --timezone Asia/Shanghai
