---
title: OMP provider 与 extension 控制粒度笔记
date: 2026-05-06
description: 梳理 OMP 中 disabledProviders 与 disabledExtensions 的控制粒度、边界与 capability 差异。
categories:
  - Vibe Coding
draft: false
---
## 1. 先说结论

OMP 现在有两层控制面：

1. **`disabledProviders`**
   - 直接禁整个 provider
   - 是更上游、更硬的总开关
   - 被禁的 provider 连 `load()` 都不会跑

2. **`disabledExtensions`**
   - 禁单个条目
   - 不是固定枚举，而是 capability 定义出来的 extension ID
   - 适合精确屏蔽某个 skill / MCP server / hook / slash command

一句话概括：

- **想整族砍掉兼容来源，用 `disabledProviders`**
- **想只砍某个具体条目，用 `disabledExtensions`**

另外，OMP 对不同 capability 的控制粒度并不统一：

- `skills` 粒度相对最细
- `MCP` 只有部分细粒度控制
- `context files` / `hooks` / `custom tools` 基本还是粗粒度
- `commands` 看起来想做来源级开关，但当前实现接线不完整

---

## 2. `disabledProviders`：整族禁用

### 2.1 它到底怎么生效

provider 过滤发生在：

- `packages/coding-agent/src/capability/index.ts`

关键逻辑是：先把 `disabledProviders` 里的 provider ID 过滤掉，再进入 `loadCapability()` 后续流程。也就是说，被禁的 provider 不只是“结果不显示”，而是**不会去扫描对应目录、不会去读对应配置文件、不会去产出任何 capability 条目**。

这也是为什么：

- 禁 `claude`
- 禁 `claude-plugins`
- 禁 `codex`

之后，相关的 MCP、skills、context files、hooks、tools、commands 会一起消失。

### 2.2 当前可用的 provider ID

当前代码里注册过的 provider ID 有这些：

- `native`  对应 OMP 自己的 `.omp`
- `claude`
- `claude-plugins`
- `codex`
- `gemini`
- `opencode`
- `cursor`
- `cline`
- `windsurf`
- `vscode`
- `github`
- `agents-md`
- `agents`
- `mcp-json`
- `ssh-json`

来源：

- `packages/coding-agent/src/discovery/*.ts` 里的 `const PROVIDER_ID = "..."`

### 2.3 例子

```yml
disabledProviders:
  - claude
  - claude-plugins
  - codex
  - gemini
  - opencode
  - cursor
  - cline
  - windsurf
  - vscode
  - github
```

这会直接砍掉这些 provider 提供的全部能力。

所以像：

- `gemini`
- `opencode`

如果你的目标是“OMP 完全不要碰它们的兼容配置”，就直接放进 `disabledProviders`，不需要额外 patch。

---

## 3. `disabledExtensions`：单条目禁用

### 3.1 它不是固定枚举

`disabledExtensions` 不是预定义常量表，而是 capability 自己定义的条目 ID。

来源：

- `packages/coding-agent/src/capability/*.ts` 里的 `toExtensionId`

当前明确支持这些形状：

- `skill:<name>`
- `mcp:<server-name>`
- `tool:<name>`
- `slash-command:<name>`
- `hook:<pre|post>:<tool|*>:<name>`
- `context-file:<user|project>:<basename>`
- `prompt:<name>`
- `rule:<name>`
- `instruction:<name>`
- `extension-module:<name>`

对应代码例如：

- `skill.ts` → `skill:${skill.name}`
- `mcp.ts` → `mcp:${server.name}`
- `tool.ts` → `tool:${tool.name}`
- `slash-command.ts` → `slash-command:${cmd.name}`
- `hook.ts` → `hook:${hook.type}:${hook.tool}:${hook.name}`
- `context-file.ts` → `context-file:${file.level}:${path.basename(file.path)}`

### 3.2 例子

```yml
disabledExtensions:
  - skill:semantic-compression
  - mcp:context7
  - slash-command:ctx-insight
  - tool:my-custom-tool
  - hook:pre:bash:guard-dangerous-command
  - context-file:user:CLAUDE.md
```

### 3.3 这个机制的边界

`disabledExtensions` 是**条目级**，不是**来源级**。

也就是说你可以禁：

- `mcp:context7`
- `skill:semantic-compression`

但不能直接表达这种语义：

- “只禁 `gemini` provider 提供的全部 MCP”
- “只禁 `opencode` provider 提供的全部 skills”

这种需求当前更接近 provider 级控制，而不是 item 级控制。

---

## 4. 现在各 capability 的控制粒度到底有多粗

## 4.1 Skills：相对最细，但还是后置过滤

`skills` 现在已经有来源级开关：

- `skills.enableCodexUser`
- `skills.enableClaudeUser`
- `skills.enableClaudeProject`
- `skills.enablePiUser`
- `skills.enablePiProject`

相关文件：

- `packages/coding-agent/src/config/settings-schema.ts`
- `packages/coding-agent/src/extensibility/skills.ts`

但它的实现方式不是 provider 前置禁用，而是：

1. 先 `loadCapability(skillCapability.id, ...)`
2. 把各 provider 的 skill 都跑出来
3. 再按 source 做过滤

所以它的粒度虽然细，但架构上仍然是**先扫、后筛**。

## 4.2 MCP：只有部分细粒度控制

upstream 当前 MCP 相关设置主要是：

