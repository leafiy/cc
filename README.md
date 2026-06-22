# cc

Use `ccusage` to collect token usage from local coding agents, then sync the
machine-level snapshots through this git repository.

## Quick start

```sh
cd /Users/leafiy/code/cc
npm run sync -- --timezone Asia/Shanghai
git add README.md package.json scripts data
git commit -m "Sync local ccusage data"
git push
```

On another machine, clone the same repository and run the same `npm run sync`
command. Each machine writes to its own directory:

```text
data/machines/<machine>/latest/
```

The cross-machine aggregate is rebuilt every time:

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

Only aggregated usage JSON is stored. Prompts, responses, API keys, and local
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
