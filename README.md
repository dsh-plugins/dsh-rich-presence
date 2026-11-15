# Discord 活动状态（Rich presence）

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

## 大图随模型切换

大图不是固定的：插件按当前会话实际用的模型 id 挑一张你上传的资产，所以同一块卡片在换成别的模型时会换图。小图固定是 `deepseek_harness`，表示「这是 DSH 在跑」。

默认规则（行序即优先级，第一个命中生效）：

| 大图资产 | 关键词 | 典型 id |
|---|---|---|
| `claude` | claude, anthropic, sonnet, opus, haiku, fable | `claude-opus-4.8`、`claude-sonnet-5.5` |
| `deepseek` | deepseek | `deepseek-v4.1-flash`、`deepseek-v4-pro` |
| `gemini` | gemini | `gemini-3.8-flash` |
| `glm` | glm, chatglm, zhipu | `glm-5.3`、`glm-4.6v` |
| `gpt` | gpt, openai, chatgpt, o1, o3, o4 | `gpt-6.1-sol`、`gpt-image-2.5`、`o4-mini` |
| `grok` | grok | `grok-4.7` |
| `kimi` | kimi, moonshot, k2, k3 | `kimi-k3.1-pro`、`kimi-k2-thinking`，以及网关别名 `k3`、`k3-256k`、`kimi-for-coding` |
| `qwen` | qwen, qwq, qianwen | `qwen3.8-max`、`qwen-plus` |

**匹配规则**：模型 id 转小写后按非字母数字切成词（`k3-256k` → `k3`、`256k`），某个词**以**关键词开头就算命中。

- 为什么不是「包含」：子串匹配会让 `o1` 命中 `sao10k/l3.1-euryale-70b`、`o4` 命中 `upstage/solar-pro4`，把别家的模型配上 OpenAI 的图，且不会有任何报错。
- 只看模型 id，**不看 provider**：provider 名（如 `mclans-gpt`）和模型对不对得上是两件事，拿它匹配会拿错图。
- 关键词只能用字母和数字，资产名只能用字母、数字和下划线（Discord 资产名字符集），写错的行会被表单标红而不是静默失效。

**没命中会怎样**：用 `presence.largeImage`（默认空 → 卡片用你的 Discord 应用图标）。自建网关的别名（比如 `my-private-model`）就属于这一类，在「按模型切换大图」里加一行 `kimi: my-private-model` 即可。

在插件页的 **显示** 组里，这一项是「按模型切换大图」文本框：

```
claude: claude, anthropic
deepseek: deepseek
kimi: kimi, k3
```

清空这个框 = 关掉按模型切换，只用上面那张固定大图。

## 安装

本插件是 bundle，Host 端负责采集与推送，浏览器端只提供下面那个配置页：

- 在 DSH 里用 **Plugins → Add plugin** 选择本目录，或让 `plugin_manager` 以 `install_bundle` 安装这个绝对路径；
- 装好后 profile 的 `package.json` 会多一条 `@dsh-plugin/dsh-rich-presence` 依赖，`dsh.profile.bundles` 里会列出它；
- 在 **Plugins** 里可以随时开关；关掉会立即清空 Discord 上的活动。

兼容版本：DSH `>=0.2.2-rc.2 <0.3.0`。

## 开箱即用

**装完就能用，不需要任何配置。** 插件默认走 DSH 官方应用 `1570848316290498590` 推送：那上面已经传好了各族模型的大图和小图 `deepseek_harness`，所以你装上、开着 Discord 桌面客户端，资料页上就会直接出现带图的卡片。

> 必须是 **Discord 桌面客户端**：网页版不提供本地 IPC 套接字，插件连不上。

- 默认 `discord.clientId` 就是上面这个应用，`connection.transport` 是 `auto`，所以装完即连。
- 应用 ID 是公开信息（任何 OAuth 邀请链接里都能看到），不是密钥，也不带任何权限。
- 卡片会显示成 **Playing + 该应用的名字**。想换成自己的名字（或者干脆用自己的应用）就下一节。

想确认渲染对不对、或者暂时不推送到 Discord，把 **应用 ID 清空并保存**，插件就改为把将要发送的完整 JSON 载荷写进日志：

```
rich-presence (log transport, no discord.clientId): {"type":0,"details":"Thinking · dsh","state":"deepseek-v4.1-flash · 42.1K · in 184K (183K cached) · out 212"}
```

第一条载荷用 `info` 级别，之后每次变化降到 `debug`，所以长会话不会刷屏。日志跟着 DSH 进程走：`dsh web` 时就在启动它的终端里。改回来（填回 ID）保存，会立刻重新连上，不用重启。

## 换成自己的应用（可选）

想用自己的应用名、自己的图标，或者自己控制资产时：

1. 打开 <https://discord.com/developers/applications>，点 **New Application**，起个名字（这个名字会显示成 "*Playing* **名字**"）。
2. 在 **General Information** 里复制 **Application ID**（纯数字，不是 client secret，也不是 token）。
3. 想让图片和悬停文字保留的话，去 **Rich Presence → Art Assets** 上传同名资产：各族模型的大图命名成 `claude` / `deepseek` / `gemini` / `glm` / `gpt` / `grok` / `kimi` / `qwen`，小图命名成 `deepseek_harness`。**名字必须和已上传资产完全一致**，否则 Discord 会把图丢掉而插件这边不会有报错。不想上传也可以，把表单里「按模型切换大图」清空，卡片就只用应用图标。
4. 回到 **Plugins → Discord 活动状态**，把 **应用 ID** 换成你自己的，**保存**。

