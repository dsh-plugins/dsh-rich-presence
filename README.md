# 在线状态推送（Rich presence）

把 DSH 里正在运行的 agent 显示在 Discord 个人资料上：现在在思考、在跑哪个工具、等你审批、压缩上下文，加上模型路由与 token 用量。

## 显示什么

Discord 的活动卡片只有四个可放文字的槽位（两行主文字 + 两个悬停大字）和一个计时器，所以内容按优先级分配：

| 优先级 | 内容 | 默认位置 | 缺失时 |
|---|---|---|---|
| P0 | agent 活动状态 | `details` 第一段 | 不会缺；没有 agent 时显示 `Idle` |
| P1 | 模型 | `state` 第一段 | 整段省略 |
| P2 | 上下文占用 | `state` 第二段 | 整段省略 |
| P3 | 累计 token | `state` 第三段 | 整段省略 |
| P4 | 工作目录名 | `details` 第二段 | 整段省略 |
| P5 | 计时 | `timestamps.start` | 关闭计时 |
| P6 | turn/step、subagent 数 | `large_text` / `small_text` 悬停文字 | 整段省略 |

同一行里从左到右就是从高到低。**任何一段取不到值都会连同分隔符一起消失**，不会留下悬空的 `·`，所以两行会自然变短，而不是出现空洞。

> **悬停文字挂在图片上。** `large_text` / `small_text` 显示在鼠标悬停图片时；没配 `presence.largeImage` 时，大图位置会退回**你的 Discord 应用图标**，所以悬停文字默认就有落脚点。若配了资产名但应用里没有同名图片，Discord 会静默丢掉图片、保留文字（已实测），插件这边不会有报错——名字要对得上。

默认渲染：

```
details = Running bash · dsh
state   = deepseek-v4.1-flash · 42.1K · in 184K (183K cached) · out 212
```

悬停文字（无需上传资产即可出现，挂在应用图标上）：

```
large_text = turn 1 · step 220
small_text = Running bash
```

活动状态本身也有优先级（自上而下先满足者胜）：

1. `Awaiting approval` — 有审批没人回答
2. `Compacting context` — 上下文压缩进行中
3. `Running <工具名>` — 有工具调用没有结果
4. `Thinking` — 有 step 开着
5. `Working` — 有 turn 开着
6. `Queued input` — 空闲但收件箱里还有排队输入
7. `Idle` — 在线但空闲

## 安装

本插件是 Host-only bundle，不需要客户端代码：

- 在 DSH 里用 **Plugins → Add plugin** 选择本目录，或让 `plugin_manager` 以 `install_bundle` 安装这个绝对路径；
- 装好后 profile 的 `package.json` 会多一条 `@local/rich-presence` 依赖，`dsh.profile.bundles` 里会列出它；
- 在 **Plugins** 里可以随时开关；关掉会立即清空 Discord 上的活动。

兼容版本：DSH `>=0.2.2-rc.2 <0.3.0`。

## 先跑起来（不需要 Discord 应用）

默认 `discord.clientId` 为空，插件**不会连接 Discord**，而是把将要发送的完整 JSON 载荷写进日志：

```
rich-presence (log transport, no discord.clientId): {"type":0,"details":"Thinking · dsh","state":"deepseek-v4.1-flash · 42.1K · in 184K (183K cached) · out 212"}
```

第一条载荷用 `info` 级别，之后每次变化降到 `debug`，所以长会话不会刷屏。日志跟着 DSH 进程走：`dsh web` 时就在启动它的终端里。

先看日志确认渲染符合预期，再去创建应用。

## 创建 Discord 应用并接通

> 必须是 **Discord 桌面客户端**：网页版不提供本地 IPC 套接字，插件连不上。

1. 打开 <https://discord.com/developers/applications>，点 **New Application**，起个名字（这个名字会显示成 "*Playing* **名字**"）。
2. 在 **General Information** 里复制 **Application ID**（纯数字，不是 client secret，也不是 token）。
3. 想让卡片出现图片和悬停文字的话，去 **Rich Presence → Art Assets** 上传图片，把图片名（不是文件名之外的别的东西，就是上传时填的名字）填进 `presence.largeImage` / `presence.smallImageRunning` / `presence.smallImageIdle`。**名字必须和已上传资产完全一致**，否则 Discord 会把图连同悬停文字一起丢掉，而插件这边不会有报错。
4. 在本 profile 的 `cordis.patch.yml` 里给这一行加配置：

```yaml
- id: rich-presence
  name: '@local/rich-presence'
  config:
    discord:
      clientId: '123456789012345678'
```

5. 保存后让这一行重新生效（在 **Plugins** 里关掉再打开即可；重新启动 `dsh` 一定生效），日志出现 `connected to the discord client`，Discord 个人资料上出现活动卡片。

**Application ID 写错**时 Discord 会以 `4000 Invalid Client ID` 关闭连接：插件记一条明确的警告并**停止重试**（重试永远也修不好一个错的 ID），改对配置后重载即可。

**Discord 没开或没登录**时连不上，插件每个重连周期只警告一次（`cannot reach a running Discord desktop client`），然后按退避继续尝试；Discord 打开后会自动接上。

## 配置

所有字段都有默认值，整行可以只写 `discord.clientId`。

