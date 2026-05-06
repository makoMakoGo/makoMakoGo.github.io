---
title: Oh My Pi 中的 Agent、Subagent 与 Swarm 学习笔记
date: 2026-05-06
description: 整理 OMP 的 task delegation、默认子代理、自定义 subagent 与 YAML DAG swarm 的分层关系。
categories:
  - Oh My Pi
  - AI Agent
draft: false
---
## 1. 先说结论

Oh My Pi 里实际上有两套相关但不同的多代理能力：

1. **内建的 subagent / task delegation**
   - 在当前会话里，主代理临时拆分任务并委派给子代理。
   - 这套很像 Claude Code 的 built-in subagent 哲学。
   - 代码主要在 `packages/coding-agent/src/task/*`。

2. **YAML + DAG 的 swarm workflow**
   - 先写一个 `swarm.yaml`，定义多个 agent 节点、依赖关系和执行模式。
   - 再由 swarm orchestrator 按 DAG 执行。
   - 这套在 `packages/swarm-extension/*`，不是 core task 工具本体。

最容易混淆的地方在于：

- 二者底层都会用到 Oh My Pi 的子代理执行能力。
- 但上层使用方式完全不同。

---

## 2. 什么是 subagent / task delegation

这套能力的本质是：

- 主代理负责理解当前问题
- 决定要不要拆分
- 把子任务派给不同角色的子代理
- 子代理各自独立执行
- 最后再把结果汇总回来

可以把它理解成：

- 主代理 = 调度者
- 子代理 = 临时找来的专项工人
- `task` 工具 = 派工系统

### 它更像什么

更像 Claude Code 那种：

- 先分析当前问题
- 临时决定要不要开几个 helper
- 每个 helper 有不同职责
- 全都还是服务于当前会话

### 它的典型使用场景

- 并行查几个点
- 让一个子代理查架构，一个查默认值，一个查配置
- 让一个子代理做机械性收集，一个子代理做综合分析
- 让 reviewer 单独审查改动

---

## 3. OMP 内建的默认子代理

Oh My Pi 内建的常见子代理包括：

- `explore`：查代码、快速侦察、只读探索
- `plan`：做规划、架构分析
- `task`：通用执行型子代理
- `quick_task`：轻量、机械型子代理
- `reviewer`：代码审查
- `designer`：偏 UI/UX
- `librarian`：查外部库/源码/文档

我自己的理解可以记成：

- 查代码：`explore`
- 做计划：`plan`
- 做执行：`task`
- 做机械活：`quick_task`
- 做审查：`reviewer`

所以这套默认预设，本质上已经是一套通用 agent team。

---

## 4. 默认预设够不够用

对大多数人来说，**默认预设已经够用**。

原因：

1. 角色已经覆盖常见开发流程
2. 默认行为比较保守，不会过度并发、过度递归
3. 学习成本低，适合先理解 OMP 的工作方式

### 默认相关设置

常见默认值：

- `async.enabled = false`
- `task.eager = false`
- `task.isolation.mode = "none"`
- `task.isolation.merge = "patch"`
- `task.isolation.commits = "generic"`
- `task.maxConcurrency = 32`
- `task.maxRecursionDepth = 2`
- `task.disabledAgents = []`
- `task.agentModelOverrides = {}`

### 这套默认值的含义

- 默认不会特别激进地到处起后台任务
- 默认不会无限递归生成子代理
- 默认不会强制隔离工作区
- 但一旦需要并行委派，能力已经具备

所以对于“先学会用”，默认是合适的。

---

## 5. 什么情况下需要自定义子代理

只有在你出现很明确的固定需求时，才值得自定义：

### 场景 A：你有固定角色分工
例如：

- 一个代理只查前端
- 一个代理只查后端
- 一个代理只做测试
- 一个代理只做安全审计

### 场景 B：你有领域专用约束
例如：

- 安全审计
- 金融/量化
- 医疗软件
- 嵌入式开发

### 场景 C：你想改变 delegation 风格
例如：

- 更积极地委派：改 `task.eager`
- 降低并发：改 `task.maxConcurrency`
- 限制递归深度：改 `task.maxRecursionDepth`
- 强制隔离执行：改 `task.isolation.mode`

如果只是普通开发使用，先用默认预设更合理。

---

## 6. 自定义子代理像不像 Claude Code

像，而且哲学很接近。

### 相似点

1. 都有内建专家角色
2. 都支持用户自定义“领域专家”
3. 都偏向会话内动态委派

### 自建 subagent 的本质

其实就是把一种固定工作方式封装成“专职代理”：

- 定 prompt
- 定工具权限
- 定模型
- 定输出约束

这点和 Claude Code 的自建 subagent 非常像。

---

## 7. 那什么是 YAML + DAG 的 swarm

这个是另一套东西。

它不是普通的 task delegation，而是：

- 先写一个 `swarm.yaml`
- 明确写出有哪些 agent
- 明确写出依赖关系
- 明确执行模式
- 然后由 orchestrator 真正跑起来

### 它更像什么

更像：

- workflow engine
- pipeline orchestrator
- DAG 调度器

而不是“会话里临场找几个助手”。

---

## 8. swarm-extension 的关键特征

### 8.1 配置驱动
它需要一个 YAML 文件，例如：

```yaml
swarm:
  name: my-pipeline
  workspace: ./workspace
  mode: pipeline
  target_count: 10

  agents:
    finder:
      role: researcher
      task: |
        Find one new source.
    analyzer:
      role: analyst
      task: |
        Analyze the source.
      waits_for:
        - finder
```

