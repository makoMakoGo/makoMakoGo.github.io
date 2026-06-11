---
title: VS Code Copilot 为什么会读取 Claude 配置，以及如何关掉
date: 2026-05-30
description: 记录 VS Code/Copilot Agent Customizations 默认兼容读取 Claude hooks、CLAUDE.md 和 agent skills 的机制，以及在 Windows Insiders + WSL Remote 中关闭这些来源的配置。
categories:
  - Vibe Coding
draft: false
---

最近在 VS Code Insiders 里打开 Copilot 的 Agent Customizations 页面时，我遇到一个很烦人的现象：明明我是在用 Copilot，它却自动把一堆 Claude 相关的 hooks、skills 和配置源列了出来。更糟的是，这不是某个项目里显式配置了 Copilot，而是 VS Code/Copilot 的默认兼容机制在扫描其他 AI 工具的目录。

这篇文章记录一下这个机制到底在读什么、为什么常见的 `github.copilot.chat.claudeAgent.enabled` 开关没用，以及最后怎么把它关掉。

## 现象

在 VS Code Insiders 的 Agent Customizations 编辑器里，可以看到类似这样的内容：

```text
Hooks:
~/.claude/settings.json
.claude/settings.json
.claude/settings.local.json

Skills:
~/.agents/skills
.claude/skills
~/.claude/skills
```

这些目录本来属于 Claude Code、Agents 或其他 agent 生态，不是 Copilot 自己的配置。结果 Copilot 页面直接把它们展示出来，看起来像是 Copilot 在强行接管别的工具配置。

严格说，它不是 Claude 主动塞给 Copilot，而是 VS Code/Copilot 的 Agent Customizations 系统默认会发现多种 AI 自定义源。

## 机制

VS Code 的 Copilot Customizations 体系现在不只是读 `.github/copilot-instructions.md`。它有一整套 Agent Customizations 概念，包括 instructions、prompts、custom agents、skills、hooks 等。

官方文档里提到，Agent Customizations 编辑器会统一管理这些自定义项。也就是说，你在 UI 里看到的不是单一 Copilot 插件配置，而是 VS Code 层面的 AI 自定义发现系统。

Hooks 的默认扫描位置尤其关键。VS Code hooks 文档列出的默认来源包括：

```json
"chat.hookFilesLocations": {
  ".github/hooks": true,
  ".claude/settings.local.json": true,
  ".claude/settings.json": true,
  "~/.claude/settings.json": true
}
```

这解释了为什么一打开页面就能看到 Claude hooks。它不是从 `github.copilot.*` 配置来的，而是从 `chat.hookFilesLocations` 这类通用 chat customization 配置来的。

Skills 也是类似逻辑。VS Code Agent Skills 文档列出的项目级 skills 包括：

```text
.github/skills/
.claude/skills/
.agents/skills/
```

个人级 skills 包括：

```text
~/.copilot/skills/
~/.claude/skills/
~/.agents/skills/
```

所以如果你本机已经有 `~/.claude/skills` 或 `~/.agents/skills`，VS Code/Copilot 就可能把它们当成可用 skills 展示出来。这个“兼容”本意也许是跨工具复用，但实际体验就是：一个工具越界读取另一个工具的配置，UI 还不把来源讲清楚。

## 为什么 `claudeAgent.enabled` 没用

一开始很容易以为应该关这个：

```json
"github.copilot.chat.claudeAgent.enabled": false
```

但这个开关管的不是 hooks 或 skills 发现。VS Code Copilot settings reference 对它的描述是：启用或禁用由 Anthropic Claude Agent SDK 支持的 Claude agent sessions。

也就是说，它影响的是 Copilot 里那个 Claude Agent session 入口，而不是 Agent Customizations 编辑器对 `.claude/settings.json`、`~/.claude/skills`、`~/.agents/skills` 的扫描。

这就是误区：`github.copilot.chat.claudeAgent.enabled` 看起来像是总开关，实际上它不是这次问题的控制点。

