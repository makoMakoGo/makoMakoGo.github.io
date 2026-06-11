---
title: Claude Code 和 Codex 如何把 Skill 设成只能手动触发
date: 2026-05-30
description: 整理 Claude Code 与 Codex 对单个 skill 的 manual-only 控制方式，以及 Claude Code plugin skills 无法被 settings 逐个覆盖的坑。
categories:
  - Vibe Coding
draft: false
---

最近折腾 Claude Code 和 Codex 的 skills 时，我遇到一个非常具体但很重要的问题：能不能让某个 skill 继续存在，但不要让 agent 自己根据描述主动调用它，只允许我显式触发？

这个需求不是“禁用 skill”。禁用以后，用户也用不了。我要的是另一种状态：skill 还在，命令入口还在，但 agent 不应该因为觉得当前任务“看起来相关”就自己把它加载进来。典型例子是 `/deploy`、`/commit`、`/send-slack-message` 这类有副作用的 workflow。它们可以是自动化流程，但触发时机必须由人决定。

结论先放前面：Claude Code 和 Codex 都支持 per-skill 的 manual-only，但配置位置完全不一样。Claude Code 的设计更直观，Codex 的设计更像把 OpenAI 专属元数据藏在 skill 旁边的一个附加文件里。

## manual-only 不是 off

先把状态拆清楚，不然很容易把几个开关混在一起。

```text
on:
  agent 可以主动触发
  用户也可以显式触发

manual-only:
  agent 不可以主动触发
  用户可以显式触发

off:
  agent 看不到
  用户也不能从正常入口触发
```

这篇只讨论中间那个：manual-only。

它适合两类 skill。第一类是有副作用的命令，比如部署、发消息、批量改配置、提交代码。第二类是上下文很重、误触发成本很高的流程，比如大型 review、深度架构分析、跨工具调度。你可能希望保留它们，但不希望 agent 一看到关键词就自己开跑。

## Claude Code：两种位置都能配

Claude Code 的 standalone skill 可以直接在 `SKILL.md` 的 frontmatter 里写：

```md
---
name: deploy
description: Deploy the application to production
disable-model-invocation: true
---
```

`disable-model-invocation: true` 的语义很明确：Claude 不能自动加载或调用这个 skill，但用户仍然可以通过 `/deploy` 显式触发。

如果这个 skill 来自共享仓库，或者你不想改它自己的 `SKILL.md`，Claude Code 还支持在 settings 里按 skill 名覆盖：

```json
{
  "skillOverrides": {
    "deploy": "user-invocable-only"
  }
}
```

这两个配置解决的是同一个核心问题：把某个 skill 从 Claude 的主动触发候选里拿掉，但保留用户显式入口。区别只是一个写在 skill 本体里，一个写在外部 settings 里。

Claude Code 的 `skillOverrides` 还有另外几个状态：

| 值 | 给 Claude 看 | 用户 `/` 菜单 |
| --- | --- | --- |
| `on` | 名称和描述 | 显示 |
| `name-only` | 只有名称 | 显示 |
| `user-invocable-only` | 不给 Claude 看 | 显示 |
| `off` | 不给 Claude 看 | 不显示 |

这里最容易搞反的是 `user-invocable: false`。它不是 manual-only。它的意思是用户不能从 `/` 菜单调用，只留给 Claude 自己使用。也就是说，`disable-model-invocation: true` 和 `user-invocable: false` 是两个相反方向的限制。

官方文档的说法也基本是这个模型：默认用户和 Claude 都能调用；`disable-model-invocation: true` 表示只有用户能调用；`user-invocable: false` 表示只有 Claude 能调用。`skillOverrides` 则是外部 settings 里的可见性覆盖，要求 Claude Code v2.1.129 或更高版本。

## Codex：写在 agents/openai.yaml

Codex 这边的配置看起来绕一点。一个 Codex skill 的主文件仍然是 `SKILL.md`，但 Codex/OpenAI 自己的额外元数据放在 skill 目录下的：

```text
<skill>/
  SKILL.md
  agents/
    openai.yaml
```

如果要把某个 skill 设成 manual-only，就在 `agents/openai.yaml` 里写：

```yaml
policy:
  allow_implicit_invocation: false
```

