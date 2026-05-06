---
title: OMP /compact、Responses 网关与 CLIProxyAPI 联调笔记
date: 2026-05-06
description: 梳理 OMP /compact 与 OpenAI Responses 网关、new-api distributor、CLIProxyAPI(CPA) 之间的路由关系。
categories:
  - Oh My Pi
  - Codex
  - Tooling
draft: false
---
## 1. 先说结论

这次排查最后确认的是：

1. **OMP 这边要把 gateway 配成 `openai` provider，不是 `openai-codex`**
2. **OMP 对 gateway 发 compact 时，正确外部路径是 `/v1/responses/compact`**
3. **gateway 这一层是 new-api，对外暴露的是 OpenAI Responses 风格接口**
4. **gateway 内部可以把 compact 请求继续路由到 Codex channel，再交给 CLIProxyAPI(CPA)**
5. **最开始失败不是 URL 错，而是 new-api 没有为 compact 模型提供可用 channel**
6. **修好后，compact 成功走到了 `gpt-5.4(high)-openai-compact`，并命中了 gateway 后台中的 Codex 渠道**

一句话概括整条链路：

- **OMP -> gateway `/v1/responses/compact` -> new-api distributor -> Codex channel -> CPA -> Codex compact upstream**

最容易混淆的地方在于：

- **OMP 看的是“gateway 对外暴露什么 API 形态”**
- **gateway/new-api 内部再决定转发到 OpenAI channel 还是 Codex channel**

也就是说：

- 对 OMP 来说，gateway 是 **OpenAI Responses 风格网关**
- 对 gateway 内部来说，背后那条渠道可以是 **Codex via CPA**

这两件事不冲突。

---

## 2. 这次一开始在查什么

目标本来有两件：

1. 搞清楚 CPA 的 compact 接口到底是什么
2. 把本地 OMP 配成走 gateway 的 compact 接口

排查过程中，实际上涉及了三层：

1. **OMP 本身的 compact 实现**
2. **gateway 这一层的 new-api**
3. **new-api 背后的 CLIProxyAPI / CPA**

所以要搞清楚的问题就变成了：

- OMP 在什么条件下会走远端 compact
- OMP 会打哪个 compact URL
- gateway/new-api 对外到底暴露了什么 compact path
- new-api 内部如何选 channel
- CPA 是否真的支持 compact
- 失败时到底卡在哪一层

---

## 3. OMP 里到底有哪两种“远端 compact”

OMP 实际上有两条不同的 compact 路：

### 3.1 通用 `compaction.remoteEndpoint`

代码在：

- `packages/coding-agent/src/session/compaction/compaction.ts:916-930`

这条路的特点是：

- 直接 `POST` 到用户配置的 endpoint
- 请求体非常简单：

```json
{
  "systemPrompt": "...",
  "prompt": "..."
}
```

- 返回必须是：

```json
{
  "summary": "..."
}
```

- **不会自动带 Authorization**

所以它更像一个“自定义摘要服务接口”，不是 OpenAI/Codex 原生 compact 接口。

### 3.2 OpenAI / Codex 原生 remote compact

代码在：

- `packages/coding-agent/src/session/compaction/compaction.ts:515-536`
- `packages/coding-agent/src/session/compaction/compaction.ts:1241-1258`

OMP 只有在下面这个条件成立时，才会走这条“原生 remote compact”分支：

```ts
function shouldUseOpenAiRemoteCompaction(model: Model): boolean {
  return model.provider === "openai" || model.provider === "openai-codex";
}
```

也就是说，决定 compact 路由的关键不是 `api: openai-responses`，而是：

- `model.provider === "openai"`
- 或 `model.provider === "openai-codex"`

这一点后面非常关键。

---

## 4. OMP 为什么把 gateway 改成 `openai` 就能工作

一开始最容易误解的是：

- gateway 背后既然是 Codex via CPA
- 那 OMP 也应该配成 `openai-codex`

但这其实是不对的。

### 4.1 OMP 的 provider 决定的是“它怎么访问外部网关”

OMP 里 custom provider 的名字会直接变成模型的 `provider` 字段。

代码在：

- `packages/coding-agent/src/config/model-registry.ts:673-676`

```ts
return {
  id: modelDef.id,
  provider: providerName,
  api,
  ...
}
```

所以如果配置写成：

```yml
providers:
  gateway-openai:
```

那这个模型的 `provider` 就真的是：

