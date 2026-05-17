---
title: OMP Codex 搜索后端的选择逻辑
date: 2026-05-06
description: 解释 OMP `search --provider codex` 的顶层 provider 选择、自定义 backend 精确匹配与 OAuth fallback 关系。
categories:
  - Harness
draft: false
---
## 1. 先说结论

关于 `omp search --provider codex`，先把两层选择拆开看：

1. **顶层 search provider 选择**
   - 这一层决定走 `exa`、`codex`、`brave`、`perplexity` 还是别的 provider
   - `providers.webSearch: exa` 只影响这里

2. **`codex` provider 内部 backend 选择**
   - 这一层决定 `codex` 下面到底走：
     - 官方 `openai-codex` OAuth / ChatGPT 登录 builtin search
     - 还是 `models.yml` 里声明的自定义 Responses-compatible backend

一句话概括：

- **`--provider codex` 只是在顶层选中 Codex provider**
- **它不会天然强制官方 OAuth**
- **进入 Codex provider 后，还会先尝试匹配自定义 BYOK backend，匹配不到才 fallback 到官方 OAuth**

---

## 2. 顶层 search provider 选择和 Codex 内部 backend 选择不是一回事

### 2.1 顶层 provider 选择

文件：

- `packages/coding-agent/src/web/search/provider.ts`

这里负责：

- 注册 search providers
- 处理 `providers.webSearch`
- 解析 provider chain

所以：

- `providers.webSearch: exa` 的含义是：**默认优先用 Exa 做搜索**
- 它不负责决定 `codex` provider 内部是否走自定义 Responses backend

### 2.2 Codex provider 内部 backend 选择

文件：

- `src/web/search/providers/codex.ts`

这里负责：

- 读当前请求目标模型
- 看 `models.yml` 里有没有匹配的 Responses-compatible provider
- 命中则走 BYOK
- 否则 fallback 到 `openai-codex` OAuth

当前 patch 的真实顺序是：

```ts
async function resolveCodexBackend(): Promise<CodexBackend | null> {
	const byok = await loadBYOKConfig();
	if (byok) return { type: "byok", ...byok };

	const oauth = await findCodexAuth();
	if (oauth) return { type: "oauth", ...oauth };

	return null;
}
```

也就是：

- **先 BYOK**
- **BYOK 没命中，再 OAuth fallback**

---

## 3. Codex 搜索是怎么匹配自定义 provider 的

这里不能只理解成“`models.yml` 里 provider 写了 `api: openai-responses` 就一定会被选中”。

真实逻辑分三步。

### 3.1 先确定“请求目标模型”

Codex search 会先取：

1. `PI_CODEX_WEB_SEARCH_MODEL`
2. 如果没有，再取 `~/.omp/agent/config.yml -> modelRoles.default`

也就是说，Codex search 并不是盲扫 `models.yml` 里的所有自定义 provider，而是先有一个“当前想要的目标模型”。

### 3.2 只看 Responses 类型 provider

当前代码里，只有这些 `api` 会进入 BYOK 候选集合：

```ts
const RESPONSES_APIS = new Set(["openai-responses", "openai-codex-responses"]);
```

所以：

- `api: openai-responses` 可以参与匹配
- `api: openai-codex-responses` 也可以参与匹配
- 其它非 responses 类型不会被 Codex search BYOK 逻辑选中

### 3.3 候选集合里再做精确匹配

真正的选择逻辑不是模糊匹配，而是精确匹配：

1. 如果请求模型里带 provider 前缀，`providerName` 必须完全一致
2. `models[].id` 也必须和请求 `modelId` 完全一致
3. 同时还要有可用的 `baseUrl` 和 `apiKey`

关键逻辑可以概括成：

```ts
requestedModel = PI_CODEX_WEB_SEARCH_MODEL ?? config.modelRoles.default

for each provider in models.yml:
  if provider.api not in [openai-responses, openai-codex-responses]: skip
  if requestedModel.provider exists and requestedModel.provider !== providerName: skip
  if requestedModel.modelId not in provider.models[].id: skip
  if no baseUrl or no apiKey: skip
  return this provider as BYOK backend

fallback to openai-codex OAuth
```

所以结论是：

