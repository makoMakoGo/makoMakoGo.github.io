---
title: "Factory Droid BYOK 接 sub2api：给 GPT-5.5 / GPT-5.4 配三挡思考强度"
date: 2026-05-16
description: "记录 Factory Droid BYOK 通过 sub2api 接入 GPT-5.5 / GPT-5.4，并用 extraArgs.reasoning.effort 固定 medium、high、xhigh 三挡思考强度。"
categories:
  - AI Agent
  - Tooling
  - OpenAI
  - sub2api
  - Factory Droid
draft: false
---

这篇记录一次 Factory Droid BYOK 接 sub2api 的配置：目标不是只把模型跑通，而是让 Droid 里可以直接选择 GPT-5.5 / GPT-5.4 的三挡思考强度。

最终在 Droid 里会出现 6 个自定义模型：

```text
custom:gpt-5.5-medium-sub2api-pro   GPT-5.5 medium [sub2api pro]
custom:gpt-5.5-high-sub2api-pro     GPT-5.5 high [sub2api pro]
custom:gpt-5.5-xhigh-sub2api-pro    GPT-5.5 xhigh [sub2api pro]
custom:gpt-5.4-medium-sub2api-pro   GPT-5.4 medium [sub2api pro]
custom:gpt-5.4-high-sub2api-pro     GPT-5.4 high [sub2api pro]
custom:gpt-5.4-xhigh-sub2api-pro    GPT-5.4 xhigh [sub2api pro]
```

## TL;DR

- Droid BYOK 配置在 `~/.factory/settings.json` 的 `customModels` 数组。
- GPT-5.5 / GPT-5.4 这类模型应使用 `provider: "openai"`，让 Droid 走 OpenAI Responses API。
- 对 BYOK custom model，不能只依赖 Droid 的 `--reasoning-effort` 或 `sessionDefaultSettings.reasoningEffort`。
- sub2api `/v1/responses` 场景下，最稳的是在请求体里显式传 `reasoning.effort`。
- Droid BYOK 可以通过 `extraArgs` 把这个字段塞进请求体。
- 想在 Droid 模型选择器里切三挡思考，最干净的做法是为每个「模型 + 思考档位」建一个 custom model。

## Droid BYOK 的配置位置

Factory Droid 的 BYOK 配置文件是：

```text
~/.factory/settings.json
```

自定义模型放在 `customModels` 数组里。基本形态是：

```json
{
  "customModels": [
    {
      "model": "your-model-id",
      "displayName": "My Custom Model",
      "baseUrl": "https://api.provider.com/v1",
      "apiKey": "${PROVIDER_API_KEY}",
      "provider": "openai",
      "maxOutputTokens": 16384
    }
  ]
}
```

这里几个字段要分清楚：

| 字段 | 含义 |
| --- | --- |
| `model` | 真正发给上游 API 的模型名 |
| `id` | Droid 内部选择这个 custom model 时使用的 ID |
| `displayName` | Droid 模型选择器里显示的名字 |
| `baseUrl` | OpenAI-compatible API 地址，通常带 `/v1` |
| `apiKey` | Provider API key，建议用环境变量引用 |
| `provider` | API 格式；GPT-5 系列建议用 `openai` |
| `maxOutputTokens` | 最大输出 token |
| `extraHeaders` | 额外 HTTP 请求头 |
| `extraArgs` | 额外请求体字段 |

## 关键坑：Droid 的 reasoningEffort 不等于上游一定收到 reasoning.effort

Droid CLI 有参数：

```bash
droid exec \
  --model custom:gpt-5.5-sub2api-pro \
  --reasoning-effort xhigh \
  "..."
```

配置文件里也可以写：

```json
{
  "sessionDefaultSettings": {
    "model": "custom:gpt-5.5-sub2api-pro",
    "reasoningEffort": "xhigh"
  }
}
```

但在 BYOK custom model 场景里，这不等价于上游 `/v1/responses` 请求体里一定有：

```json
{
  "reasoning": {
    "effort": "xhigh"
  }
}
```

我用本地 capture server 看过 Droid 发给 custom `provider: "openai"` 的 `/v1/responses` body：指定 `--reasoning-effort high` 时，请求体里没有 `reasoning`，也没有 `reasoning_effort`。

所以，如果要让 sub2api 稳定收到思考强度，不要把 `--reasoning-effort` 当作唯一控制面。

## sub2api 稳定识别的是显式 reasoning.effort

