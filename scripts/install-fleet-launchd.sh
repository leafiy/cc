#!/usr/bin/env bash
set -euo pipefail

repo_dir="${1:-/Volumes/2/code/cc}"
label="com.leafiy.ccusage-fleet-sync"
plist="$HOME/Library/LaunchAgents/$label.plist"
log_dir="$HOME/Library/Logs/ccusage-fleet-sync"

mkdir -p "$HOME/Library/LaunchAgents" "$repo_dir/logs" "$log_dir"

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
    <string>$repo_dir/scripts/run-fleet-sync.sh</string>
    <string>$repo_dir</string>
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
echo "log: $log_dir/fleet-sync.launchd.log"
