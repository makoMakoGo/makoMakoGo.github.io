---
title: OpenCode 和 OMP 如何限制 Skill 自动触发
date: 2026-05-31
description: "补充 OpenCode 与 Oh My Pi 对单个 skill 的手动触发控制：OpenCode 用 permission.skill deny，OMP 用 hide: true。"
categories:
  - Vibe Coding
draft: false
---

前一篇整理了 Claude Code 和 Codex 怎么把某个 skill 设成只能用户手动触发。后来继续翻 OpenCode 和 Oh My Pi，发现这两个 harness 也有接近的能力，但实现位置完全不一样。

先说结论：OpenCode 更像“权限拦截”，OMP 更像“隐藏曝光”。OpenCode 可以用 `permission.skill.<name> = "deny"` 把某个 skill 从 agent 的 skill tool 里拿掉，同时保留用户 slash command。OMP 则是在 `SKILL.md` frontmatter 里写 `hide: true`，让这个 skill 不进入系统提示词的 `<skills>` 列表，但仍然保留 `skill://<name>` 和 `/skill:<name>`。

这两个机制都能满足“不要让模型主动发现和触发，但我还能手动叫它”的大部分需求。不过它们不是同一种强度。OpenCode 的 `deny` 更像权限层面的阻断；OMP 的 `hide: true` 更像从默认可见列表里隐藏，不能当安全边界用。

## 先拆状态

我现在会把 skill 状态拆成四类：

```text
on:
  agent 可以主动发现和使用
  用户也可以显式触发

manual-only:
  agent 不应该主动发现或触发
  用户可以显式触发

ask:
  agent 可以尝试触发
  但需要用户批准

off:
  agent 不能用
  用户也不应该从正常入口触发
```

OpenCode 和 OMP 讨论的是中间那个 `manual-only`。它和 `off` 不一样。`off` 是删掉入口；`manual-only` 是保留入口，但触发权交给用户。

这对有副作用的 skill 很重要。比如部署、发消息、发布包、批量改仓库配置、创建 PR、跨 agent 调度。这些流程可以被自动化，但不应该被模型根据描述自己判断“当前任务很像，那我直接用一下”。

## OpenCode：用 permission.skill deny

OpenCode 的 skill 是通过原生 `skill` tool 暴露给 agent 的。文档里说得很直接：agent 会看到可用 skills，并在需要时调用 `skill({ name: "..." })` 加载完整内容。

如果要阻止某个 skill 被模型主动使用，可以在 `opencode.json` 里配置 `permission.skill`：

```json
{
  "permission": {
    "skill": {
      "*": "allow",
      "deploy": "deny"
    }
  }
}
```

这里的关键是 `deploy: "deny"`。它的效果不是“需要用户批准”，而是把这个 skill 对 agent 隐藏，并拒绝 agent 对它的访问。OpenCode docs 对 `deny` 的解释也是：skill hidden from agent, access rejected。

如果要按模式批量处理，可以用 wildcard：

```json
{
  "permission": {
    "skill": {
      "*": "allow",
      "internal-*": "deny",
      "release-*": "deny"
    }
  }
}
```

这样 `internal-docs`、`internal-tools`、`release-prod` 这类 skill 都不会出现在当前 agent 的可用 skill 列表里。

## 为什么用户仍然能手动触发

OpenCode 这里有意思的点是：skill tool 和用户 slash command 不是同一个入口。

模型看到的是 `skill` tool。这个 tool 的描述会列出 `<available_skills>`，而这个列表来自 `Skill.available(agent)`。源码里 `Skill.available(agent)` 会按当前 agent 的 permission 过滤：如果 `Permission.evaluate("skill", skill.name, agent.permission).action === "deny"`，这个 skill 就不进入 available list。

但用户 slash command 是另一条链路。OpenCode 在构建 commands 时遍历的是 `skill.all()`，不是 `skill.available(agent)`。也就是说，某个 skill 被 `permission.skill.deploy = "deny"` 从 agent 的 skill tool 里隐藏以后，它仍然可以作为用户命令存在。

实际使用时，OpenCode 的 skill slash command 是按 skill 名注册的。比如 skill 名叫 `deploy`，用户走的是：

```text
/deploy
```

不是 OMP 那种 `/skill:deploy`。

所以 OpenCode 的 manual-only 可以概括成：

```text
permission.skill.deploy = "deny"
  -> agent 的 skill tool 看不到 deploy
  -> agent 调 skill({ name: "deploy" }) 会被拒绝
  -> 用户仍然可以 /deploy
```

这很接近我们想要的 per-skill manual-only，而且比纯 prompt 约束硬。模型不是只被告知“不要用”，而是从工具描述里看不到；即使知道名字去试，也会撞到权限拒绝。

