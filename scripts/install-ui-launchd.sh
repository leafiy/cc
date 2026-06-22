#!/usr/bin/env bash
set -euo pipefail

repo_dir="${1:-/Volumes/2/code/cc}"
label="com.leafiy.ccusage-ui"
plist="$HOME/Library/LaunchAgents/$label.plist"
log_dir="$HOME/Library/Logs/ccusage-ui"
support_dir="$HOME/Library/Application Support/ccusage-ui"
runner="$support_dir/run-ui.sh"
port="${CCUSAGE_UI_PORT:-8765}"

mkdir -p "$HOME/Library/LaunchAgents" "$log_dir" "$support_dir"

cat > "$runner" <<RUNNER
#!/usr/bin/env bash
set -euo pipefail
repo_dir="$repo_dir"
cd "\$repo_dir"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:\$HOME/.bun/bin:\$HOME/.local/bin:\$PATH"
export CCUSAGE_UI_HOST="0.0.0.0"
export CCUSAGE_UI_PORT="$port"

node_bin=""
for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node "\$(command -v node 2>/dev/null || true)"; do
  if [ -n "\$candidate" ] && [ -x "\$candidate" ]; then
    node_bin="\$candidate"
    break
  fi
done

[ -n "\$node_bin" ] || { echo "node not found" >&2; exit 127; }
exec "\$node_bin" "\$repo_dir/scripts/serve-ui.mjs"
RUNNER
chmod +x "$runner"

cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$runner</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$HOME</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$log_dir/ui.log</string>
  <key>StandardErrorPath</key>
  <string>$log_dir/ui.err.log</string>
</dict>
</plist>
PLIST

uid="$(id -u)"
launchctl bootout "gui/$uid" "$plist" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$uid" "$plist"
launchctl kickstart -k "gui/$uid/$label"

echo "installed $label"
echo "url: http://192.168.52.4:$port/"
echo "log: $log_dir/ui.log"
