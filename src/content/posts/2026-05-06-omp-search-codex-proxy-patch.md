---
title: OMP 搜索与 Codex 自定义反代补丁设计
date: 2026-05-06
description: 梳理 OMP web search provider 链、Codex provider 的 BYOK/OAuth 扩展与自定义反代补丁思路。
categories:
  - Harness
draft: false
---
## 1. 先说结论

这次梳理下来，关于 OMP 的 search，可以先记住几件事：

1. **OMP 的 web search 是一层统一抽象，不是某一家 provider 的硬编码逻辑**
   - 入口是统一的 `web_search` 工具
   - 下面再挂 Exa、Codex、Brave、Perplexity、Anthropic、Gemini 等 provider

2. **`providers.webSearch` 是“首选 provider”，不是“强制唯一 provider”**
   - 它会影响优先顺序
   - 但如果首选 provider 不可用或执行失败，OMP 仍然会 fallback 到后面的 provider

3. **Codex 在 OMP 里本来就是一个 search provider**
   - 原始设计偏向 OpenAI Codex OAuth 场景
   - 但实际上可以扩展成兼容 **Responses 风格的自定义反代 / BYOK 网关**

4. **这次 Codex patch 的核心目标，不是新造一个 provider，而是让现有 Codex provider 能吃下“自定义 Codex 反代”**
   - 保留原来的 OAuth 行为
   - 新增对 `models.yml` 里 Responses-compatible backend 的解析
   - 新增对一些“不返回结构化 citation”的反代网关的兼容

5. **`Sources: 0` 的根因，不一定是没搜，而可能是反代没有按 OMP 预期返回 citation 结构**
   - 我们实际抓到过 `web_search_call` 已经发生
   - 但返回里没有 `url_citation`
   - 最终答案正文里只有 markdown 链接

6. **`omp q` 这条独立 CLI 路径，和 SDK/TUI 主启动路径不是一条初始化链**
   - 所以 `providers.webSearch = exa` 这种偏好设置
   - 需要在 `src/cli/web-search-cli.ts` 里单独初始化一次
   - 不然它会直接按默认 auto 顺序选 provider

一句话概括：

- **OMP search 的本质是“统一工具 + provider 链 + 可失败回退”**
- **Codex patch 的本质是“把 Codex provider 从只懂 OAuth，扩成懂自定义 Responses 反代，同时保留原有 fallback 语义”**

---

## 2. OMP 的 search 功能大体是怎么分层的

我这次实际确认到的关键文件有这些：

### 2.1 provider 注册与顺序

文件：

- `src/web/search/provider.ts`

这里负责：

- 注册所有 search provider
- 定义固定的 auto 顺序
- 根据设置或显式参数，解析 provider chain

当前 auto 顺序里，关键片段是：

- `... gemini -> codex -> zai -> exa -> ...`

也就是说：

- **如果不应用 `providers.webSearch` 偏好**
- 那么默认 auto 顺序里 **Codex 比 Exa 更早**

这点后来解释了为什么：

- 明明配置里 `providers.webSearch = exa`
- 但 `omp q` 某次默认搜索还是先走了 Codex

### 2.2 统一执行入口

文件：

- `src/web/search/index.ts`

这里的职责是：

- 接收统一的 search 参数
- 解析 provider chain
- 依次尝试 provider
- 某个 provider 成功就返回
- 失败则继续 fallback

这层设计说明一件事：

- OMP 从一开始就不是“只能有一个 search provider”
- 它就是按 **provider chain + fallback** 设计的

所以后面用户说：

- “fallback 不改，就按 oh-my-pi 本来写的这样就行”

这是对的。

因为从现有实现看：

- **fallback 本来就是 search 设计的一部分**
- 不应该为了强推某个 provider，把这层设计破坏掉

### 2.3 CLI 测试命令

文件：

- `src/cli/web-search-cli.ts`
- `src/commands/web-search.ts`

`omp q` / `omp web-search` 本质上是一个“测试 search provider 的 CLI 命令”。

