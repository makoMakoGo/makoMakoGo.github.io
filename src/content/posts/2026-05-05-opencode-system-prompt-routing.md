---
title: OpenCode 系统提示词的模型名路由机制
date: 2026-05-05
description: 解析 OpenCode 如何根据模型 ID 字符串选择不同 prompt 文件，并叠加运行时上下文形成最终系统提示词。
categories:
  - Harness
draft: false
---

## TL;DR

- OpenCode 的内置系统提示词不是单一固定文本，而是“模型 ID 字符串匹配 + prompt 文件路由 + 运行时上下文叠加”的组合机制。
- 模型名称本身会影响系统提示词；GPT、Codex、Claude、Gemini、Kimi、Trinity 等模型族会拿到不同的行为底稿。
- Agent 自定义 prompt 会覆盖模型族路由，因此排查一次调用时不能只看 model ID。
- 对自定义 provider、模型代理、模型重命名和 prompt 行为分析来说，模型 ID 是实际 prompt 选择的一部分。

## 结论

OpenCode 的内置系统提示词不是一份固定文本，而是一套“模型 ID 字符串匹配 + prompt 文件路由 + 运行时上下文叠加”的组合机制。

它的核心特点是：模型名称本身会影响系统提示词。OpenCode 会读取 `model.api.id`，用一组顺序固定的 `includes(...)` 判断，把不同模型路由到不同的内置 prompt 文件。匹配不到任何已知模型族时，才使用 `default.txt`。

这使 OpenCode 的系统提示词机制很独特：它不是只按 provider 调用模型，也不是只把同一套 OpenCode prompt 发给所有模型，而是根据模型名给不同模型套上不同的“行为底稿”。GPT、Codex、Claude、Gemini、Kimi、Trinity 等模型族会拿到不同风格的初始系统提示词。

## 路由入口

OpenCode 的模型族路由集中在 `packages/opencode/src/session/system.ts` 的 `provider(model)` 函数。

OpenCode 会检查模型 ID 里是否包含特定关键词，按优先级从上到下匹配，命中即停：

| 模型 ID 包含 | 路由到的 prompt | 代表模型 |
|---|---|---|
| `gpt-4` / `o1` / `o3` | `beast.txt` | GPT-4o、o1-preview、o3-mini 等推理型模型 |
| `gpt` + `codex` | `codex.txt` | Codex 系列 |
| `gpt`（不含 codex） | `gpt.txt` | 普通 GPT 模型 |
| `gemini-` | `gemini.txt` | Gemini 系列 |
| `claude` | `anthropic.txt` | Claude 全系 |
| `trinity`（不区分大小写） | `trinity.txt` | Trinity 系列 |
| `kimi`（不区分大小写） | `kimi.txt` | Kimi / Moonshot 系列 |
| 以上都不匹配 | `default.txt` | 任何未知模型 |

判断方式很简单：看模型 ID 字符串里有没有出现对应关键词。不涉及模型能力评估，也不看 provider 信息。

未命中任何规则的模型会使用 `default.txt`——一份通用的 OpenCode coding-agent 指令，风格中性，不像 `gpt.txt` 带 Codex 风格，也不像 `kimi.txt` 带 Kimi Code 痕迹。

## 运行时组装

模型路由只决定“基础 prompt”。最终发给模型的 system instructions 还会继续叠加其他层。

在 `packages/opencode/src/session/prompt.ts` 中，OpenCode 会先收集：

| 层 | 来源 |
|---|---|
| 环境信息 | `SystemPrompt.environment(model)` |
| 项目/全局指令 | `instruction.system()` |
| skills 说明 | `SystemPrompt.skills(agent)` |
| 结构化输出提醒 | JSON schema 输出时追加 |

这些内容会作为 `input.system` 传给 LLM 处理流程。

在 `packages/opencode/src/session/llm.ts` 中，真正组装系统提示词时的顺序是：

1. 如果当前 agent 自带 `prompt`，优先使用 agent prompt。
2. 如果 agent 没有自带 `prompt`，使用 `SystemPrompt.provider(input.model)` 选出的模型族 prompt。
3. 追加运行时传入的 `input.system`。
4. 追加最后一条用户消息里可能携带的 `user.system`。
5. 触发 `experimental.chat.system.transform` 插件钩子，允许插件改写 system 内容。