这个字段的意思是：Codex 不会因为当前任务匹配 skill 描述就隐式选择它，但用户显式 `$skill-name` 仍然可以触发。

比如 `karpathy-guidelines` 这个 skill，配置后目录大概是：

```text
karpathy-guidelines/
  SKILL.md
  agents/
    openai.yaml
```

`openai.yaml` 内容就是：

```yaml
policy:
  allow_implicit_invocation: false
```

实际效果也很直观。新会话里如果问 Codex “你的可用列表里有没有 karpathy-guidelines”，它不会再把这个 skill 当成默认可自动触发 skill 报出来。但显式写 `$karpathy-guidelines` 仍然是用户主动调用。

Codex 也有 `~/.codex/config.toml` 里的 skill 开关：

```toml
[[skills.config]]
path = "/abs/path/to/skill/SKILL.md"
enabled = false
```

但这不是 manual-only。这个是彻底禁用。禁用以后，用户显式 `$skill-name` 也不该依赖它继续可用。要做“不能主动触发，但我还能手动叫它”，应该用 `agents/openai.yaml` 里的 `allow_implicit_invocation: false`。

## 对照表

| 目标 | Claude Code | Codex |
| --- | --- | --- |
| 单个 skill 只能用户手动触发 | `SKILL.md` frontmatter: `disable-model-invocation: true` | `<skill>/agents/openai.yaml`: `policy.allow_implicit_invocation: false` |
| 不改 skill 本体，从外部覆盖 | `settings.json` 的 `skillOverrides.<name> = "user-invocable-only"` | 没有同等的 per-skill manual-only 外部覆盖 |
| 完全禁用单个 skill | `skillOverrides.<name> = "off"` | `[[skills.config]] enabled = false` |
| 只压缩成名字，减少描述占用 | `skillOverrides.<name> = "name-only"` | 没有稳定的 per-skill 等价项 |

所以一句话概括：Claude Code 的控制面更像用户可调的 visibility matrix；Codex 更像在 skill 旁边放一个 OpenAI 专属 manifest，用 policy 控制是否允许隐式调用。

## Claude Code plugin skills 的坑

最烦的是 Claude Code plugin skills。

Claude Code 的 `skillOverrides` 文档明确说，它不作用于 plugin skills。也就是说，如果一个插件塞进来十几个 skills，你不能在自己的 `settings.json` 里优雅地把其中几个单独改成 `user-invocable-only`。这点很恶心，因为 plugin 的分发粒度和你实际想使用的 skill 粒度经常不一致。

如果你能改 plugin 本体，或者愿意 fork 插件，那么 plugin 里的 skill 仍然可以在自己的 `SKILL.md` frontmatter 里加：

```md
---
name: noisy-plugin-skill
description: Some plugin workflow
disable-model-invocation: true
---
```

但如果你只是安装别人的 plugin，又不想 fork，那就只能走更粗的管理方式：通过 `/plugin` 管整个插件，或者把你真正需要的少数 skills 拆出来，复制成 standalone skills 放到用户或项目 skill 目录里。后者更土，但控制权更清楚。

## 我现在的用法

我会把 skills 分成三类。

第一类是无副作用、低成本、明显该自动触发的知识或流程，比如某些代码风格约束、测试策略、项目阅读方法。这类保持默认。

第二类是有副作用或成本较高的流程，比如部署、提交、跨 agent 调度、大型 review。这类设成 manual-only。Claude Code 用 `disable-model-invocation: true` 或 `skillOverrides = "user-invocable-only"`；Codex 用 `agents/openai.yaml` 的 `allow_implicit_invocation: false`。

第三类是我几乎不用、但暂时不想删的 skill。这类才是真正的 off。Claude Code 里用 `skillOverrides = "off"`，Codex 里用 `[[skills.config]] enabled = false`。

这样分完以后，agent 的 skill 列表会干净很多。最关键的是：那些会改世界状态的按钮，不再由模型自己决定什么时候按。

## 参考

- [Claude Code skills 文档](https://code.claude.com/docs/en/slash-commands)
- [Claude Code settings 文档](https://code.claude.com/docs/en/settings)
- [Codex Agent Skills 文档](https://developers.openai.com/codex/skills)
- [Codex config reference](https://developers.openai.com/codex/config-reference)