它不是完整 agent 会话，也不是完整 SDK 启动链。

所以一个很关键的点是：

- **它不会天然经过 `sdk.ts` 里那段 provider preference 初始化逻辑**

这就是后面出现偏差的原因。

### 2.4 配置项定义

文件：

- `src/config/settings-schema.ts`

这里定义了：

- `providers.webSearch`

这个设置项的语义，不是：

- 只准用它

而是：

- **把它放到优先位置，然后保留后续 fallback**

---

## 3. OMP search 的 provider 选择逻辑到底是什么

这个问题最容易被误解。

### 3.1 显式 `--provider` 优先级最高

如果命令写了：

```bash
omp q --provider codex "what is ai infra"
```

那就是：

- 直接点名走 `codex`
- 不让 `providers.webSearch` 来决定首选项

这个适合做：

- 定点调试
- 验证某个 provider 自身是否工作正常

### 3.2 没写 `--provider` 时，才走 preference + fallback

如果命令写的是：

```bash
omp q "what is the gold price today"
```

那才会走：

- `providers.webSearch`
- 然后再拼接 fallback chain

语义可以理解成：

1. 先试首选 provider
2. 如果首选不可用或失败
3. 再试固定 auto 顺序里的其余 provider

所以：

- `providers.webSearch = exa`
- **不是** “只用 Exa”
- 而是 “先用 Exa，Exa 不行再 fallback”

### 3.3 这次踩到的 CLI 回归点

实际确认到的问题是：

- `sdk.ts` 在主启动链里会读 `providers.webSearch`
- 然后调用 `setPreferredSearchProvider(...)`
- 但 `omp q` 那条独立 CLI 路径没有做这一步

结果就是：

- TUI / SDK 路径能理解 preference
- standalone CLI search 路径却直接回到默认 auto 顺序

而默认 auto 顺序里：

- `codex` 在 `exa` 前面

所以就出现了：

- 配置明明是 `exa`
- 默认 `omp q` 却跑去走 Codex

这不是 search 总体设计问题，**而是 CLI 搜索入口漏做初始化**。

---

## 4. 这次 Codex 自定义反代为什么会出问题

这次调的是一个自定义 Codex backend，本地配置大意是：

- `~/.omp/agent/config.yml`
  - `modelRoles.default: codex-proxy/gpt-5.4(xhigh)`
- `~/.omp/agent/models.yml`
  - `codex-proxy.baseUrl: https://.../v1`
  - `api: openai-responses`

也就是说：

- 从 OMP 视角看，它不是官方固定 OAuth-only 场景
- 而是一个 **Responses-compatible 自定义网关 / 反代**

### 4.1 第一个问题：有些反代不一定稳定触发 built-in web search

原始 OMP 里，对 Codex search 的预期比较偏向：

- 给一个合适 prompt
- Codex 自己会调用内建 `web_search`

但真实世界的网关并不总是这么稳定。

一些兼容层会出现：

- prompt 写得没问题
- Responses API 也能跑
- 但 search tool 触发并不稳定

所以这次 patch 里加了：

```ts
tool_choice: { type: "web_search" }
```

设计目的很明确：

- **对不稳定的反代，强制走内建 web_search**
- 不再把“要不要搜”完全交给网关的自由发挥

### 4.2 第二个问题：反代不一定返回 `url_citation`

这是这次最关键的坑。

我们实际抓到的现象是：

- SSE 里确实出现了：
  - `response.web_search_call.in_progress`
  - `response.web_search_call.searching`
  - `response.web_search_call.completed`
- 说明搜索动作已经发生
- 但是最终 `output_text.annotations` 是空的
- 最终回答文本里却包含 markdown 链接

也就是说：

- **搜索做了**
- **答案也带引用链接了**
- **只是返回格式不符合 OMP 原先对 `url_citation` 的严格预期**

于是 OMP 就会误判成：

- `Sources: 0`

根因不是“没搜”，而是：