- `gateway-openai`

这会导致一个后果：

- 普通 `openai-responses` 请求可能能工作
- 但 `/compact` 不会进入 OMP 的 OpenAI/Codex 原生 compact 分支

因为 OMP 只认：

- `openai`
- `openai-codex`

不认任意自定义 provider 名。

### 4.2 为什么不能改成 `openai-codex`

如果 OMP 模型的 `provider` 是 `openai-codex`，compact endpoint 会按 Codex 规则拼。

代码在：

- `packages/coding-agent/src/session/compaction/compaction.ts:519-536`

```ts
if (model.provider === "openai-codex") {
  return resolveOpenAiCodexCompactEndpoint(model.baseUrl);
}
```

其中 Codex compact endpoint 的规则是：

```ts
if (/\/codex(?:\/v\d+)?$/.test(normalizedBase)) return `${normalizedBase}/responses/compact`;
return `${normalizedBase}/codex/responses/compact`;
```

也就是 OMP 会去打：

- `/codex/responses/compact`

同时它还会额外加 Codex 专用 headers：

- `openai-beta`
- `originator`
- 可能还有 account id

代码在：

- `packages/coding-agent/src/session/compaction/compaction.ts:856-864`

但 gateway/new-api 对 OMP 暴露出来的外部入口并不是 Codex 风格，而是：

- `/v1/responses/compact`

所以如果 OMP 配成 `openai-codex`，它访问 gateway 的外部 URL 形态就会错。

### 4.3 为什么改成 `openai` 正好匹配 gateway

如果 `provider === "openai"`，OMP 会把 compact endpoint 拼成：

- `/v1/responses/compact`

代码在：

- `packages/coding-agent/src/session/compaction/compaction.ts:524-528`

```ts
const rawBase = model.baseUrl && model.baseUrl.length > 0 ? model.baseUrl : defaultBase;
const normalizedBase = rawBase.endsWith("/") ? rawBase.slice(0, -1) : rawBase;
if (normalizedBase.endsWith("/v1")) return `${normalizedBase}/responses/compact`;
return `${normalizedBase}/v1/responses/compact`;
```

这和 gateway/new-api 对外暴露的 compact path 正好一致。

所以最终的正确理解是：

- **OMP 配 `openai`，是为了匹配 gateway 对外的 API surface**
- **gateway 内部再把这个请求转去 Codex channel，是 gateway 的内部实现，不是 OMP 要直接面对的协议**

---

## 5. 本地 OMP 最开始是什么配置

本地最开始的配置是：

### `~/.omp/agent/config.yml`

- `modelRoles.default = gateway-openai/gpt-5.4(high)`
- `modelRoles.slow = gateway-openai/gpt-5.4(xhigh)`

### `~/.omp/agent/models.yml`

- provider 名叫 `gateway-openai`
- `baseUrl = https://your-gateway.example.com/v1`
- `api = openai-responses`

也就是说，最开始 gateway 只是被当成一个自定义 OpenAI Responses provider 来用。

普通请求没问题，但 compact 的路由条件并不满足。

后来改成了：

### `~/.omp/agent/models.yml`

把 provider 名从：

- `gateway-openai`

改成：

- `openai`

保留：

- `baseUrl: https://your-gateway.example.com/v1`
- `api: openai-responses`
- 现有模型列表 `gpt-5.4 / gpt-5.4(high) / gpt-5.4(xhigh)`

### `~/.omp/agent/config.yml`

把角色切到：

- `default: openai/gpt-5.4(high)`
- `slow: openai/gpt-5.4(xhigh)`

这样 OMP 才会把 gateway 识别为“OpenAI remote compact provider”。

---

## 6. 一开始为什么失败：不是 URL 错，而是 new-api 选不到 compact 渠道

改完 OMP 配置后，第一次手动 `/compact` 失败了。

OMP 本地日志：

- `~/.omp/logs/omp.2026-04-14.log:33-36`

关键信息是：

```json
{
  "message": "OpenAI remote compaction failed",
  "endpoint": "https://your-gateway.example.com/v1/responses/compact",
  "status": 503,
  "errorText": "{\"error\":{\"code\":\"model_not_found\",\"message\":\"No available channel for model gpt-5.4(high)-openai-compact under group svip (distributor) ...\"}}"
}
```

以及：

```json
{
  "message": "OpenAI remote compaction failed, falling back to local summarization"
}
```