## 最后怎么关

我们最后用的是 VS Code 的 `chat.*` 自定义源配置，而不是 `github.copilot.*`。

在 VS Code Insiders 的用户设置里加入：

```json
{
  "chat.useClaudeHooks": false,
  "chat.hookFilesLocations": {
    ".claude/settings.json": false,
    ".claude/settings.local.json": false,
    "~/.claude/settings.json": false
  },
  "chat.useClaudeMdFile": false,
  "chat.agentSkillsLocations": {
    "~/.agents/skills": false,
    ".claude/skills": false,
    "~/.claude/skills": false
  }
}
```

这里有几个细节。

第一，`chat.hookFilesLocations` 里把 Claude Code 的 hook 配置源逐个设成 `false`。官方 hooks 文档明确说明，默认位置也可以通过设为 `false` 来禁用。

第二，`chat.useClaudeMdFile` 用来关掉 `CLAUDE.md` 这类 Claude 记忆/指令文件的读取。

第三，`chat.agentSkillsLocations` 里禁用的是具体 skill 来源。注意 `~/.agents/skills` 是用户全局目录，不是 `.agents/skills`。前者在用户 home 下，后者是当前 workspace 里的相对目录，写错就关不到同一个东西。

第四，不要为了这个问题直接写：

```json
"chat.useHooks": false
```

这个更像全局关闭 hooks，范围太大。如果目标只是禁止 Claude hooks 被兼容读取，应该优先关 `chat.useClaudeHooks` 和 Claude 相关 hook locations。

## WSL Remote 还要多配一份

如果是在 Windows 上跑 VS Code Insiders，然后连接到 WSL2，那么只改 Windows 侧 settings 可能不够。

Windows 侧用户设置路径是：

```text
C:\Users\Travis\AppData\Roaming\Code - Insiders\User\settings.json
```

WSL Remote 侧 VS Code Server Insiders 的 machine settings 是：

```text
~/.vscode-server-insiders/data/Machine/settings.json
```

我的最终做法是两边都写同一组配置。原因很简单：Copilot/Chat/Agent Customizations 有一部分逻辑可能跑在 remote extension host 里，只改本地用户设置不一定能影响 WSL 侧实际运行的 extension host。

改完之后执行：

```text
Developer: Reload Window
```

如果还不刷新，就断开 WSL Remote 后重新连接。

## 最小结论

这次问题的根因不是 Claude 配置本身，而是 VS Code/Copilot 的 Agent Customizations 默认兼容读取了 Claude 和 Agents 生态的配置目录。

不要把主要精力放在 `github.copilot.chat.claudeAgent.enabled` 上。它管的是 Claude Agent session，不管通用 customizations 的 hooks/skills 扫描。

真正相关的是这些配置：

```json
{
  "chat.useClaudeHooks": false,
  "chat.hookFilesLocations": {
    ".claude/settings.json": false,
    ".claude/settings.local.json": false,
    "~/.claude/settings.json": false
  },
  "chat.useClaudeMdFile": false,
  "chat.agentSkillsLocations": {
    "~/.agents/skills": false,
    ".claude/skills": false,
    "~/.claude/skills": false
  }
}
```

如果在 WSL Remote 里用 VS Code Insiders，把这段同时放到 Windows 用户设置和 WSL remote machine settings 里。然后 reload window。这个配置改完后，Agent Customizations 页面里那些被硬兼容进来的 Claude hooks 和 skills 就会消失。

## 参考

- [Agent hooks in Visual Studio Code](https://code.visualstudio.com/docs/copilot/customization/hooks)
- [Use Agent Skills in VS Code](https://code.visualstudio.com/docs/copilot/customization/agent-skills)
- [Customize AI in Visual Studio Code](https://code.visualstudio.com/docs/copilot/customization/overview)
- [GitHub Copilot in VS Code settings reference](https://code.visualstudio.com/docs/copilot/reference/copilot-settings)