- **source extraction 过于依赖结构化 annotation**

---

## 5. 这次 Codex patch 的设计目标是什么

目标不是“为这个反代单独加一堆特殊逻辑”，而是：

- 把现有 Codex provider 做成一个更真实、更兼容的抽象

我认为这次 patch 的设计目标可以拆成 4 条：

### 5.1 保留原始 OAuth 路径

原有行为：

- 如果用户已经登录 `openai-codex`
- OMP 可以用 OAuth 凭据走官方 Codex search

这条路径不能被破坏。

所以补丁不是替换它，而是做成：

- **先尝试 BYOK / custom backend**
- 没命中再 fallback 到原始 OAuth

这样好处是：

- 旧用户不用迁移
- 新用户可以直接用 `models.yml` 里的反代
- 两条路径都还在

### 5.2 不新造一个 provider id

这次没有新增一个什么：

- `codex-proxy`
- `codex-byok`
- `custom-codex-search`

而是继续沿用：

- `codex`

这点很重要。

因为一旦新造 provider：

- provider order 要改
- settings enum 可能要改
- caller 逻辑要改
- 文档和行为语义都更复杂

而真实问题其实不是“缺一个新 provider”，而是：

- **现有 Codex provider 的后端识别范围太窄**

所以正确做法是：

- 扩展 `codex` provider 的 backend 解析能力
- 不引入第二套概念

这比新造 provider 更干净。

### 5.3 当前实际生效的是哪一层

先说当前 live backend 的实测结论。

对这台机器当前这条配置：

- `~/.omp/agent/config.yml` -> `modelRoles.default: codex-proxy/gpt-5.4(xhigh)`
- `~/.omp/agent/models.yml` -> `codex-proxy.baseUrl: https://your-cpa.example.com:27519/v1`

我重新抓了一次 streaming Responses 结果，观察到的是：

- `annotationCount = 0`
- `markdownLinkCount = 2`
- `actionUrls = ["https://www.nvidia.com/en-us/glossary/ai-infrastructure/"]`

也就是说，对**当前这条 live codex-proxy + gpt-5.4(xhigh)** 路径，真正命中的提取层是：

1. `url_citation`：**没命中**
2. markdown links：**命中，这就是现在实际生效的层**
3. `web_search_call.action.url`：**存在，但当前没有被用上**

所以如果只问“现在到底是哪层在生效”，答案很明确：

- **当前实际生效的是 markdown links 这一层**
- **不是 annotation**
- **也不是 tool URL**

`tool URL` 那层只是代码里保留的安全边界，不是当前这条线上请求正在依赖的主路径。
### 5.4 保留 OMP 原有 fallback 哲学

用户已经明确说过：

- fallback 不改

而这和 OMP 现有设计也是一致的。

所以这次 patch 的边界很清楚：

- 改 Codex provider 的 backend 适配能力
- 改 Codex provider 的 source extraction 能力
- 改 standalone CLI 对 provider preference 的读取
- **不改 OMP 整体的 provider fallback 模型**

---

## 6. 这次补丁在代码层面到底做了什么

下面是我认为最关键的几个设计点。

### 6.1 从 `models.yml` 解析自定义 Codex backend

关键文件：

- `src/web/search/providers/codex.ts`

新增逻辑大意是：

1. 读取 `~/.omp/agent/config.yml`
2. 读取 `~/.omp/agent/models.yml`
3. 看当前默认模型或 `PI_CODEX_WEB_SEARCH_MODEL` 指向哪个 provider/model
4. 在 `models.yml` 里找：
   - `api: openai-responses`
   - 或 `api: openai-codex-responses`
5. 如果该 provider 有：
   - `baseUrl`
   - `apiKey`
   - `models[].id`
6. 就把它当成 Codex search backend

这个设计的价值是：

- 不要求用户额外再发明一套 search 专用配置
- 直接复用 OMP 现有 models 配置体系
- 保持“模型配置”和“search backend 选择”是一套真实世界配置