这条错误很关键，因为它告诉我们：

1. OMP 的 compact URL 已经是：
   - `https://your-gateway.example.com/v1/responses/compact`
2. 这个 URL 不是 404，而是进入了 compact 业务逻辑
3. new-api 在 distributor 阶段把模型看成了：
   - `gpt-5.4(high)-openai-compact`
4. 失败点是：
   - `svip` 组下没有这个 compact 模型的可用 channel

也就是说，失败不是卡在 OMP，也不是卡在 URL 拼接；而是卡在 gateway/new-api 的渠道选择阶段。

---

## 7. 为什么 new-api 会把 compact 请求改成 `-openai-compact`

为了确认这是不是 new-api 的设计，而不是线上实例自己的奇怪逻辑，我去看了 new-api 最新源码。

本地 `local-new-api-worktree` 的工作树分叉严重，而且有未提交改动，所以没有直接改它；而是：

- `git fetch` 后用 `git worktree` 建了一个只读工作树
- 路径：`new-api-upstream-worktree`

### 7.1 最新 new-api 已经原生支持 `/v1/responses/compact`

路由在：

- `new-api-upstream-worktree/router/relay-router.go:101-105`

```go
httpRouter.POST("/responses", func(c *gin.Context) {
  controller.Relay(c, types.RelayFormatOpenAIResponses)
})
httpRouter.POST("/responses/compact", func(c *gin.Context) {
  controller.Relay(c, types.RelayFormatOpenAIResponsesCompaction)
})
```

### 7.2 它在 distributor 里会给 compact 模型自动加后缀

代码在：

- `new-api-upstream-worktree/middleware/distributor.go:339-340`

```go
if strings.HasPrefix(c.Request.URL.Path, "/v1/responses/compact") && modelRequest.Model != "" {
  modelRequest.Model = ratio_setting.WithCompactModelSuffix(modelRequest.Model)
}
```

compact suffix 定义在：

- `new-api-upstream-worktree/setting/ratio_setting/compact_suffix.go:5-12`

```go
const CompactModelSuffix = "-openai-compact"

func WithCompactModelSuffix(modelName string) string {
  if strings.HasSuffix(modelName, CompactModelSuffix) {
    return modelName
  }
  return modelName + CompactModelSuffix
}
```

所以在 new-api 看来：

- 普通 `/v1/responses` 请求模型可能是 `gpt-5.4(high)`
- `/v1/responses/compact` 请求模型会先变成 `gpt-5.4(high)-openai-compact`

这和日志里的报错完全一致。

### 7.3 选到 channel 后，它又会把后缀去掉再做映射/转发

代码在：

- `new-api-upstream-worktree/relay/helper/model_mapped.go:21-25`
- `new-api-upstream-worktree/relay/helper/model_mapped.go:69-79`

这段逻辑的意思是：

- 选 channel 时需要 compact-suffixed model
- 但真正发给上游时，会把 `-openai-compact` 去掉
- 如果配置了 `model_mapping`，mapping 也是针对去掉后缀后的模型名做的

所以它的设计其实是：

- **suffix 用来做“渠道选择”**
- **unsuffixed model 用来做“上游模型映射/转发”**

---

## 8. 最新 CLIProxyAPI / CPA 对 compact 做了什么

一开始查 CPA 时，本地那份源码里没看到 compact 路由；后来拉了最新 main 才看到 compact 支持已经补上了。

### 8.1 CPA 最新版公开暴露了 `/v1/responses/compact`

代码在：

- `CLIProxyAPI-source-tree/internal/api/server.go:342-344`

```go
v1.GET("/responses", openaiResponsesHandlers.ResponsesWebsocket)
v1.POST("/responses", openaiResponsesHandlers.Responses)
v1.POST("/responses/compact", openaiResponsesHandlers.Compact)
```

对应 handler 在：

- `CLIProxyAPI-source-tree/sdk/api/handlers/openai/openai_responses_handlers.go:268-300`

它会把 compact 请求以 `alt = "responses/compact"` 交给执行器。

### 8.2 CPA 内部会根据执行器类型继续转发 compact

#### Codex executor

代码在：

- `CLIProxyAPI-source-tree/internal/runtime/executor/codex_executor.go:235-268`

最终 URL：

```go
url := strings.TrimSuffix(baseURL, "/") + "/responses/compact"
```

#### OpenAI-compat executor

代码在：