因此，OpenCode 的完整系统提示词不是单个文件，而是：

```text
模型族基础 prompt
+ 环境信息
+ AGENTS.md / CLAUDE.md / CONTEXT.md / config.instructions
+ skills 信息
+ 特殊格式提醒
+ 用户消息 system 字段
+ 插件 transform 后的结果
```

## Agent Prompt 会覆盖模型路由

一个容易忽略的细节是：`llm.ts` 里写的是“use agent prompt otherwise provider prompt”。

这意味着如果当前 agent 配置了自己的 `prompt`，OpenCode 就不会使用 `SystemPrompt.provider(input.model)` 选出来的模型族 prompt。模型名路由只在 agent 没有自定义 prompt 时生效。

这让 OpenCode 同时支持两种控制方式：

| 控制方式 | 行为 |
|---|---|
| 模型名路由 | 默认 agent 根据模型 ID 自动选 prompt |
| Agent prompt | 特定 agent 可以完全覆盖模型族 prompt |

所以判断某次调用到底用了哪份系统提示词时，不能只看模型 ID，还要看当前 agent 是否有自己的 prompt。

## 项目指令叠加

OpenCode 还会把项目指令文件并入系统提示词。相关逻辑在：

`packages/opencode/src/session/instruction.ts`

它会寻找几类文件：

| 来源 | 说明 |
|---|---|
| 全局 `AGENTS.md` | OpenCode 配置目录下的全局指令 |
| `~/.claude/CLAUDE.md` | 如果没有被 flag 禁用，会作为兼容层读取 |
| 项目 `AGENTS.md` | 项目级代理指令，优先级高于 `CLAUDE.md` 和 `CONTEXT.md` |
| 项目 `CLAUDE.md` | 兼容 Claude Code 生态的项目指令 |
| 项目 `CONTEXT.md` | 已废弃但仍兼容 |
| `config.instructions` | 配置中额外指定的本地路径或 URL |

项目文件的选择也有优先顺序：先找 `AGENTS.md`，再找 `CLAUDE.md`，最后找 `CONTEXT.md`。一旦某类文件有匹配，就不会继续尝试后面的文件名。

这说明 OpenCode 的系统提示词不是纯内置 prompt。内置 prompt 只是第一层，项目说明和配置说明会在每轮请求中继续参与。

## 字符串匹配的边界

这套机制简单，但也带来几个边界行为。

## 顺序决定结果

`gpt-4`、`o1`、`o3` 的判断在普通 `gpt` 判断之前。因此只要模型 ID 包含 `gpt-4`，就会进入 `beast.txt`，不会进入 `gpt.txt` 或 `codex.txt`。

如果存在类似 `gpt-4-codex` 的模型 ID，按当前顺序会先命中 `gpt-4`，因此走 `beast.txt`，而不是 `codex.txt`。

## Prompt 来源的混合感

从当前源码可以看到，OpenCode 的 prompt 文件并不是统一风格的一套原创说明，而是带有明显的模型生态适配痕迹。

`gpt.txt` 与 Codex / GPT-5 系列 coding-agent prompt 高度相似，但把身份改成了 OpenCode，并把工具术语改成 OpenCode 自己的 `Glob`、`Grep`、`commentary`、`final` 等表达。

`kimi.txt` 的来源证据更直接。OpenCode PR #20259 明确说明，这个 prompt 是代表 Moonshot AI 提交，内容迁移自 Kimi Code CLI，目的是让 Kimi 系列模型保留已知有效的提示风格，并恢复使用 generic default prompt 时在内部 coding benchmark 中出现的性能回退。

OpenCode git 历史也对应这一点：提交 `2daf4b805` 增加了 `packages/opencode/src/session/prompt/kimi.txt`，同时修改 `packages/opencode/src/session/system.ts`，让包含 `kimi` 的模型 ID 走 Kimi 专用 prompt。因此 Kimi 不是单纯靠文本相似性推断来源，而是有 PR 描述、提交范围和源码对照三重证据。

