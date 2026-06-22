# ccusage-dashboard

Local-first dashboard for aggregating coding-agent token usage with
[`ccusage`](https://github.com/ryoppippi/ccusage). It can collect data from the
current machine or from SSH-accessible machines, store the result in local
SQLite, and serve a browser dashboard.

This project does not install background jobs, edit your SSH config, create
services, or configure remote machines for you. Collection is always triggered
manually by the commands below.

## Requirements

- Node.js 18+
- `sqlite3`
- `npx` or `bun` on every machine where collection runs
- SSH access for remote machines, if you use fleet collection

## Install

```sh
git clone git@github.com:leafiy/cc.git
cd cc
cp ccusage.config.example.json ccusage.config.json
```

Edit `ccusage.config.json` for your machines, display names, UI port, and
optional weather provider.

`ccusage.config.json` is ignored by Git. Do not commit API keys, private host
names, or generated usage data.

## Configuration

All project settings live in `ccusage.config.json`.

Minimal local-only config:

```json
{
  "timezone": "Asia/Shanghai",
  "ccusagePackage": "ccusage@20.0.14",
  "machine": "local",
  "agents": ["claude", "codex", "opencode", "pi"],
  "nodes": [
    { "id": "local", "label": "Local machine", "mode": "local" }
  ],
  "displayNames": {
    "local": "Local"
  },
  "ui": {
    "host": "0.0.0.0",
    "port": 8765,
    "dashboardDefaultPeriod": "month",
    "clockDefaultPeriod": "week",
    "defaultTheme": "paper"
  },
  "weather": {
    "enabled": false
  }
}
```

Remote node example:

```json
{
  "id": "workstation",
  "label": "Workstation",
  "host": "192.168.1.20",
  "user": "alice",
  "port": 22,
  "piPaths": ["~/.omp/agent"]
}
```

Supported node fields:

- `id`: stable machine key used in SQLite and UI
- `label`: human-readable label for logs
- `mode`: set to `local` for the current machine
- `host`, `user`, `port`: SSH target for remote machines
- `enabled`: set `false` to keep a sample node in config without collecting it
- `piPaths`: extra Oh My Pi/pi-agent roots to pass to `ccusage pi --pi-path`

## Get Local Data

Run ccusage on this machine and write JSON snapshots under `data/machines`:

```sh
npm run sync
```

Useful manual filters:

```sh
npm run sync -- --since 2026-06-01
npm run sync -- --until 2026-06-30
npm run sync:offline
npm run sync -- --config ./another-config.json
```

This mode writes legacy JSON files and rebuilds `data/combined/*.json`.

## Get Remote/Fleet Data

Fleet collection runs from the current machine. It SSHes into each enabled node
from `ccusage.config.json`, runs `ccusage` on that node, and stores results in
local SQLite:

```sh
npm run fleet:sync
```

Run only selected nodes:

```sh
npm run fleet:sync -- --node local,workstation
```

Export compatibility JSON as well as SQLite:

```sh
npm run fleet:sync -- --export-json
```

Remote machines must already be reachable non-interactively:

```sh
ssh alice@192.168.1.20
```

Remote machines must also have `npx` or `bun` available in `PATH`. The collector
does not install Node, Bun, SSH keys, shells, or agent tools.

## Data Store

Fleet data is stored locally:

```text
data/ccusage.sqlite
```

The SQLite database stores:

- raw per-machine, per-agent ccusage reports
- machine manifests and OS metadata
- combined daily/monthly totals
- summary markdown
- optional cached weather data

Generated data is ignored by Git.

## Run the UI

```sh
npm run ui:serve
```

Open:

```text
http://localhost:8765/
http://localhost:8765/clock
```

If you changed `ui.port`, use that port instead.

## Optional Weather

The clock view can show QWeather/和风天气. Configure it in JSON:

```json
{
  "weather": {
    "enabled": true,
    "provider": "qweather",
    "apiHost": "your-api-host.re.qweatherapi.com",
    "apiKey": "your-api-key",
    "credentialId": "optional-credential-id",
    "location": "101040100",
    "cityLabel": "重庆",
    "refreshMinutes": 30
  }
}
```

Use 和风 GeoAPI to look up a city or district location ID, then set
`weather.location` to that ID. Weather is fetched server-side and cached in
SQLite; the API key is not exposed to the dashboard HTML.

## Cost Numbers

Cost is the API-equivalent estimate reported by `ccusage` as `costUSD` or
`totalCost`. It is not your real bill and does not account for subscriptions,
bundles, credits, or local/free model usage.

## Publishing

Before pushing an open-source copy, check that only source files and docs are
tracked:

```sh
git status --short
git ls-files data
```

`git ls-files data` should print nothing.