| 字段 | 默认 | 说明 |
|---|---|---|
| `discord.clientId` | `''` | Discord Application ID；空则走日志传输 |
| `discord.activityType` | `0` | 0 在玩 / 2 在听 / 3 在看 / 5 在比赛 |
| `discord.buttons` | `[]` | 最多两个 `{label, url}`，用于挂链接 |
| `presence.details` | `{activity} · {folder}` | 第一行模板 |
| `presence.state` | `{model} · {context} · {tokens}` | 第二行模板 |
| `presence.largeText` | `{progress}` | 大图悬停文字（需配 `largeImage` 才可见） |
| `presence.smallText` | `{activity} · {subagents}` | 小图悬停文字（需配小图才可见） |
| `presence.largeImage` | 空 | 大图资产名（需先在应用里上传同名图片） |
| `presence.smallImageRunning` | 空 | 运行中的小图资产名 |
| `presence.smallImageIdle` | 空 | 空闲时的小图资产名 |
| `presence.labels` | `{}` | 换语言用：`{ thinking: 思考, tool: "正在运行 {tool}", idle: 空闲 }`；键为 approval / compacting / tool / toolHidden / thinking / working / queued / idle |
| `presence.elapsed` | `turn` | 计时起点：`turn` / `session` / `off`；`session` 会在恢复的旧会话上显示几十小时的计时 |
| `presence.truncateAt` | `128` | 每个字段最大字符数（Discord 上限 128） |
| `presence.showWhenIdle` | `true` | 没有 agent 时是否显示空闲态 |
| `privacy.showToolNames` | `true` | 是否显示工具名（关掉变成 `Running a tool`） |
| `privacy.showFolder` | `true` | 是否显示目录名 |
| `focus.mode` | `active` | `active` 优先显示正在跑的，`latest` 只看最近活跃 |
| `focus.includeSubagents` | `false` | 是否允许子会话成为被显示的那个（若场上只剩子会话，仍会显示它，避免空窗） |
| `connection.transport` | `auto` | `auto` 有 ID 走 IPC；也可强制 `ipc` / `log` |
| `connection.reconnectMs` | `5000` | 重连退避下限 |
| `connection.maxReconnectMs` | `60000` | 重连退避上限 |
| `connection.extraPipePaths` | `[]` | 额外尝试的 IPC 端点（Discord 装在非默认位置时用） |
| `update.debounceMs` | `400` | 变化后静默多久再发 |
| `update.minIntervalMs` | `15000` | 两次发送的最小间隔 |

### 模板占位符

`{activity}` `{model}` `{provider}` `{effort}` `{context}` `{tokens}` `{folder}` `{progress}` `{turn}` `{step}` `{subagents}`

`{progress}` 是 `turn 1 · step 220` 这样的复合值（不写成 `1.220`，那看着像小数），turn 和 step 只有一个时自动退化；想只显示一个数字就用 `{turn}` / `{step}`。

`(…)` 或 `[…]` 里只有一个占位符时，那个值缺失会连括号一起消失：`{activity} ({folder})` 在不知道目录时得到 `Idle` 而不是 `Idle ()`。组里放了多个占位符、结果全都为空时，剩下的空括号同样会消失。

### 换成中文

卡片文字默认英文，因为 Discord 上的活动描述本身就是英文语境。想全中文就直接覆盖这几条：

```yaml
- id: rich-presence
  name: '@local/rich-presence'
  config:
    discord:
      clientId: '123456789012345678'
    presence:
      labels:
        approval: 等待审批
        compacting: 正在压缩上下文
        tool: '正在运行 {tool}'
        toolHidden: 正在运行工具
        thinking: 思考中
        working: 工作中
        queued: 有排队输入
        idle: 空闲
```

## 数据从哪来

全部来自已提交的会话事件，因此恢复、分叉、压缩之后都还是对的：

- 活动状态、turn/step、工具、审批、压缩、路由与上下文容量：本插件自己的 host-only 投影单元 `richPresenceActivity`（纯 fold，无关事件返回同一引用，不产生下游开销）。
- 累计 token 与上下文占用：读 `dsh-token-meter` 的 `tokenUsage` / `contextPressure` 投影。**没有挂载 token-meter 时这两项自然消失**，插件不报错也不额外依赖它。
- 模型：`agent.model.current()`，没有选择时回退到日志里最近一次 `request/header`。
- 计时起点：当前 turn 的 `turn/start` 时间（`elapsed: turn`，默认），或 `session.header.createdAt`（`elapsed: session`）。

## 隐私与限流

- 默认会把**正在运行的工具名**和**工作目录的目录名**发到 Discord，也就是会公开显示在你的个人资料上。不想公开就关掉 `privacy.showToolNames` / `privacy.showFolder`。
- Discord 对活动更新限流（大约 20 秒 5 次）。插件默认 400ms 去抖 + 15 秒最小间隔，且内容没变化就不发；一个长会话常见是每 15 秒最多一次。
- 只连接本机的 `discord-ipc-*` 命名管道 / Unix socket，不经过网络，也不需要 Discord token。

## 已知边界

- 已实测（本机 Discord 桌面客户端，app id `1570848316290498590`）：握手 READY，`SET_ACTIVITY` 被接受并原样回显 details / state / timestamps / assets 四个字段，活动名取自应用名。未验证的只剩**肉眼观感**（卡片在你的资料页上长什么样），因为这里没有截图能力。
- `minIntervalMs` 较大时会话结束后的最后一次更新可能晚一点发出（最多一个间隔），这是限流的必然代价。
- Discord 关闭后插件按指数退避重连（5s → 60s 封顶），每个掉线周期只警告一次，不刷屏；两个 DSH 同时在线时各自独立连接，后写者生效，这是 Discord 的语义。
- 卡片文字默认英文；用 `presence.labels` 覆盖即可，见上一节。
- 活动的「类型」只能是 Discord 接受的 0 / 2 / 3 / 5，配成别的值会在加载时报错而不是静默失效。