对 OpenAI Responses API，sub2api 能稳定识别的是：

```json
{
  "reasoning": {
    "effort": "xhigh"
  }
}
```

支持的档位包括：

```text
low
medium
high
xhigh
```

本次需要的是三挡：

```text
medium
high
xhigh
```

直接请求 sub2api `/v1/responses` 实测，显式传 `reasoning.effort` 时，返回里的 `reasoning.effort` 会匹配请求值：

| 请求模型 | 请求 effort | 返回 effort |
| --- | --- | --- |
| `gpt-5.5` | `medium` | `medium` |
| `gpt-5.5` | `high` | `high` |
| `gpt-5.5` | `xhigh` | `xhigh` |
| `gpt-5.4` | `medium` | `medium` |
| `gpt-5.4` | `high` | `high` |
| `gpt-5.4` | `xhigh` | `xhigh` |

## 不建议靠模型名后缀表达思考强度

容易想到的办法是把 effort 写进模型名：

```text
gpt-5.5-xhigh
gpt-5.5:xhigh
gpt-5.5(xhigh)
gpt-5.5_xhigh
```

这不够稳。

sub2api 内部确实有一些模型名归一化和 effort 派生逻辑，尤其是 OpenAI-compatible、Anthropic bridge、usage log 等路径。但在当前 Droid BYOK + OpenAI Responses API 的使用方式下，直接依赖模型名后缀不如显式请求体字段可靠。

更清晰的模型表达是：

```json
"model": "gpt-5.5"
```

然后把思考强度放在标准 Responses 字段里：

```json
"reasoning": {
  "effort": "xhigh"
}
```

Droid BYOK 里对应就是：

```json
"extraArgs": {
  "reasoning": {
    "effort": "xhigh"
  }
}
```

## 最终配置

下面是脱敏后的 `~/.factory/settings.json` 示例。`apiKey` 建议使用环境变量，不要把真实 key 写进仓库。

```json
{
  "customModels": [
    {
      "model": "gpt-5.5",
      "baseUrl": "https://your-sub2api.example.com/v1",
      "apiKey": "${SUB2API_API_KEY}",
      "maxOutputTokens": 128000,
      "extraHeaders": {
        "User-Agent": "codex_vscode/0.128.0-alpha.1"
      },
      "noImageSupport": false,
      "id": "custom:gpt-5.5-medium-sub2api-pro",
      "index": 0,
      "displayName": "GPT-5.5 medium [sub2api pro]",
      "extraArgs": {
        "reasoning": {
          "effort": "medium"
        }
      },
      "provider": "openai"
    },
    {
      "model": "gpt-5.5",
      "baseUrl": "https://your-sub2api.example.com/v1",
      "apiKey": "${SUB2API_API_KEY}",
      "maxOutputTokens": 128000,
      "extraHeaders": {
        "User-Agent": "codex_vscode/0.128.0-alpha.1"
      },
      "noImageSupport": false,
      "id": "custom:gpt-5.5-high-sub2api-pro",
      "index": 1,
      "displayName": "GPT-5.5 high [sub2api pro]",
      "extraArgs": {
        "reasoning": {
          "effort": "high"
        }
      },
      "provider": "openai"
    },
    {
      "model": "gpt-5.5",
      "baseUrl": "https://your-sub2api.example.com/v1",
      "apiKey": "${SUB2API_API_KEY}",
      "maxOutputTokens": 128000,
      "extraHeaders": {
        "User-Agent": "codex_vscode/0.128.0-alpha.1"
      },
      "noImageSupport": false,
      "id": "custom:gpt-5.5-xhigh-sub2api-pro",
      "index": 2,
      "displayName": "GPT-5.5 xhigh [sub2api pro]",
      "extraArgs": {
        "reasoning": {
          "effort": "xhigh"
        }
      },
      "provider": "openai"
    },
    {
      "model": "gpt-5.4",
      "baseUrl": "https://your-sub2api.example.com/v1",
      "apiKey": "${SUB2API_API_KEY}",
      "maxOutputTokens": 128000,
      "extraHeaders": {
        "User-Agent": "codex_vscode/0.128.0-alpha.1"
      },
      "noImageSupport": false,
      "id": "custom:gpt-5.4-medium-sub2api-pro",
      "index": 3,
      "displayName": "GPT-5.4 medium [sub2api pro]",
      "extraArgs": {
        "reasoning": {
          "effort": "medium"
        }
      },
      "provider": "openai"
    },
    {
      "model": "gpt-5.4",
      "baseUrl": "https://your-sub2api.example.com/v1",
      "apiKey": "${SUB2API_API_KEY}",
      "maxOutputTokens": 128000,
      "extraHeaders": {
        "User-Agent": "codex_vscode/0.128.0-alpha.1"
      },
      "noImageSupport": false,
      "id": "custom:gpt-5.4-high-sub2api-pro",
      "index": 4,
      "displayName": "GPT-5.4 high [sub2api pro]",
      "extraArgs": {
        "reasoning": {
          "effort": "high"
        }
      },
      "provider": "openai"
    },
    {
      "model": "gpt-5.4",
      "baseUrl": "https://your-sub2api.example.com/v1",
      "apiKey": "${SUB2API_API_KEY}",
      "maxOutputTokens": 128000,
      "extraHeaders": {
        "User-Agent": "codex_vscode/0.128.0-alpha.1"
      },
      "noImageSupport": false,
      "id": "custom:gpt-5.4-xhigh-sub2api-pro",
      "index": 5,
      "displayName": "GPT-5.4 xhigh [sub2api pro]",
      "extraArgs": {
        "reasoning": {
          "effort": "xhigh"
        }
      },
      "provider": "openai"
    }
  ],
  "sessionDefaultSettings": {
    "model": "custom:gpt-5.5-xhigh-sub2api-pro",
    "reasoningEffort": "xhigh"
  }
}
```

