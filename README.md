# cc

Use `ccusage` to collect token usage from local coding agents and store the
aggregated fleet view in a lightweight local SQLite database.

## Quick start

```sh
cd /Users/leafiy/code/cc
npm run sync -- --timezone Asia/Shanghai
git add README.md package.json scripts ui .gitignore
git commit -m "Sync local ccusage data"
git push
```

## Fleet sync on 52.4

The fleet collector runs centrally from `/Volumes/2/code/cc` on
`leafiy@192.168.52.4`. It SSHes into each node, runs `ccusage` locally on that
node, and writes all results into the local SQLite database on 52.4.
To keep the 15-minute job light, each node only runs the four agent-level daily
reports (`claude`, `codex`, `opencode`, `pi`). Monthly and all-agent views are
derived on 52.4 from those daily rows.

```sh
cd /Volumes/2/code/cc
npm run db:import-json
npm run fleet:sync -- --timezone Asia/Shanghai
npm run fleet:install-launchd
npm run ui:install-launchd
```

The launchd job runs every 15 minutes and writes logs to:

```text
/Volumes/2/code/cc/logs/fleet-sync.launchd.log
/Volumes/2/code/cc/logs/fleet-sync.launchd.err.log
```

The live UI is served from 52.4:

```text
http://192.168.52.4:8765/
```

The main runtime store is:

```text
/Volumes/2/code/cc/data/ccusage.sqlite
```

The UI reads SQLite through the local Node server API. Legacy JSON files under
`data/combined` and `data/machines` are no longer written by default. To export
them for compatibility, run:

```sh
CCUSAGE_JSON_EXPORT=1 npm run fleet:sync -- --timezone Asia/Shanghai
# or:
npm run fleet:sync -- --timezone Asia/Shanghai --export-json
```

Current fleet nodes:

- `52-4`: local 52.4 machine
- `52-30`: `leafiy@192.168.52.30`
- `52-20`: `leafiy@192.168.52.20`
- `52-5-piggy`: `piggy@192.168.52.5`
- `pc-2223`: `root@pc -p 2223`
- `pc2-2223`: `root@pc2 -p 2223`
- `pc2-2224`: `root@pc2 -p 2224`

Run one node manually:

```sh
npm run fleet:sync -- --node pc2-2224 --timezone Asia/Shanghai
```

On another machine, clone the same repository and run the same `npm run sync`
command. The central fleet collector stores machine snapshots in SQLite. If
legacy JSON export is enabled, each machine also writes to its own directory:

```text
data/machines/<machine>/latest/
```

The cross-machine aggregate is rebuilt every time in SQLite. If legacy JSON
export is enabled, these files are also written:

```text
data/combined/daily.json
data/combined/monthly.json
data/combined/machines.json
data/combined/summary.md
```

## What is collected

The sync script runs `npx --yes ccusage@20.0.14` and stores JSON output for:

- all supported agents detected by `ccusage`
- Claude Code
- Codex
- OpenCode
- Oh My Pi / pi-agent

Oh My Pi is collected with `ccusage pi --pi-path`. The script automatically
adds these paths when they exist:

- `$PI_CODING_AGENT_DIR`
- `~/.omp/agent`

Use `--pi-path` or `CCUSAGE_PI_PATHS` for extra profile/session roots.

Only aggregated usage data is stored. Prompts, responses, API keys, and local
agent history files are not copied into this repository.

## Useful options

```sh
npm run sync -- --timezone Asia/Shanghai
npm run sync -- --machine my-laptop
npm run sync -- --pi-path ~/.omp/agent
npm run sync -- --since 2026-06-01
npm run sync:offline -- --timezone Asia/Shanghai
```

Multiple Oh My Pi roots can be passed as a comma-separated list:

```sh
CCUSAGE_PI_PATHS="$HOME/.omp/agent,$HOME/.omp-work/agent" npm run sync -- --timezone Asia/Shanghai
```

If you want to use a newer ccusage build without editing the repo:

```sh
CCUSAGE_PACKAGE=ccusage@latest npm run sync -- --timezone Asia/Shanghai
```