## ask 不是 manual-only

OpenCode 还有 `ask`：

```json
{
  "permission": {
    "skill": {
      "deploy": "ask"
    }
  }
}
```

这个状态不是 manual-only。`ask` 的意思是：agent 可以尝试加载这个 skill，但要弹出用户批准。

这适合一些“可以由模型建议，但必须经人确认”的场景，比如生成发布说明、打开某些外部上下文、执行成本较高的 review workflow。它不适合“模型连主动建议触发都不要”的场景。部署这种按钮，我更倾向于 `deny`，让它彻底从 agent 的 skill tool 视野里消失。

## OpenCode 的 per-agent 维度

OpenCode 的 permission 还可以放到 agent 配置里。全局 `permission.skill` 是默认规则，某个自定义 agent 或内置 agent 可以有自己的覆盖。

这意味着 OpenCode 的控制粒度不只是 per skill，也可以是 per agent + per skill。例如默认 agent 不能用 `internal-*` skills，但某个专门负责内部文档的 agent 可以允许：

```json
{
  "agent": {
    "docs": {
      "permission": {
        "skill": {
          "internal-*": "allow"
        }
      }
    }
  }
}
```

这个模型比 Claude Code 的 `skillOverrides` 更像权限系统。它不是在 skill 本体上声明“我只能手动触发”，而是当前 agent 的权限规则决定它能不能看到和调用这个 skill。

好处是灵活。坏处是你要记住：同一个 skill 在不同 agent 眼里可能不是同一个可见性状态。你以为它被禁了，结果只是对当前 agent 禁了。

## OMP：用 hide true 隐藏系统提示词曝光

Oh My Pi 这边的机制更轻。它在 `SKILL.md` frontmatter 里支持 `hide: true`：

```md
---
name: deploy
description: Deploy the service
hide: true
---

# Deploy

...
```

这个字段的语义很明确：skill 仍然会被加载，仍然可以通过 `skill://<name>` 访问，也仍然可以在启用 skill commands 时通过 `/skill:<name>` 手动触发；但它不会进入渲染后的系统提示词 `<skills>` 列表。

OMP 的系统提示词会把普通 skill 渲染成类似这样的列表：

```xml
<skills>
<skill name="some-skill">
description...
</skill>
</skills>
```

并告诉模型：如果某个 skill 适用，就先读 `skill://<name>`。`hide: true` 做的事情就是把这个 skill 从这个列表里拿掉。模型没有在系统提示词里看到它的名称和描述，就不应该因为任务匹配而自动发现它。

用户显式调用则走另一个入口：

```text
/skill:deploy
```

因此 OMP 的 manual-only 更准确地说是：

```text
hide: true
  -> 不进入系统提示词的 skills 列表
  -> 不参与默认自动发现
  -> 仍然 loaded
  -> 用户可以 /skill:deploy
  -> 已知名字时仍可 skill://deploy
```

## OMP 不是 hard deny

这点要特别小心。`hide: true` 不是权限拒绝。

它没有把 skill 从 active skills 里删除，也没有禁止 `skill://deploy`。源码注释甚至明确写了：`hide: true` 时，skill 仍然 reachable via `skill://<name>` and `/skill:<name>`，只是 excluded from rendered system prompt。

所以 OMP 的 `hide: true` 更像“不要把这个 skill 广播给模型自动选择”，不是“模型绝对不能读这个 skill”。如果模型因为历史上下文、用户提示、别的文件说明已经知道了 skill 名，它仍然可能尝试读取 `skill://deploy`。

这在普通 workflow 控制里足够好，但不适合安全隔离。不要把 secret、危险脚本、内部凭据放在一个 `hide: true` 的 skill 里，然后幻想模型不会碰它。这只是把门牌摘了，不是把门锁了。

## OMP 的 off 是另一套开关

如果你真的要禁用 OMP 的 skill，不应该用 `hide: true`，而应该用禁用类配置。

在 `SKILL.md` frontmatter 里可以写：

```md
---
name: old-release-flow
description: Deprecated release flow
enabled: false
---
```

这样扫描时会直接跳过这个 skill。

也可以在 settings 侧用过滤：

```yaml
disabledExtensions:
  - skill:old-release-flow

skills.ignoredSkills:
  - old-*

skills.includeSkills:
  - safe-*
```

这些都更接近 `off`。它们会影响 discovery/filtering，而不是只影响系统提示词曝光。

还有一个容易误会的开关：

```yaml
skills.enableSkillCommands: false
```

这个不是 manual-only。它只是关闭 `/skill:<name>` 这种用户命令注册。关掉以后，用户手动入口也没了，方向刚好反过来。

## 两者对照