- `CLIProxyAPI-source-tree/internal/runtime/executor/openai_compat_executor.go:84-105`

compact 情况下 endpoint 会改成：

- `/responses/compact`

所以对 CPA 来说，compact 也已经是一级公民了，不再只是普通 `/responses`。

---

## 9. 这次为什么最后可以确定“外部 URL 是对的”

有三层证据：

### 9.1 OMP 源码本身

如果 provider 是 `openai`，OMP 就会打：

- `/v1/responses/compact`

如果 provider 是 `openai-codex`，OMP 才会打：

- `/codex/responses/compact`

### 9.2 live endpoint 探测

直接测过 gateway：

- `POST /v1/responses/compact`：存在，会返回未提供令牌/鉴权错误
- `POST /v1/codex/responses/compact`：返回 invalid URL / 不存在

这说明 gateway 暴露给客户端的 compact surface 就是 OpenAI 风格，而不是 Codex 风格。

### 9.3 new-api 后台与 OMP 失败日志

失败日志不是 404，而是：

- `No available channel for model gpt-5.4(high)-openai-compact under group svip`

这表明：

- 路由已经进入 compact 业务逻辑
- 不是 path 错
- 是 new-api distributor 选路失败

---

## 10. 当时到底怎么修好的

最终修复的关键点不是 OMP，而是 gateway/new-api 的 channel 配置。

### 10.1 当时缺的是什么

根据失败日志，缺的是：

- `svip` 组下，没有可用于 compact 的 model entry

因为 new-api 对 compact 的选路模型名是：

- `gpt-5.4(high)-openai-compact`

所以如果 channel 的 `Models` 里只有：

- `gpt-5.4(high)`

那普通请求可以走通，但 compact 选不到 channel。

### 10.2 修复思路

在 gateway/new-api 后台，把那条指向 CPA 的 channel 补齐：

1. **Group** 必须包含：
   - `svip`

2. **Models** 至少要包含 compact 版本：
   - `gpt-5.4(high)-openai-compact`

通常也会一起保留普通模型：

- `gpt-5.4(high)`
- `gpt-5.4(high)-openai-compact`

如果还需要 `xhigh`，同理补：

- `gpt-5.4(xhigh)`
- `gpt-5.4(xhigh)-openai-compact`

3. 这条 channel 的类型确认是：
   - **Codex**

4. 这条 channel 的下游是：
   - **CLIProxyAPI / CPA**

也就是说，gateway/new-api 内部最终确实是把 compact 请求打给了“Codex via CPA”渠道。

---

## 11. 修好后是怎么确认成功的

最终的成功证据不是 OMP 本地日志，而是 gateway/new-api 后台截图。

后台里能看到两条关键记录：

1. 普通请求：
   - 模型：`gpt-5.4(high)`

2. compact 请求：
   - 时间：`2026-04-14 12:35:40`
   - 分组：`svip`
   - 模型：`gpt-5.4(high)-openai-compact`
   - 渠道：`114`
   - 非流式
   - 耗时约 `38s`

而且你确认：

- **渠道 114 就是 gateway 中那条 Codex -> CPA 的渠道**

所以这条证据链已经足够完整：

- OMP 的 `/compact` 请求到了 gateway/new-api
- new-api 按 compact 逻辑把模型改成 `-openai-compact`
- new-api distributor 成功选到了 channel 114
- channel 114 就是背后的 Codex via CPA 渠道
- 因此 compact 实际已经成功走过：
  - new-api
  - CPA
  - Codex 链路

---

## 12. 为什么 OMP 本地日志没有“成功记录”

这个点中间也容易误会。

不是 OMP 没成功，而是 **OMP 当前实现根本不记 remote compact success 日志**。

查看代码：

- `packages/coding-agent/src/session/compaction/compaction.ts:872-880`
  - 失败时会记：`OpenAI remote compaction failed`
- `packages/coding-agent/src/session/compaction/compaction.ts:894-906`
  - 响应缺少 compact item 时会记：`Remote compaction response missing compaction item`
- `packages/coding-agent/src/session/compaction/compaction.ts:1259-1264`
  - 失败回退本地摘要时会记：`OpenAI remote compaction failed, falling back to local summarization`

但成功路径是：

- 解析成功后直接返回
- 没有 `logger.info("remote compaction succeeded")` 之类的日志

所以表现就是：