- **先按 `api` 类型过滤**
- **再按 `providerName + modelId` 精确命中**
- **不是只要写了 responses 类型就会自动被选中**

---

## 4. 当前这份配置为什么会落到官方 OAuth builtin search

当前配置：

- `~/.omp/agent/config.yml`
  - `modelRoles.default: openai-codex/gpt-5.4:high`
- `~/.omp/agent/models.yml`
  - 自定义 provider：`codex-gateway`、`codex-proxy`
  - `api: openai-responses`
  - models 只有：
    - `gpt-5.4(high)`
    - `gpt-5.4(xhigh)`

把它代入匹配逻辑后，当前请求模型会被解析成：

- `provider = openai-codex`
- `modelId = gpt-5.4:high`

而自定义 provider 实际是：

- `providerName = codex-gateway` 或 `codex-proxy`
- `modelId = gpt-5.4(high)` 或 `gpt-5.4(xhigh)`

所以有两层都对不上：

1. **provider 名不匹配**
   - `openai-codex` != `codex-proxy`
   - `openai-codex` != `codex-gateway`

2. **model id 也不匹配**
   - `gpt-5.4:high` != `gpt-5.4(high)`

结果就是：

- `loadBYOKConfig()` 扫得到这些自定义 provider
- 但一个都命中不了
- 然后才 fallback 到 `findCodexAuth()`
- 最终走 OMP 原生官方 `openai-codex` OAuth builtin search

所以这里的关键不是“responses 类型失效了”，而是：

- **responses 类型让它有资格进入候选集合**
- **但最后是否被选中，仍然取决于 `provider + modelId` 精确匹配**

---

## 5. 实测结果

### 5.1 当前配置下，显式 `--provider codex` 会落到官方 OAuth 路径

当前 `config.yml`：

```yml
modelRoles:
  default: openai-codex/gpt-5.4:high
```

实测命令：

```bash
omp search --provider codex --compact "what is ai infra"
```

结果：

```text
Error: Codex API error (400): {"detail":"The 'gpt-5-codex-mini' model is not supported when using Codex with a ChatGPT account."}
```

这个结果说明：

- 当前这次搜索没有命中自定义 BYOK backend
- 实际落到了官方 `openai-codex` OAuth / ChatGPT 登录 builtin search 路径

### 5.2 强制指定自定义目标模型后，同一个 `--provider codex` 会走 BYOK

实测命令：

```bash
PI_CODEX_WEB_SEARCH_MODEL='codex-proxy/gpt-5.4(xhigh)' omp search --provider codex --compact "what is ai infra"
```

结果正常返回：

- `Provider: Codex`
- `Model: gpt-5.4`
- `Sources: 3`

这说明：

- 顶层 provider 仍然是 `codex`
- 但这次 Codex 内部 backend 选择命中了 `codex-proxy`
- 所以实际走的是自定义 Responses-compatible backend，而不是官方 OAuth

---

## 6. 关于 `search --provider codex` 的准确理解

可以把它理解成：

- `--provider codex` = **顶层选择 Codex 这个 search provider**
- 它不是“强制官方 OAuth”
- 它也不是“强制自定义反代”
- 进入 Codex provider 后，仍然会按内部 backend 选择逻辑继续分流

所以当前语义最准确的表述是：

1. 显式 `--provider codex`
2. 先尝试匹配 `models.yml` 里的 Responses-compatible 自定义 backend
3. 如果当前请求模型和自定义 provider / model id 对不上
4. 再 fallback 到官方 `openai-codex` OAuth builtin search

在当前这份配置下，这个结果就等价于：

- **显式 `--provider codex` 最终会走官方 OAuth builtin search**

但这是因为：

- 当前默认目标模型不匹配 `codex-proxy` / `codex-gateway`

而不是因为：

- `--provider codex` 本身天然只认官方 OAuth

---

## 7. 最后压缩成一句话

当前 OMP 的 Codex 搜索逻辑可以概括成：

- **顶层 `codex` 只是选中 Codex search provider**
- **内部先按 `modelRoles.default` / `PI_CODEX_WEB_SEARCH_MODEL` 去精确匹配 `models.yml` 里的 responses provider**
- **命中就走自定义 BYOK backend，命不中才回退到官方 `openai-codex` OAuth builtin search**