## 验证 Droid 是否加载到模型

运行：

```bash
droid exec --help
```

在输出里应该能看到：

```text
Custom Models:
  custom:gpt-5.5-medium-sub2api-pro   GPT-5.5 medium [sub2api pro]
  custom:gpt-5.5-high-sub2api-pro     GPT-5.5 high [sub2api pro]
  custom:gpt-5.5-xhigh-sub2api-pro    GPT-5.5 xhigh [sub2api pro]
  custom:gpt-5.4-medium-sub2api-pro   GPT-5.4 medium [sub2api pro]
  custom:gpt-5.4-high-sub2api-pro     GPT-5.4 high [sub2api pro]
  custom:gpt-5.4-xhigh-sub2api-pro    GPT-5.4 xhigh [sub2api pro]
```

然后逐个 smoke test：

```bash
droid exec \
  --model custom:gpt-5.5-medium-sub2api-pro \
  --output-format json \
  'Reply exactly: OK'
```

```bash
droid exec \
  --model custom:gpt-5.5-high-sub2api-pro \
  --output-format json \
  'Reply exactly: OK'
```

```bash
droid exec \
  --model custom:gpt-5.5-xhigh-sub2api-pro \
  --output-format json \
  'Reply exactly: OK'
```

GPT-5.4 的三档同理。

成功时会返回类似：

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "result": "OK"
}
```

对于 high / xhigh，usage 里通常还能看到 `thinking_tokens`，例如：

```json
{
  "thinking_tokens": 58
}
```

## 排查顺序

如果配置后模型不可用，按这个顺序查：

1. `~/.factory/settings.json` 是否是合法 JSON。
2. `customModels` 条目是否都有 `model`、`baseUrl`、`apiKey`、`provider`。
3. `baseUrl` 是否带 `/v1`，并且最终能访问 `/v1/responses`。
4. `provider` 是否是 `openai`，不是 `generic-chat-completion-api`。
5. `extraArgs.reasoning.effort` 是否拼写为 `medium` / `high` / `xhigh`。
6. `extraHeaders.User-Agent` 是否保留了当前 sub2api 通道需要的值。
7. sub2api 后台是否允许对应模型和 Responses 路径。

## 结论

Droid BYOK 接 sub2api 时，模型能跑通只是第一步。真正要控制 GPT-5.5 / GPT-5.4 的思考强度，应该把 effort 放进 OpenAI Responses 的标准字段：

```json
"reasoning": {
  "effort": "xhigh"
}
```

在 Droid BYOK 里，对应写法是：

```json
"extraArgs": {
  "reasoning": {
    "effort": "xhigh"
  }
}
```

如果希望在 Droid 里直接切换三挡思考强度，就为每个「模型 + 档位」建一个 custom model。这样模型选择器就是最终的控制面，不需要每次记 CLI 参数，也不会依赖 custom model 对 `--reasoning-effort` 的内部转发行为。