当前 Kimi Code CLI 的 `system.md` 已经比 OpenCode 版本更新、更长，包含 `ROLE_ADDITIONAL`、`KIMI_OS`、`KIMI_WORK_DIR_LS`、background bash、foreground approval 等动态能力说明。OpenCode 的 `kimi.txt` 更像是迁移时取了 Kimi CLI system prompt 的核心静态部分，再把产品名和工具名改成 OpenCode 的 `task`、`write`、`edit`、`bash`、`read`、`glob`、`grep`。

这说明 OpenCode 的模型路由不仅是技术路由，也是一种“prompt 方言路由”：给不同模型族匹配更接近其原生 coding-agent 产品的行为说明，再统一贴上 OpenCode 身份和工具接口。

## 为什么这很有意思

很多 coding agent 会把系统提示词设计成一份统一的产品人格，然后把模型当作可替换后端。OpenCode 这里的做法不一样：模型名参与系统人格选择。

这带来一种很有意思的结果：

| 传统理解 | OpenCode 机制 |
|---|---|
| 换模型主要影响能力、速度、价格 | 换模型还可能改变系统提示词风格 |
| provider 决定调用方式 | model ID 决定 prompt 方言 |
| prompt 是产品级统一说明 | prompt 是按模型族分发的行为底稿 |
| 未知模型只是换个后端 | 未知模型会落入 `default.txt` 行为集 |

因此，OpenCode 的“模型选择”不只是模型选择，也隐含了 prompt 选择。

## 对使用者的影响

如果只是普通使用 OpenCode，这套机制通常是透明的。用户选择 Claude、GPT、Gemini、Kimi，OpenCode 自动挑一份看起来更适合该模型族的 prompt。

但如果你在做自定义 provider、模型代理、模型重命名或 prompt 行为分析，这套机制就很关键。

需要特别注意：

| 场景 | 影响 |
|---|---|
| 自定义模型 ID 包含 `gpt` | 会进入 GPT 路由 |
| 自定义模型 ID 包含 `kimi` | 会进入 Kimi 路由 |
| 自定义模型 ID 大写或非标准命名 | 可能不命中预期规则 |
| Agent 有自定义 prompt | 模型族路由会被绕过 |
| 插件改写 system | 最终 prompt 可能不同于内置文件 |
| 项目存在 `AGENTS.md` | 项目规则会叠加进 system |

所以排查 OpenCode 某次模型行为时，最少要同时看四件事：

1. 当前 `model.api.id` 是什么。
2. `system.ts` 会把它路由到哪个 prompt 文件。
3. 当前 agent 是否配置了自己的 prompt。
4. 当前项目和配置是否注入了额外 instructions。

## 机制总结

OpenCode 的系统提示词机制可以概括为：

```text
先按模型名选择内置 prompt 方言，
再叠加环境、项目、配置、skills 和用户级 system，
最后允许插件改写，
然后把结果作为完整 system instructions 发给模型。
```

它的独特之处不在于“有多个 prompt 文件”，而在于把模型 ID 字符串当成 prompt 路由键。这个设计很轻量，但影响很大：同一个 OpenCode，在不同模型名下可能呈现出不同的行为底色。

## 资料来源

- OpenCode 路由入口：`packages/opencode/src/session/system.ts`
- OpenCode LLM 组装：`packages/opencode/src/session/llm.ts`
- OpenCode 运行时 system 叠加：`packages/opencode/src/session/prompt.ts`
- OpenCode 项目指令读取：`packages/opencode/src/session/instruction.ts`
- OpenCode prompt 文件目录：`packages/opencode/src/session/prompt/`
- Kimi Code 对照来源：`kimi-code/src/kimi_cli/agents/default/system.md`
- OpenCode Kimi prompt PR：https://github.com/anomalyco/opencode/pull/20259
- OpenCode Kimi prompt commit：`2daf4b805 feat: add a dedicated system prompt for Kimi models (#20259)`
- Codex 对照来源：`codex/codex-rs/models-manager/models.json`