保存后会立刻重连（不用重启），日志出现 `connected to the discord client`，资料页上出现活动卡片。

如果不用表单，也可以手写 `cordis.patch.yml`（两种方式等价，表单保存的就是同一份配置）：

```yaml
- id: rich-presence
  name: '@dsh-plugin/dsh-rich-presence'
  config:
    discord:
      # 19 位数字超出安全整数范围，必须加引号，否则 YAML 会把它解析成数字而丢失末尾几位。
      clientId: '123456789012345678'
```

**Application ID 写错**时 Discord 会以 `4000 Invalid Client ID` 关闭连接：插件记一条明确的警告并**停止重试**（重试永远也修不好一个错的 ID）。在表单里改对再保存即可，不用重启。

**Discord 没开或没登录**时连不上，插件每个重连周期只警告一次（`cannot reach a running Discord desktop client`），然后按退避继续尝试；Discord 打开后会自动接上。

## 在应用里配置（推荐）

打开 **Plugins → Installed plugins → Discord 活动状态**，在描述下方就是配置表单：Discord、显示、隐私、聚焦、连接、限流六组，改完点 **保存**。

- **保存即时生效，不需要重启**：所有配置组都是 `volatile` 的，loader 会把新值直接提交给运行中的插件。
- 只重建受影响的部分：改模板只重画卡片，改上游号/传输方式才重连 Discord，改限流才换发布器——不会因为改一行文案就断连接。
- 每一项都能恢复为继承值（profile patch 里写的值或内置默认）；注意把某一项**擦空**是写入空值，不是恢复默认——应用 ID 擦空就是明确关掉推送。
- profile 不接受写入、或该项被更高优先级的层（home patch / 命令行）覆盖时，表单只读并说明原因，**不会假装保存成功**。
- 这个 profile 没有挂载 `ui-settings` 时不会出现配置区，此时只能改 `cordis.patch.yml`（下面还有一段手写配置的说明）。

## 配置参考

表单里的每一项与下面的字段一一对应；也可以直接写 `cordis.patch.yml`。所有字段都有默认值，一行 `config` 都不用写。

| 字段 | 默认 | 说明 |
|---|---|---|
| `discord.clientId` | `1570848316290498590` | Discord Application ID；默认是 DSH 官方应用（资产齐全，装完即用）。换成自己的应用即改这一项；清空则走日志传输 |
| `discord.activityType` | `0` | 0 在玩 / 2 在听 / 3 在看 / 5 在比赛 |
| `discord.buttons` | `[]` | 最多两个 `{label, url}`，用于挂链接 |
| `presence.details` | `{activity} · {folder}` | 第一行模板 |
| `presence.state` | `{model} · {context} · {tokens}` | 第二行模板 |
| `presence.largeText` | `{progress}` | 大图悬停文字（大图有图才可见：模型规则或 `largeImage` 命中，否则挂在应用图标上） |
| `presence.smallText` | `{activity} · {subagents}` | 小图悬停文字（需配小图才可见） |
| `presence.largeImage` | 空 | 固定的大图资产名（需先在应用里上传同名图片）；按模型切换没命中时用它 |
| `presence.modelImages` | 8 条默认规则 | 按模型切换大图：`{asset, patterns}` 数组，行序即优先级，见上一节 |
| `presence.smallImageRunning` | `deepseek_harness` | 运行中的小图资产名 |
| `presence.smallImageIdle` | `deepseek_harness` | 空闲时的小图资产名 |
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
  name: '@dsh-plugin/dsh-rich-presence'
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
- 默认推送用的是 DSH 官方应用，所以别人看到的活动是「**在玩 + 那个应用的名字**」，不会显示你的应用名；想换成自己的名字就按上一节换应用。

## 已知边界

- 已实测（本机 Discord 桌面客户端，app id `1570848316290498590`）：握手 READY，`SET_ACTIVITY` 被接受并原样回显 details / state / timestamps / assets 四个字段，活动名取自应用名。未验证的只剩**肉眼观感**（卡片在你的资料页上长什么样），因为这里没有截图能力。
- 配置表单验证到的程度：接线与数据契约（注册进官方 `plugins.bundle.config`、槽键等于包名、六个配置组都能被 `dsh-settings` 的 `volatileForm` 投影出来、写完由 `settings/document-updated` 触发重建），以及用同款主题变量离线渲染核对过的布局与控件样式。**在真实页面里的最终观感仍未截图验证**，因为没有浏览器控制权。
- 配置项声明为 `volatile`，所以保存不重启插件；代价是 Host 必须自己响应变更——这也是为什么 `index.ts` 会按 `transport` / `update` / `render` 三层分别重建。
- 这个 profile 没有挂载 `ui-settings` 时不会出现配置区，`cordis.patch.yml` 仍是唯一入口，插件其余功能不受影响。
- `minIntervalMs` 较大时会话结束后的最后一次更新可能晚一点发出（最多一个间隔），这是限流的必然代价。
- Discord 关闭后插件按指数退避重连（5s → 60s 封顶），每个掉线周期只警告一次，不刷屏；两个 DSH 同时在线时各自独立连接，后写者生效，这是 Discord 的语义。
- 卡片文字默认英文；用 `presence.labels` 覆盖即可，见上一节。
- 活动的「类型」只能是 Discord 接受的 0 / 2 / 3 / 5，配成别的值会在加载时报错而不是静默失效。