| 目标 | OpenCode | OMP |
|---|---|---|
| 单个 skill 不让模型主动发现 | `permission.skill.<name> = "deny"` | `SKILL.md` frontmatter: `hide: true` |
| 用户仍可手动触发 | 是，`/<skill-name>` | 是，`/skill:<name>` |
| 模型是否还能强行读取 | 权限会拒绝 skill tool 访问 | 可能，若模型已知 `skill://<name>` |
| 控制层级 | permission，通常可按 agent 覆盖 | skill frontmatter |
| 真正 off | 需要移除 skill、禁用来源，或禁用整个 skill tool；`permission.skill.<name> = "deny"` 只禁 agent 入口 | `enabled: false`、`disabledExtensions`、`ignoredSkills`、`includeSkills` |
| 是否是硬权限 | 更接近硬权限 | 不是，只是隐藏默认曝光 |

这张表里最重要的是第三行。OpenCode 的 `deny` 会影响 skill tool 的 available list 和访问结果；OMP 的 `hide: true` 只影响系统提示词里那份 skills listing。

## 为什么设计会不同

这其实反映了两者对 skill 的抽象不同。

OpenCode 把 skill 作为一个工具能力暴露给模型。模型看到 `skill` tool，tool 描述里列出可用 skills。既然是 tool，就天然能接入 permission 系统。于是 manual-only 可以通过“不给模型这个工具能力”来实现。

OMP 把 skill 更像看作 file-backed instruction pack。它会在系统提示词里列出 skill 元数据，模型需要时通过 `read` 工具读取 `skill://<name>`。同时，交互层可以把 `/skill:<name>` 展开成一条 custom message。这里的关键路径是 prompt exposure 和 internal URL，而不是一个专门的 skill tool 权限。

所以 OpenCode 的办法像权限表：

```text
agent -> skill tool -> permission.skill -> allowed skills
```

OMP 的办法像可见性过滤：

```text
loaded skills -> hide filter -> rendered system prompt skills list
```

结果相似，含义不同。

## 我的用法

如果是在 OpenCode 里，我会把有副作用的 skill 直接设成 `deny`：

```json
{
  "permission": {
    "skill": {
      "*": "allow",
      "deploy": "deny",
      "publish-*": "deny",
      "send-*": "deny"
    }
  }
}
```

这样模型不会在 skill tool 里看到它们，但我仍然能用 `/deploy`、`/publish-npm` 这类 slash command 显式触发。

如果是在 OMP 里，我会给类似 skill 加：

```md
---
name: deploy
description: Deploy the service
hide: true
---
```

这适合“我不希望它自动出现在模型候选里，但它不是秘密，也不是绝对禁止”的 workflow。如果这个 skill 真的危险到不能被模型读，那我不会只用 `hide: true`，而是直接禁用、移走，或者把危险动作放到更明确的人类确认流程后面。

## 和前一篇合起来看

现在四个 harness 的图谱大概是这样：

| Harness | manual-only 做法 | 性质 |
|---|---|---|
| Claude Code | `disable-model-invocation: true` 或 `skillOverrides.<name> = "user-invocable-only"` | 明确的用户可调用、模型不可调用 |
| Codex | `<skill>/agents/openai.yaml` 里 `policy.allow_implicit_invocation: false` | 禁止隐式调用，保留 `$skill-name` |
| OpenCode | `permission.skill.<name> = "deny"` | 用权限系统隐藏并拒绝模型 skill tool 访问，保留用户 slash command |
| OMP | `SKILL.md` frontmatter `hide: true` | 从系统提示词 skill 列表隐藏，保留 `skill://` 和 `/skill:<name>` |

我最喜欢 Claude Code 的字段名，因为一眼能看懂。Codex 的 `agents/openai.yaml` 最绕，但语义还算干净。OpenCode 的方案最像工程系统，借权限表把这事做了。OMP 的 `hide: true` 最轻巧，也最容易被误用：它解决的是自动发现，不是访问控制。

最终还是那句话：manual-only 不是 off。真正要防的是模型自己决定什么时候按按钮。按钮可以存在，但按下去的人应该是你。

## 调研来源

- 调研日期：2026-05-31
- OpenCode skill 文档：`packages/web/src/content/docs/skills.mdx`
- OpenCode skill discovery 与 permission 过滤：`packages/opencode/src/skill/index.ts`
- OpenCode skill tool 描述生成：`packages/opencode/src/tool/registry.ts`
- OpenCode skill slash command 注册：`packages/opencode/src/command/index.ts`
- OMP skill 文档：`docs/skills.md`
- OMP skill frontmatter 类型：`packages/coding-agent/src/capability/skill.ts`
- OMP skill loading 与 `hide` 传递：`packages/coding-agent/src/extensibility/skills.ts`
- OMP system prompt 过滤：`packages/coding-agent/src/system-prompt.ts`