### 6.2 backend 解析顺序：BYOK 优先，OAuth 次之

补丁里抽成了一个 backend 解析层，语义是：

- 先看能不能从 `models.yml` 解析出自定义 Responses backend
- 如果能，就走它
- 如果不能，再退回原始 OAuth

这个顺序是合理的。

因为：

- 一旦用户显式配了自己的反代 / baseUrl / apiKey
- 通常就是希望优先走自己的后端

但如果用户根本没配：

- 继续沿用原始 OAuth 行为

### 6.3 规范化 Responses URL

不是所有网关给的 `baseUrl` 都完全一致。

有些会写成：

- `https://host/v1`

有些可能写成：

- `https://host/v1/`
- `https://host/responses`

所以补丁里加了一个 URL 归一化逻辑：

- 如果已经以 `/responses` 结尾，就直接用
- 如果以 `/v1` 结尾，就补 `/responses`
- 否则补成 `/v1/responses`

这类小逻辑非常值钱。

因为它决定了：

- 用户配置是不是必须“刚好完全匹配内部预期”
- 还是 OMP 能对等价 baseUrl 做合理归一化

### 6.4 强制 `tool_choice: web_search`

这个前面提过，但值得单独强调。

它不是为了“改 search 哲学”，而是为了：

- **让 Responses-compatible 反代在 search 场景下行为更稳定**

换句话说：

- 这不是多余控制
- 而是在兼容层现实不稳定的前提下，补上 deterministic 行为

### 6.5 source 提取从单一 annotation，改成 layered extraction

这个是 `Sources: 0` 问题的直接修复点。

原来大体是：

- 只认 `output_text.annotations[].type === "url_citation"`

现在改成：

1. 先提 `annotationSources`
2. 再提 `markdownSources`
3. 再提 `toolSources`
4. 最后按优先级选一个非空集合

这使得 OMP 对 gateway 的容错性高很多。

### 6.6 `hasCodexSearch()` 也跟着扩展

如果 search backend 的判定逻辑变了：

- availability check 也必须一起变

否则会出现：

- 实际能搜
- 但 provider availability 判断还停留在 OAuth-only 时代

所以这里一起改成：

- 判断“有没有可用 backend”
- 而不是只判断“有没有 OAuth”

---

## 7. 为什么这次设计是合理的

我觉得合理点主要在这里。

### 7.1 它解决的是“边界定义太窄”，不是“少一个功能按钮”

原来 Codex provider 隐含的边界是：

- 只认官方 OAuth
- 只认结构化 citation

但真实世界里，很多人用的是：

- OpenAI Responses 兼容层
- 反代
- 自建网关
- 聚合转发层

所以真正的问题不是：

- 少一个搜索按钮

而是：

- **Codex provider 对“可接受 backend”的定义过窄**
- **对“可接受 source 证据”的定义也过窄**

这次 patch 是把抽象边界修正成更贴近现实，而不是乱加旁路。

### 7.2 它没有引入双轨设计

一个坏设计会变成：

- 官方 Codex 用一套
- 自定义反代再来一套 provider
- UI、settings、文档、调用方全都要知道两种概念

这会让后续维护复杂度上升。

这次做法没有这么搞。

仍然是：

- 一个 `codex` provider
- 只是 backend 解析更通用

### 7.3 它保住了“搜索已发生”这个真相

`Sources: 0` 最糟糕的地方在于：

- 用户明明做了 search
- 系统却展示成像没搜到 source

这会误导人。

所以这次 layered extraction 的价值，不只是“让 UI 好看一点”，而是：

- **让系统对外说真话**

---

## 8. 14.1.1 升级后，为什么还要补一刀 CLI search preference

升级到 `14.1.1` 后，有个额外发现：

- 默认 `omp q ...` 又跑到了 Codex
- 但配置里 `providers.webSearch = exa`

最后确认根因不是 search provider 本体，而是：

- `src/cli/web-search-cli.ts` 没有初始化 settings preference