### 8.2 支持 DAG
依赖关系来自：

- `waits_for`
- `reports_to`

然后系统会：

- 构建 dependency graph
- 检测 cycle
- 做 topological sort
- 生成 execution waves

### 8.3 支持多种执行模式
常见模式：

- `sequential`
- `parallel`
- `pipeline`

### 8.4 适合可重复流程
比如：

- 批量研究采集
- 内容生成流水线
- 多阶段审计流程
- 需要无人值守连续跑完的任务

---

## 9. task delegation 和 DAG swarm 的区别

| 维度 | `task` / subagent delegation | `swarm-extension` / YAML DAG swarm |
|---|---|---|
| 本质 | 会话内动态代理委派 | 预定义工作流编排 |
| 所在位置 | `packages/coding-agent/src/task/*` | `packages/swarm-extension/*` |
| 是否默认就有 | 是 | 不是，属于扩展 |
| 入口 | 主代理调用 `task` 工具 | `/swarm run xxx.yaml` 或 `omp-swarm xxx.yaml` |
| 任务拆分方式 | 运行时由主代理临时决定 | 事先在 YAML 里写死 agent 节点和依赖 |
| 依赖关系 | 通常没有显式 DAG | 明确支持 DAG |
| 更像什么 | Claude Code 风格 subagent | workflow / pipeline orchestrator |
| 适合什么 | 交互式 coding、临时分工 | 固定流程、长链路自动化 |
| 底层执行 | 原生子代理执行引擎 | 底层仍复用原生子代理执行引擎 |

最重要的一点：

**swarm-extension 底层也会复用 OMP 的子代理执行能力，但它上面再包了一层 DAG 调度。**

---

## 10. plan mode 和 swarm DAG 是什么关系

这是另一个容易混淆的点。

### 不是同一个东西

- `plan mode` 更像“分析与规划”
- `swarm DAG` 更像“可执行工作流”

### 更准确的关系

可以这么理解：

1. 先和 OMP 交互，分析问题
2. 用 plan mode 或普通对话把流程拆出来
3. 让 OMP 帮你写一个 `swarm.yaml`
4. 再运行 `/swarm run xxx.yaml` 或 `omp-swarm xxx.yaml`

所以：

- `plan mode` 不是 swarm 本身
- swarm 也不是自动从 plan mode 直接启动
- 二者可以串联，但不是同一个层次

### 一句话区分

- `plan mode`：我们该怎么做？
- `swarm DAG`：就按这个图去跑。

---

## 11. 我自己的心智模型

我现在会这样记：

### 第一层：对话分析层
- 普通对话
- plan mode
- 任务分析
- 方案设计

### 第二层：动态委派层
- `task`
- subagents
- explore / plan / task / reviewer

### 第三层：工作流编排层
- `swarm.yaml`
- DAG
- waves
- pipeline controller

也就是：

- 对话层负责“想清楚”
- delegation 层负责“临时分工”
- swarm 层负责“固化流程并执行”

---

## 12. 什么时候该用哪一个

### 用默认 subagent / task delegation
适合：

- 平时写代码
- 交互式查问题
- 临时并行拆几个子任务
- 让代理帮你分头调查

### 用自定义子代理
适合：

- 你已经反复做同一类事情
- 有稳定的领域规则和角色定位
- 想把某种工作方式固化为专职专家

### 用 swarm-extension
适合：

- 你已经有明确固定流程
- 需要 DAG / wave / pipeline
- 需要多阶段、长链路、可重复执行
- 希望无人值守跑完整个 workflow

---

## 13. 最后的判断

### 我的现阶段建议

如果只是学习和日常使用 Oh My Pi：

1. 先学会默认 subagent / task delegation
2. 先别急着自定义 agent
3. 更不要一开始就上 DAG swarm

因为学习顺序最好是：

- 先理解默认代理如何协作
- 再理解如何自定义角色
- 最后再理解如何把流程写成 YAML DAG

### 一句话总结

- **默认 subagent**：已经够大多数人用
- **自定义子代理**：是更进一步的角色定制
- **swarm DAG**：是更高一层的工作流编排，不是日常交互的第一入口

---

## 14. 关键源码位置备忘

### Core subagent / task delegation
- `packages/coding-agent/src/task/index.ts`
- `packages/coding-agent/src/task/executor.ts`
- `packages/coding-agent/src/task/parallel.ts`
- `packages/coding-agent/src/task/agents.ts`
- `packages/coding-agent/src/task/discovery.ts`
- `packages/coding-agent/src/discovery/helpers.ts`
- `packages/coding-agent/src/config/settings-schema.ts`

### Swarm extension / YAML DAG
- `packages/swarm-extension/README.md`
- `packages/swarm-extension/src/swarm/schema.ts`
- `packages/swarm-extension/src/swarm/dag.ts`
- `packages/swarm-extension/src/swarm/pipeline.ts`
- `packages/swarm-extension/src/swarm/executor.ts`
- `packages/swarm-extension/src/extension.ts`
- `packages/swarm-extension/src/cli.ts`

---

## 15. 适合我自己的记忆版

> OMP 有两种多代理：
>
> - 一种是像 Claude Code 一样的动态 subagent 委派
> - 一种是用 YAML 定义 DAG 的 swarm workflow
>
> 前者适合交互式 coding，后者适合固定 pipeline。
