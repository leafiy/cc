# ccusage-dashboard

[中文](README.md) | [English](README.en.md)

本项目是一个本地优先的 `ccusage` Token 用量仪表盘。它可以从本机或你已经配置好 SSH 访问的远端机器采集 coding agent 用量，统一写入本地 SQLite，并提供两个浏览器 UI：

- 标准仪表盘：`/`
- 时钟仪表盘：`/clock`

项目不会替你安装后台任务、修改 SSH 配置、创建系统服务，也不会自动配置远端机器。采集由下面的命令手动触发，所有配置都放在本地 JSON 文件里。

## 预览

### 标准仪表盘

| 横屏 | 竖屏 |
| --- | --- |
| ![标准仪表盘横屏](images/标准横屏.jpg) | ![标准仪表盘竖屏](images/标准竖屏.jpg) |

### 时钟仪表盘

| 横屏 | 竖屏 |
| --- | --- |
| ![时钟仪表盘横屏](images/clock横屏.jpg) | ![时钟仪表盘竖屏](images/clock竖屏.jpg) |

## 运行要求

- Node.js 18+
- `sqlite3`
- 每台参与采集的机器需要有 `npx` 或 `bun`
- 如果采集远端机器，需要你自己先配置好免交互 SSH

## 安装

```sh
git clone git@github.com:leafiy/cc.git
cd cc
cp ccusage.config.example.json ccusage.config.json
```

编辑 `ccusage.config.json`，配置机器列表、显示名称、UI 端口和可选天气服务。

`ccusage.config.json` 已被 Git 忽略。不要提交 API key、私有主机名、私有 IP 或生成出来的用量数据。

## 配置

所有配置都在 `ccusage.config.json`。

最小本机配置：

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
    "defaultTheme": "paper",
    "autoSyncMinutes": 10
  },
  "weather": {
    "enabled": false
  }
}
```

远端节点示例：

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

节点字段：

- `id`：稳定机器 key，用于 SQLite 和 UI
- `label`：日志里显示的人类可读名称
- `mode`：当前机器设置为 `local`
- `host`、`user`、`port`：远端 SSH 目标
- `enabled`：设置为 `false` 可以保留示例节点但不采集
- `piPaths`：额外的 Oh My Pi/pi-agent 数据目录，会传给 `ccusage pi --pi-path`

## 获取本机数据

在当前机器运行 `ccusage`，写入 `data/machines` 下的 JSON 快照并重建合并数据：

```sh
npm run sync
```

常用手动过滤：

```sh
npm run sync -- --since 2026-06-01
npm run sync -- --until 2026-06-30
npm run sync:offline
npm run sync -- --config ./another-config.json
```

## 获取远端/多机器数据

多机器采集从当前机器发起。脚本会读取 `ccusage.config.json` 中启用的节点，通过 SSH 登录每台机器，在远端运行 `ccusage`，并把结果写入当前机器的本地 SQLite。

```sh
npm run fleet:sync
```

只采集指定节点：

```sh
npm run fleet:sync -- --node local,workstation
```

同时导出兼容 JSON：

```sh
npm run fleet:sync -- --export-json
```

远端机器必须已经可以免交互访问：

```sh
ssh alice@192.168.1.20
```

远端机器也必须在 `PATH` 中有 `npx` 或 `bun`。采集器不会安装 Node、Bun、SSH key、shell 或 agent 工具。

## 数据存储

多机器数据存储在本地：

```text
data/ccusage.sqlite
```

SQLite 中包含：

- 每台机器、每类 agent 的原始 ccusage 报告
- 机器 manifest 和系统信息
- 合并后的 daily/monthly 总量
- 汇总 markdown
- 可选的天气缓存

生成数据已被 Git 忽略。

## 运行 UI

```sh
npm run ui:serve
```

打开：

```text
http://localhost:8765/
http://localhost:8765/clock
```

隐藏操作：在任一 UI 中双击标题 `Token 用量统计`，可以切换浏览器全屏。

如果你修改了 `ui.port`，使用你配置的端口。

## 自动刷新用量

UI 页面本身已经会自动重载（标准仪表盘每 60 秒，时钟仪表盘每 30 分钟），并实时从 SQLite 读取数据。要让数据本身也自动更新，`ui:serve` 内置了一个定时器，会按固定间隔在后台运行一次 `fleet:sync`，无需配置系统级的 cron / launchd / systemd。

用 `ui.autoSyncMinutes` 控制采集间隔，默认 `10`（分钟）：

```json
{
  "ui": {
    "autoSyncMinutes": 10
  }
}
```

- 设为 `0` 关闭内置定时器（只服务页面，不自动采集）。
- 也可以用环境变量临时覆盖：`CCUSAGE_AUTO_SYNC_MINUTES=30 npm run ui:serve`。
- 启动时会先立即采集一次，之后按间隔重复；如果上一次采集还没结束，本次会跳过，不会叠加。
- 采集失败只记录日志，不会影响 UI 服务。

这样只需要保持 `npm run ui:serve` 运行，采集和展示就都自动刷新了。

## 可选天气

时钟视图可以显示 QWeather/和风天气。在 JSON 中配置：

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

使用和风 GeoAPI 查询城市或区县 location ID，然后填入 `weather.location`。天气由服务端请求并缓存在 SQLite 中，API key 不会暴露到前端 HTML。

## 花费估算

花费来自 `ccusage` 返回的 `costUSD` 或 `totalCost`，是 API 等价估算值，不是你的真实账单。它不会考虑订阅、套餐、赠送额度、本地模型或免费模型。

## 发布前检查

推送开源版本前，确认只跟踪源码和文档：

```sh
git status --short
git ls-files data
```

`git ls-files data` 应该没有任何输出。