所以我们又在这条 CLI 路径补了：

1. `Settings.init()`
2. 读取 `providers.webSearch`
3. `setPreferredSearchProvider(...)`

这样修完之后：

```bash
omp config get providers.webSearch
# exa

omp q --compact "what is the gold price today"
# Provider: Exa

omp q --provider codex --compact "what is ai infra"
# Provider: Codex
```

这说明：

- 默认搜索偏好恢复正常
- 显式 provider 指定仍然正常
- fallback 模型也没被破坏

---

## 9. 当前本地实际结论

我这边最后确认到的本地状态是：

### 9.1 当前 search 偏好

文件：

- `~/.omp/agent/config.yml`

关键项：

```yaml
providers:
  webSearch: exa
```

语义：

- 默认优先 Exa
- 不是 strict lock
- Exa 不行时仍可 fallback

### 9.2 当前默认模型

同一份配置里还有：

```yaml
modelRoles:
  default: codex-proxy/gpt-5.4(xhigh)
```

这说明：

- 默认主模型可以是 Codex 路线
- 但默认 web search provider 仍然可以优先是 Exa

这两者不是一回事。

### 9.3 当前自定义 Codex backend

文件：

- `~/.omp/agent/models.yml`

关键点：

- provider 名：`codex-proxy`
- `baseUrl: https://.../v1`
- `api: openai-responses`

这就是这次 patch 要兼容的典型“自定义 Codex 反代”形态。

---

## 10. 这次涉及到的本地补丁位置

### 10.1 安装态 OMP 运行时代码

当前实际打补丁的位置是：

- `~/.local/share/fnm/node-versions/v24.11.0/installation/lib/node_modules/@oh-my-pi/pi-coding-agent/src/web/search/providers/codex.ts`
- `~/.local/share/fnm/node-versions/v24.11.0/installation/lib/node_modules/@oh-my-pi/pi-coding-agent/src/cli/web-search-cli.ts`

这里是本机真正运行的 OMP 代码，不是源码仓库里的参考实现。

### 10.2 fish-claude 里的 patch 文件

为了后续升级后能重放补丁，对应 patch 也同步到了：

- `~/personal-workspace/fish-claude/tools/omp-patch-codex-websearch-byok/patch.diff`

另外一个无关 search 但一起维护的补丁是：

- `~/personal-workspace/fish-claude/tools/omp-patch-custom-mcp/patch.diff`

---

## 11. 我对这套设计的最终理解

如果以后我自己再看这块，我会把它记成下面这几句：

### 11.1 OMP search 的本质

- 一个统一 search 抽象
- 多 provider 注册
- preference 决定首选
- provider chain 决定 fallback

### 11.2 Codex patch 的本质

- 不是新造一条 search 系统
- 而是把现有 Codex provider 扩成更真实的“Codex-compatible backend adapter”

### 11.3 为什么这次 patch 值得做

因为它修的不是 UI 表面症状，而是三层更根的东西：

1. **backend 识别范围** 太窄
2. **source 识别范围** 太窄
3. **CLI preference 初始化** 漏了一条路径

把这三层补上后：

- 默认 search 行为才和配置一致
- Codex custom 反代才真正可用
- `Sources: 0` 才不会继续误导人

---

## 12. 以后调试这块时，我会优先怎么想

如果以后再遇到 OMP search 问题，我会先分三类看：

### 12.1 是 provider 没被选中

先看：

- `providers.webSearch`
- CLI 路径有没有读到 preference
- 有没有显式 `--provider`
- auto 顺序里谁在前面

### 12.2 是 provider 被选中了，但 search 没真的发生

先看：

- 请求 body 里有没有 search tool
- 有没有 `tool_choice: { type: "web_search" }`
- SSE 里有没有 `web_search_call.*`

### 12.3 是 search 发生了，但 source 没显示出来

先看：

- 有没有 `url_citation`
- 有没有 markdown links
- 有没有 `web_search_call.action.url`

这样排就不会把三层问题混成一个问题。
