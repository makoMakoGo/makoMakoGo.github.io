---
title: Moonshot Kimi Prompt 兼容性问题
date: 2026-05-05
description: 分析 OpenCode generic default prompt 对 Kimi coding / reasoning benchmark 的影响，以及 Kimi-specific prompt 路由修复。
categories:
  - Harness
draft: false
---

## TL;DR

- Moonshot AI 在 OpenCode issue #20258 中报告：OpenCode 1.2.27 的 generic default system prompt 会降低 `kimi-k2.5` 在 coding / reasoning benchmark 上的表现。
- 问题不是 Kimi 不能做 coding agent，而是同一份默认系统提示词并不一定对所有模型中性。
- OpenCode PR #20259 新增 Kimi-specific prompt，并让 model ID 包含 `kimi` 时路由到该 prompt。
- 对 `fish-claude` 的审计重点是清理全局“短答优先”约束，同时保留反 filler、反 ceremony、反 cheerleading 和完整证据输出规则。

## 结论

Moonshot issue 指的是 OpenCode issue #20258：Moonshot AI 代表方报告，OpenCode 1.2.27 的 generic default system prompt 会降低 `kimi-k2.5` 在 coding-oriented 和 reasoning-oriented benchmark 上的表现。

问题不在于 Kimi 模型本身不能用于 coding agent，而在于同一份默认系统提示词并不一定对所有模型中性。Moonshot 的内部评测显示，Kimi 使用 default prompt 时平均分下降、结果方差上升；改用 Kimi Code CLI 迁移来的 Kimi 专用 prompt 后，内部 benchmark 回归得到恢复。

OpenCode 最终通过 PR #20259 解决：新增 `packages/opencode/src/session/prompt/kimi.txt`，并修改 `packages/opencode/src/session/system.ts`，让模型 ID 包含 `kimi` 时使用 Kimi-specific prompt，而不是 generic default prompt。

## Issue 内容

Issue #20258 标题是：

> Default system prompt degrades `kimi-k2.5` performance on coding benchmarks

报告者说明这是代表 Moonshot AI 提交。其内部评测发现，当前 default system prompt 会降低 `kimi-k2.5` 在 coding-oriented 和 reasoning-oriented benchmarks 上的表现。

公开 issue 给出的匿名 benchmark 结果：

| Benchmark | With fine-tuned prompt | With default prompt |
|---|---:|---:|
| Benchmark A | `58.0 ± 2.4` | `54.1 ± 3.8` |
| Benchmark B | `67.1 ± 1.0` | `60.0 ± 2.4` |

Moonshot 对结果的解释是：default prompt 对 Kimi 不是中性的。它不仅降低平均表现，还降低稳定性。

## 三类 anti-pattern

Moonshot 在 issue 中列出三类具体问题。

### 1. 过度压缩输出

Default prompt 反复要求模型尽量短答，例如：

- `minimize output tokens as much as possible`
- `should NOT answer with unnecessary preamble or postamble`
- `MUST answer concisely with fewer than 4 lines`
- `One word answers are best`

Moonshot 的判断是：对 reasoning-oriented coding model 来说，这类约束过强。它会把模型推向欠规格、浅层、过早收束的回答，并抑制必要的规划、解释和中间推理。

这类问题的关键不是“禁止废话”本身，而是把短答当成普遍目标。coding agent 的正确目标应是完成任务、保留证据、解释必要风险、验证行为，而不是固定压缩 token。

### 2. few-shot 示例不匹配

Issue 指出 default prompt 里的 few-shot examples 主要是简单问答，例如：

- `2+2`
- `How many golf balls fit inside a jetta?`
- `is 11 a prime number?`

这些示例和真实 coding / engineering task 不匹配。它们容易把模型锚定到 trivia QA 或短问短答模式，而不是读代码、搜索上下文、调用工具、规划修改、验证结果的 coding-agent 模式。

### 3. 内部指令冲突

Issue 还指出 prompt 内部存在冲突：一方面要求模型解释命令做什么、为什么运行；另一方面又禁止或强烈压缩解释性文本。

这种冲突会造成行为不稳定：模型既被要求说明，又被要求不要说明。Moonshot 认为这可能解释了 default prompt 下 benchmark 方差更高的问题。

## OpenCode 修复方式

PR #20259 标题是：

> feat: add a dedicated system prompt for Kimi models

PR 描述明确写明：

- 这是代表 Moonshot AI 提交。
- 新 prompt 内容迁移自 Kimi Code CLI。
- 该 prompt 专门针对 Kimi-series models 调整。
- 目标是在 OpenCode 内保留已知对 Kimi 有效的 prompting style。
- 内部测试确认该 prompt 能恢复 issue #20258 描述的 benchmark regression。

改动范围：

- 新增 `packages/opencode/src/session/prompt/kimi.txt`
- 修改 `packages/opencode/src/session/system.ts`
- 让包含 `kimi` 的 model ID 路由到 Kimi-specific prompt

这说明 OpenCode 的模型 prompt 路由不是纯粹的品牌偏好，而是对模型族行为差异的兼容层。

## 对 fish-claude 的审计结果

根据这个 Moonshot issue，我们已经检查并清理了 `fish-claude` 中对应的 anti-pattern。

已清理项：

- 删除 `agent-instructions/oh-my-pi/01-defaults.md` 中的 `You MUST keep replies concise, respectful, and focused on the current task.`
- 同步删除 WSL OMP 配置目录中生效 `AGENTS.md` 的同一行。
- 删除不再使用的 `agent-instructions/general/04-reply-style.md`。
- 删除 `agent-instructions/README.md` 中对 `general/04-reply-style.md` 的索引行。

验证范围覆盖：

- Windows Claude Code 配置目录
- Windows Codex 配置目录
- WSL Claude Code 配置目录
- WSL Codex 配置目录
- WSL OpenCode 配置目录
- WSL OMP 配置目录
- `fish-claude/agent-instructions`

未发现残留的高风险模式：

- `minimize output tokens as much as possible`
- `MUST answer concisely with fewer than 4 lines`
- `One word answers are best`
- `unnecessary preamble/postamble`
- `2+2`
- `How many golf balls fit inside a jetta?`
- `is 11 a prime number?`
- `general/04-reply-style.md`
- `回答风格`
- `语言简洁、直接、信息优先`

剩余的 `short` / `concise` 命中主要来自局部场景：Codex 子代理的 progress update、OpenAI system skills 的 image/doc/skill metadata 说明、第三方依赖源码和证书内容。这些不是全局 coding-agent prompt，也不是 Moonshot issue 中批评的短答压制模式。

## 保留原则

本次清理不等于鼓励冗长输出。保留的原则是：

- 删除“短答优先”的全局风格约束。
- 保留“不要 filler / 不要 ceremony / 不要 cheerleading”的反废话规则。
- 保留“不要截断重要日志、diff、stack trace、commands、critical reasoning”的完整性规则。
- coding / reasoning 任务以任务完成、证据充分、验证清楚为目标，而不是以 token 数最少为目标。

更准确的 prompt 原则是：去掉废话，但不要压缩掉证据、推理、验证结果和关键风险。

## 资料来源

调研日期：2026-05-05。

资料来源包括 OpenCode issue #20258、OpenCode PR #20259，以及 `fish-claude` 配置扫描。