- `mcp.enableProjectConfig`
- `mcp.discoveryMode`
- `mcp.discoveryDefaultServers`
- `mcp.notifications`
- `mcp.notificationDebounceMs`

相关文件：

- `packages/coding-agent/src/config/settings-schema.ts`
- `packages/coding-agent/src/mcp/config.ts`
- `packages/coding-agent/src/sdk.ts`

也就是说，upstream 目前**没有对齐 `skills` 那种 `mcp.enableClaudeUser` / `mcp.enableCodexUser` 的来源级开关**。

当前 upstream 能做的是：

- 控制 project root 的 `mcp.json` / `.mcp.json`
- 控制 MCP discovery mode
- provider 全禁
- item 单禁

但不能原生表达：

- 只禁 Claude user MCP
- 只禁 Codex user MCP
- 同时保留这两个 provider 的其它能力

所以如果目标是：

- 保留 `.claude/skills` / `CLAUDE.md`
- 但不读 `~/.claude` / `~/.codex` 的 MCP

这块 upstream 粒度还是不够。

## 4.3 Context files：没有专门分类开关

`context files` 没有看到类似：

- `contextFiles.enableClaudeUser`
- `contextFiles.enableCodexUser`

相关定义：

- `packages/coding-agent/src/capability/context-file.ts`

所以当前只能靠：

- `disabledProviders`
- `disabledExtensions`

其中 `disabledExtensions` 的形状是：

- `context-file:<user|project>:<basename>`

注意这里粒度也不算特别细，因为它是按：

- level
- basename

来区分，不带更深层的路径语义。

## 4.4 Commands：schema 里有开关，但当前看起来没接好线

schema 里定义了：

- `commands.enableClaudeUser`
- `commands.enableClaudeProject`

位置：

- `packages/coding-agent/src/config/settings-schema.ts`

但当前在 `packages/coding-agent/src` 里，基本只看到它们出现在 schema 定义里，没有看到明确的 runtime 读取路径。

所以对 `commands` 更准确的说法是：

- **设计意图上想做来源级开关**
- **但当前实现看起来没有真正接通**

单个 command 仍然可以靠 `disabledExtensions` 禁：

- `slash-command:<name>`

## 4.5 Hooks：没有专门来源开关

`hooks` 当前没有看到类似：

- `hooks.enableClaudeUser`
- `hooks.enableCodexUser`

相关定义：

- `packages/coding-agent/src/capability/hook.ts`

当前能做的是：

- provider 级：`disabledProviders`
- item 级：`disabledExtensions`

单个 hook 的 ID 形状是：

- `hook:<pre|post>:<tool|*>:<name>`

## 4.6 Tools：内置工具很细，外部 custom tools 很粗

这里要分两类。

### A. 内置工具

内置工具已经有很多专门开关，例如：

- `todo.enabled`
- `find.enabled`
- `grep.enabled`
- `astGrep.enabled`
- `astEdit.enabled`
- `notebook.enabled`
- `debug.enabled`
- `github.enabled`
- `web_search.enabled`
- `browser.enabled`
- `checkpoint.enabled`

这些都在：

- `packages/coding-agent/src/config/settings-schema.ts`

所以**内置工具**这一层，OMP 粒度其实不算差。

### B. 外部 / custom tools

但对 provider 带进来的外部 tool，当前没有看到：

- `tools.enableClaudeUser`
- `tools.enableCodexUser`
- `tools.enableGeminiUser`

相关定义：

- `packages/coding-agent/src/capability/tool.ts`

所以 custom tools 仍然主要靠：

- `disabledProviders`
- `disabledExtensions`

单个 tool 的 ID 形状是：

- `tool:<name>`

---

## 5. 这套设计的真实特点

OMP 现在不是“所有 capability 都有统一来源级控制”的设计。

更准确地说，它是一个**粒度不对称**的系统：

- `skills` 已经走到 capability 内部来源级控制
- `MCP` 只做了一部分
- `context files` / `hooks` / `custom tools` 还主要停留在 provider 级或 item 级
- `commands` 则处于“schema 看起来有、runtime 看起来没完全接通”的状态

所以当前最稳定的经验法则是：

1. **想切整族来源，用 `disabledProviders`**
2. **想切单个具体对象，用 `disabledExtensions`**
3. **想做“只禁某 provider 的某 capability、但保留同 provider 的其它 capability”**
   - `skills` 部分支持
   - `MCP` 只支持很有限的子集
   - 其它 capability 基本还不够细

---

## 6. 实用写法

### 6.1 整族兼容层直接砍掉

```yml
disabledProviders:
  - claude
  - claude-plugins
  - codex
  - gemini
  - opencode
  - cursor
  - cline
  - windsurf
  - vscode
  - github
```

### 6.2 只禁单个条目

```yml
disabledExtensions:
  - skill:semantic-compression
  - mcp:context7
  - slash-command:ctx-insight
  - tool:my-custom-tool
  - hook:pre:bash:guard-dangerous-command
  - context-file:user:CLAUDE.md
```

### 6.3 什么时候该优先用哪一个

- **我根本不想让 OMP 读这个生态的兼容配置**
  - 用 `disabledProviders`
- **我只讨厌其中一个条目，别的保留**
  - 用 `disabledExtensions`
- **我想只关某 provider 的 MCP，但保留同 provider 的 skills / context / hooks**
  - 当前 upstream 原生支持不完整，不能假设一定做得到