- **失败时：OMP 日志很明显**
- **成功时：OMP 日志可能什么都没有**

因此，这次最终的成功证据主要来自：

- gateway/new-api 后台中的 compact 模型调用记录

而不是 OMP 本地日志。

---

## 13. 如果以后要直连 CPA，OMP 应该怎么配

这个问题后来也顺手理清了。

如果以后不走 gateway/new-api，而是让 OMP 直接打 CPA：

- **还是配 `openai` + `api: openai-responses`**
- **不是 `openai-codex`**

原因也一样：

- CPA 对外公开暴露的是：
  - `/v1/responses`
  - `/v1/responses/compact`
- 不是：
  - `/v1/codex/responses/compact`

也就是说：

- 客户端面对 CPA 时，看到的仍然是 **OpenAI Responses 风格入口**
- CPA 内部可以再决定走 Codex executor 还是别的 executor

所以无论是：

- OMP -> gateway(new-api)

还是：

- OMP -> CPA

只要对外暴露给 OMP 的接口是：

- `/v1/responses`
- `/v1/responses/compact`

那 OMP 就应该配：

- `provider = openai`
- `api = openai-responses`

只有当外部接口本身真的是 Codex 风格，例如对外直接暴露：

- `/codex/responses`
- `/codex/responses/compact`

才应该把 OMP 配成 `openai-codex`。

### 13.1 再换一个角度看：Codex 其实有两套相关 surface

如果换成 Codex CLI 自己的视角，这件事会更好理解。

#### 13.1.1 官方 ChatGPT / Codex cloud surface

当 Codex CLI 走 GPT Sub / OAuth，直接连 OpenAI 官方云端时，接口更接近：

- `https://chatgpt.com/backend-api/codex/responses`
- `https://chatgpt.com/backend-api/codex/responses/compact`

这可以理解成官方 Codex cloud 那套接口形态。

#### 13.1.2 自定义 Responses provider surface

而当 Codex CLI 不走官方云端，而是连一个自定义的 Responses provider 时，它面对的是：

- `/v1/responses`
- `/v1/responses/compact`

这就是更通用的 OpenAI Responses 风格 surface。

这样再看 CPA，就很容易理解：

- CPA 对外刚好实现的是第二套 surface
- 所以它可以被 OMP 或 Codex CLI 当成“自定义 Responses provider”
- 但 CPA 内部仍然可以把请求继续转发到 Codex executor，最终落到官方 Codex compact 能力

所以这次链路里：

- OMP 面对的是 CPA/gateway 暴露的“自定义 Responses provider surface”
- 而不是直接面对官方 ChatGPT/Codex cloud surface


---

## 14. 这次最重要的几个认知点

我觉得这次最值得记住的不是某个具体路径，而是下面这几个分层原则。

### 14.1 不要把“外部协议”和“内部执行器”混为一谈

- OMP 只关心 gateway/CPA 对外暴露什么协议
- gateway/new-api 内部再决定转到 OpenAI channel 还是 Codex channel

### 14.2 OMP 的 compact 分支判断依赖 `provider`，不是 `api`

- `api: openai-responses` 只说明请求格式
- `provider: openai` / `openai-codex` 才决定 compact special-case 走法

### 14.3 new-api 的 compact 选路不是拿原模型名，而是拿 `-openai-compact` 后缀模型名

所以以后凡是 new-api 上 compact 选不到渠道，都要先看：

- group 对不对
- channel 是否 enabled
- `Models` 里有没有 `xxx-openai-compact`

### 14.4 失败日志的模型名非常有信息量

这次错误里出现：

- `gpt-5.4(high)-openai-compact`

实际上已经把问题层级暴露得很清楚了：

- 不是 OMP path 拼错
- 不是 compact 根本没进来
- 是 new-api distributor 在 compact 选路阶段就挂了

这类错误以后可以直接顺着模型名看。

---

## 15. 最后用一句最短的话总结这次问题

这次问题本质上不是“OMP 会不会发 compact”，也不是“CPA 支不支持 compact”，而是：

- **OMP 已经正确发到了 gateway 的 `/v1/responses/compact`**
- **gateway/new-api 也确实支持 compact**
- **真正缺的是 new-api 中 compact 模型 `*-openai-compact` 的 channel 可用性配置**

补齐这层后，整条链路就通了：

- **OMP -> gateway(new-api) OpenAI Responses compact -> Codex channel -> CPA -> Codex compact upstream**
