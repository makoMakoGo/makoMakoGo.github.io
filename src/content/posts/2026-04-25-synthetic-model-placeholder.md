---
title: Claude Code <synthetic> 模型名占位符
date: 2026-04-25
description: 解释 Claude Code 会话日志里的 <synthetic> 模型记录为何出现，以及它与请求失败、限速和上下文溢出的关系。
categories:
  - Tooling
draft: false
---

## TL;DR

`<synthetic>` 不是 Anthropic 的真实模型名，也不是第三方 Synthetic 平台的调用记录。它是 Claude Code 在 API 请求失败、拿不到真实模型响应时写进会话日志的占位符。

典型触发原因包括模型不存在或无权限、429 限速、502/503 服务错误、上下文窗口溢出、网络错误，以及客户端侧的静默丢弃。对应记录里的 input/output token 都是 0，通常表示没有形成一次可计费的成功模型调用。

## 问题

运行 `tokscale` 时会发现一条不认识的模型记录：

```
│ Claude │ anthropic │ <synthetic> │ 0 │ 0 │ $0.00 │ — — │
```

Provider 显示 `anthropic`，但模型名是 `<synthetic>`，input/output token 全为 $0$。

## 结论

**`<synthetic>` 不是真实模型，是 Claude Code 在 API 请求失败时自动生成的占位记录。**

当请求出错（模型不存在、限速 429、服务不可用 503/502、上下文溢出等），客户端拿不到真实模型名，就填 `<synthetic>` 写入会话日志，附带一条错误消息。token 全为 0，没有实际调用发生。

**与第三方代理无关，与 Synthetic 平台无关。** 这是 Claude Code 自身的日志行为。

## 本地数据

扫描会话文件后，找到 **48 条** `<synthetic>` 记录，横跨 **8 个版本**（v2.1.81 ~ v2.1.119），时间跨度为 2026-03-27 ~ 2026-04-25。

触发场景：

| 场景 | 次数 |
|------|------|
| 模型不存在/无权限 | 12 |
| 503 Service Unavailable | 8 |
| 静默丢弃（No response requested） | 8 |
| 429 Rate Limit | 4 |
| 400 Bad Request | 4 |
| 502 Gateway Error | 2 |
| Context Window Overflow | 2 |
| 500 Internal Error | 2 |
| 网络错误 | 2 |
| 其他 | 4 |

最新版 v2.1.119 在调研当天凌晨仍有 9 条，均为模型不存在错误。

## 典型错误内容

```
There's an issue with the selected model (claude-sonnet-4-6). It may not exist or you may not have access to it.
API Error: 503 {"error":{"message":"Service Unavailable"}}
API Error: Request rejected (429) · Rate limit reached for requests
API Error: The model has reached its context window limit.
No response requested.
```

## 怎么解读这类记录

看到 `<synthetic>` 时，优先把它当作“失败事件”而不是“模型消费”：

1. 先看同一条日志附近的 error message，而不是模型列。
2. 如果 token 全为 0，通常不是一次成功调用。
3. 如果错误是模型不存在或无权限，检查模型名、账号权限和当前 Claude Code 版本。
4. 如果错误是 429、502、503，按限速或服务可用性问题排查。
5. 如果错误是 context window overflow，排查上下文体积和压缩策略。

这也解释了为什么 `tokscale` 这类统计工具会把它显示为 provider=`anthropic`、model=`<synthetic>`、cost=`$0.00`：工具只是忠实展示了 Claude Code 会话日志里的占位记录。

## 资料来源

- 调研日期：2026-04-25
- 依据：对本地 Claude Code 会话日志的统计扫描；本文发布版仅保留聚合统计、错误类型和公开可讨论的技术结论，不包含私有日志路径。
