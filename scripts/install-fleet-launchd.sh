#!/usr/bin/env bash
set -euo pipefail

repo_dir="${1:-/Volumes/2/code/cc}"
label="com.leafiy.ccusage-fleet-sync"
plist="$HOME/Library/LaunchAgents/$label.plist"

find_node() {
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node "$(command -v node 2>/dev/null || true)"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

node_bin="$(find_node)"
mkdir -p "$HOME/Library/LaunchAgents" "$repo_dir/logs"

cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$node_bin</string>
    <string>$repo_dir/scripts/fleet-sync.mjs</string>
    <string>--timezone</string>
    <string>Asia/Shanghai</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$repo_dir</string>
  <key>StartInterval</key>
  <integer>900</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$repo_dir/logs/fleet-sync.launchd.log</string>
  <key>StandardErrorPath</key>
  <string>$repo_dir/logs/fleet-sync.launchd.err.log</string>
</dict>
</plist>
PLIST

uid="$(id -u)"
launchctl bootout "gui/$uid" "$plist" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$uid" "$plist"
launchctl kickstart -k "gui/$uid/$label"

echo "installed $label"
echo "plist: $plist"
echo "log: $repo_dir/logs/fleet-sync.launchd.log"
