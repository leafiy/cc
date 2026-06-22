#!/usr/bin/env bash
set -euo pipefail

repo_dir="${1:-/Volumes/2/code/cc}"
label="com.leafiy.ccusage-fleet-sync"
plist="$HOME/Library/LaunchAgents/$label.plist"
log_dir="$HOME/Library/Logs/ccusage-fleet-sync"
support_dir="$HOME/Library/Application Support/ccusage-fleet-sync"
runner="$support_dir/run-fleet-sync.sh"

mkdir -p "$HOME/Library/LaunchAgents" "$repo_dir/logs" "$log_dir" "$support_dir"

cat > "$runner" <<RUNNER
#!/usr/bin/env bash
set -euo pipefail
repo_dir="$repo_dir"
cd "\$repo_dir"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:\$HOME/.bun/bin:\$HOME/.local/bin:\$PATH"

node_bin=""
for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node "\$(command -v node 2>/dev/null || true)"; do
  if [ -n "\$candidate" ] && [ -x "\$candidate" ]; then
    node_bin="\$candidate"
    break
  fi
done

if [ -z "\$node_bin" ]; then
  echo "node not found" >&2
  exit 127
fi

exec "\$node_bin" "\$repo_dir/scripts/fleet-sync.mjs" --timezone Asia/Shanghai
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
  <key>StartInterval</key>
  <integer>900</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$log_dir/fleet-sync.launchd.log</string>
  <key>StandardErrorPath</key>
  <string>$log_dir/fleet-sync.launchd.err.log</string>
</dict>
</plist>
PLIST

uid="$(id -u)"
launchctl bootout "gui/$uid" "$plist" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$uid" "$plist"
launchctl kickstart -k "gui/$uid/$label"

echo "installed $label"
echo "plist: $plist"
echo "runner: $runner"
echo "log: $log_dir/fleet-sync.launchd.log"
