---
title: Code Agent 联网搜索接入大合集
date: 2026-05-11
description: 梳理 Coding Agent 可接入的 Web Search、网页读取、文档检索和 MCP 方案，以及它们适合放在什么位置。
categories:
  - Vibe Coding
draft: false
---

## 0. 先把“联网搜索”拆开

给 code agent 接搜索时，最容易混在一起的其实是四类东西：

| 类型 | 解决的问题 | 典型工具 |
| --- | --- | --- |
| 通用 Web Search | 找实时网页、新闻、价格、issue、论坛讨论 | Brave、Serper、Bocha、Metaso、Kagi、SearXNG |
| Agent Search / Answer | 直接返回带来源的综合答案 | Perplexity Sonar、Tavily、Exa Answer、Anthropic / OpenAI / Gemini 内置搜索 |
| Web Fetch / Reader | 已有 URL，抽正文、转 Markdown、去噪 | Jina Reader、Firecrawl、Tavily Extract、Exa Fetch |
| Library Docs | 查库、框架、SDK、CLI 的版本化文档 | Context7、Exa code/doc search、官方 docs MCP |

这四类不要硬压成一个“搜索工具”。

- **Search** 负责找候选来源。
- **Fetch / Reader** 负责把候选网页变成可读上下文。
- **Docs MCP** 负责版本化 API 文档，不应该被普通搜索替代。
- **Answer 型搜索** 适合快速问答，但做工程决策时仍要看来源。

真正稳定的配置通常不是“只装一个最强搜索”，而是：

```text
库文档：Context7 / 官方 docs MCP
通用网页：1～2 个 Web Search provider
网页正文：1 个 Reader / Fetch provider
中文搜索：按需补中文源
内置搜索：能用就作为最后兜底或特定模型的原生能力
```

## 1. Agent 里的接入方式

### 1.1 原生内置工具

有些 CLI / API 自带搜索工具。

| 平台 | 形态 | 备注 |
| --- | --- | --- |
| Claude API / Claude Code | Anthropic web search tool | API 文档里的 `web_search_20250305` / `web_search_20260209`；新版支持 dynamic filtering，但依赖模型与平台支持。 |
| OpenAI Responses / Codex | `web_search` tool | Codex 和 Responses 路线里常见，具体可用性取决于账号、模型和宿主 CLI。 |
| Gemini CLI | `google_web_search` + `web_fetch` | Gemini CLI 文档把 search 与 fetch 分开讲，适合实时检索和 URL 深读。 |
| Kimi Code | `SearchWeb` / `FetchURL` | 配置 `services.moonshot_search` 后出现 SearchWeb，配置 `moonshot_fetch` 后 FetchURL 优先走该服务。 |
| Oh My Pi | 统一 `web_search` 工具 | OMP 下面挂一组 provider：Tavily、Perplexity、Brave、Jina、Kimi、Anthropic、Gemini、Codex、Z.AI、Exa、Kagi、SearXNG 等。 |

内置工具的优点是调用体验好，模型知道怎么用；缺点是可控性和成本边界不一定透明。尤其是官方内置搜索，经常和账号类型、模型、区域、组织开关绑定。

### 1.2 MCP Server

MCP 是现在最通用的接入层。Claude Code、Cursor、Windsurf、VS Code、Codex、OpenCode、Gemini CLI 等都在不同程度支持 MCP。

MCP 的好处是：

- 同一套 search / fetch 能给多个 code agent 用。
- 可以用环境变量管理 API key。
- 很多 server 支持 tool filtering，避免一次暴露十几个工具占上下文。
- 可用远程 HTTP MCP，也可用本地 stdio / `npx` server。

MCP 的问题是：

- 工具太多会污染 tool list。
- 有些 server 没有工具白名单，只能全量暴露。
- 远程 MCP、stdio、SSE、Streamable HTTP 的配置格式在各家客户端里并不完全一致。
- 模型未必会自然选择你期望的工具，需要 instruction 或 skill 配合。

### 1.3 Skill / CLI Wrapper

第三种方式是把搜索封成 skill 或 CLI wrapper。比如 Grok Search skill 这类方案，不是把搜索服务注册成 MCP，而是在 skill 里规定命令入口：

```bash
python scripts/groksearch_entry.py web_search --query "..."
python scripts/groksearch_entry.py web_fetch --url "..."
```

这种方式的优点是：

- 可控性强，重试、fallback、日志和输出格式都能自己管。
- 不增加 MCP tool schema 负担。
- 可以跨 Claude Code / Codex / OMP / Gemini CLI 复用，只要宿主能跑 shell。

缺点是：

- 要写清楚触发规则，否则模型可能不用。
- shell 权限和路径管理更麻烦。
- 不是所有 agent 都喜欢或允许 shell 搜索。

## 2. 通用 Web Search 服务

### 2.1 Brave Search

Brave Search API 是比较正统的 Web Search API。官方有 MCP server：`@brave/brave-search-mcp-server`。

官方 MCP server 支持：

- `brave_web_search`
- `brave_local_search`
- `brave_video_search`
- `brave_image_search`
- `brave_news_search`
- `brave_summarizer`
- `brave_place_search`
- `brave_llm_context`

Brave MCP 2.x 默认走 stdio，并支持用 `BRAVE_MCP_ENABLED_TOOLS` 做工具白名单。

```json
{
  "mcpServers": {
    "brave-search": {
      "command": "npx",
      "args": [
        "-y",
        "@brave/brave-search-mcp-server",
        "--transport",
        "stdio"
      ],
      "env": {
        "BRAVE_API_KEY": "YOUR_BRAVE_API_KEY",
        "BRAVE_MCP_ENABLED_TOOLS": "brave_web_search"
      }
    }
  }
}
```

Brave 适合做英文通用网页搜索。它的 MCP 工具面很宽，如果只是给 code agent 做网页搜索，建议先只开 `brave_web_search`。

### 2.2 Serper

Serper 是 Google SERP API，首页明确写了 “Get 2,500 free queries” 和 “No credit card required”。它返回结构化 Google 搜索结果，适合需要普通 SERP JSON 的场景。

社区 MCP：`serper-search-mcp`。

```json
{
  "mcpServers": {
    "serper-search": {
      "command": "npx",
      "args": ["-y", "serper-search-mcp"],
      "env": {
        "SERPER_API_KEY": "YOUR_SERPER_API_KEY"
      }
    }
  }
}
```

这个 MCP server 会暴露多种工具：

- `search_web`
- `search_images`
- `search_videos`
- `search_news`
- `search_shopping`

Serper 的定位很直接：Google 搜索结果 API。它不负责网页正文提取，也不是文档专用索引。

### 2.3 Exa

Exa 更像“给 agent 用的神经搜索 / 内容检索 API”。它有 hosted MCP，也有 npm server：`exa-mcp-server`。

Hosted MCP：

```json
{
  "mcpServers": {
    "exa": {
      "url": "https://mcp.exa.ai/mcp"
    }
  }
}
```

npm server：

```json
{
  "mcpServers": {
    "exa-search": {
      "command": "npx",
      "args": ["-y", "exa-mcp-server", "--tools=web_search_exa"],
      "env": {
        "EXA_API_KEY": "YOUR_EXA_API_KEY"
      }
    }
  }
}
```

Exa MCP 默认工具包括：

- `web_search_exa`
- `web_fetch_exa`

可选工具里还有 advanced search。官方 pricing 页显示：Search 是 `$7/1k requests`，Contents 是 `$1/1k pages per content type`，Answer 是 `$5/1k requests`。Exa 还提供 hosted MCP free plan，但官方文档没有把具体 hosted MCP 限流阈值公开写死；命中限制时会返回 `429`。

Exa 适合：

- docs、repo、changelog、技术网页检索
- 需要 web search + fetch 的组合
- latency-sensitive 的 agent loop

### 2.4 Tavily

Tavily 是明确面向 AI Agent 的 search / extract / map / crawl 服务。

官方文档写得比较清楚：

- Free：每月 1,000 credits，无需信用卡
- Basic Search：1 credit / request
- Advanced Search：2 credits / request
- Basic Extract：每 5 个成功 URL extraction 消耗 1 credit
- Advanced Extract：每 5 个成功 URL extraction 消耗 2 credits

Tavily MCP 支持 remote MCP 和本地 npm server。

Remote MCP：

```text
https://mcp.tavily.com/mcp/?tavilyApiKey=<your-api-key>
```

Claude Code 也可以走 OAuth：

```bash
claude mcp add tavily-remote-mcp --transport http https://mcp.tavily.com/mcp/
```

本地 server：

```json
{
  "mcpServers": {
    "tavily": {
      "command": "npx",
      "args": ["-y", "tavily-mcp"],
      "env": {
        "TAVILY_API_KEY": "YOUR_TAVILY_API_KEY"
      }
    }
  }
}
```

Tavily 适合 agent research：搜索、提取、map、crawl 是一套能力，不只是 SERP。

### 2.5 Kagi

Kagi Search API 是高质量付费搜索。官方文档写明 Search API 还处于 closed beta，需要申请；价格是 `$25 / 1000 queries`。

它适合重视搜索质量和隐私的场景，不适合作为“随手免费 fallback”。如果已经是 Kagi 用户，并且愿意付费，可以考虑接入；否则优先级不高。

### 2.6 SearXNG

SearXNG 是自托管 metasearch。它支持简单 HTTP Search API：`GET /search?q=...&format=json`。

关键注意点：

- JSON / CSV / RSS 输出格式需要在实例的 `settings.yml` 里启用。
- 很多公开实例禁用了 JSON，或者有严格限流。
- 搜索质量取决于后端 engines、代理、反爬和实例维护质量。

SearXNG 适合想要 self-hosted、可控、不依赖单一商业 API 的人，但它不是“免费无限搜索”。如果拿公共实例硬塞给 agent 高频调用，很容易不稳定。

## 3. 中文搜索服务

### 3.1 博查 Bocha

博查的定位很明确：给 AI 用的中文/全网搜索引擎。开放平台 overview 页写了“免费领取1000次调用资源包”；pricing 页写了 “Absolutely Free”、“No upfront cost. No hidden costs. 100% free to use.”，但具体商业计费规则仍应以登录后的开放平台为准。

官方 MCP：`BochaAI/bocha-search-mcp`。

Bocha MCP 提供：

- Bocha Web Search
- Bocha AI Search

官方 README 里写到，Bocha Web Search 返回网页标题、URL、摘要、网站名、图标、发布时间、图片链接等；Bocha AI Search 会额外返回天气、日历、百科、医疗、股票等结构化模态卡。

配置示例：

```json
{
  "mcpServers": {
    "bocha-search-mcp": {
      "command": "uv",
      "args": [
        "--directory",
        "/path/to/bocha-search-mcp",
        "run",
        "bocha-search-mcp"
      ],
      "env": {
        "BOCHA_API_KEY": "YOUR_BOCHA_API_KEY"
      }
    }
  }
}
```

如果主要查中文新闻、百科、实时信息、国内网页，Bocha 是值得试的中文搜索候选。

### 3.2 秘塔 Metaso

秘塔 Search API playground 显示它提供：

- 搜索：`/api/v1/search`
- 读取网页
- 问答
- MCP 协议支持
- 搜索范围、结果数量、页码、网页全文抓取等参数

公开页面没有稳定展示完整价格表。第三方资讯 AIBase 报道称秘塔搜索 API 定价为每次查询 `0.03 元人民币`，并支持网页、图片、视频、文库等多模态搜索。

秘塔适合中文搜索和问答，但免费额度不如 Bocha / Tavily / Serper 这类页面写得清楚。

### 3.3 腾讯 WebSearchMCP

Tencent/WebSearchMCP 是腾讯云联网搜索 API 的 MCP 封装。README 写明底层来自腾讯云联网搜索 API，搜索引擎来源于搜狗搜索，特点包括：

- 毫秒级响应
- 分钟级更新
- 海量资源库
- 多模态覆盖
- 自然结果检索、指定网址检索、指定时间范围检索、标准摘要、图片列表等

它适合腾讯云账号体系内的中文搜索接入。缺点是免费额度和开通门槛需要看腾讯云产品页，不如单独 API 服务直观。

## 4. Reader / Fetch / Scrape 类服务

Search 只负责“找到 URL”，但 code agent 经常真正需要的是“把页面正文读进来”。这时 Reader / Fetch / Scrape 比搜索本身更关键。

### 4.1 Jina Reader / Jina MCP

Jina Reader 的核心是：

```text
https://r.jina.ai/http://example.com
https://s.jina.ai/your search query
```

Reader 页写明：

- `r.jina.ai` 用于读取 URL 并转成 LLM-friendly Markdown
- `s.jina.ai` 用于搜索网页并返回 SERP
- `mcp.jina.ai` 可作为 MCP server 接入 LLM

官方 Jina MCP 提供很多工具，包括：

- `read_url`
- `search_web`
- `parallel_read_url`
- `parallel_search_web`
- `search_arxiv`
- `search_images`
- `sort_by_relevance`
- `classify_text`
- `extract_pdf`

Jina MCP 支持 server-side tool filtering，例如：

```json
{
  "mcpServers": {
    "jina-mcp-server": {
      "url": "https://mcp.jina.ai/v1?include_tags=search,read",
      "headers": {
        "Authorization": "Bearer ${JINA_API_KEY}"
      }
    }
  }
}
```

Jina 的优势是网页读取、批量读取、学术搜索和 rerank 能放在一套 MCP 里。缺点是工具很多，不过滤会占上下文。

### 4.2 Firecrawl

Firecrawl 是 Web data API：Search、Scrape、Crawl、Map、Interact 都在一套里。官方 MCP 支持 remote hosted URL，也支持本地 `npx -y firecrawl-mcp`。

Remote MCP：

```text
https://mcp.firecrawl.dev/{FIRECRAWL_API_KEY}/v2/mcp
```

Claude Code：

```bash
claude mcp add firecrawl --url https://mcp.firecrawl.dev/your-api-key/v2/mcp

claude mcp add firecrawl -e FIRECRAWL_API_KEY=your-api-key -- npx -y firecrawl-mcp
```

Firecrawl pricing 页写明：

- Free：500 credits，一次性，无需信用卡
- Search：2 credits / 10 results
- Scrape：1 credit / page
- Map：1 credit / call
- Interact：2 credits / browser minute

Firecrawl 适合网页抓取、动态页面、爬站、结构化抽取，不只是搜索。把它接给 code agent 时，最好想清楚是否真的需要 crawl / interact；否则工具面会偏重。

### 4.3 Tavily Extract / Map / Crawl

Tavily 也能做 Reader 类工作。Search、Extract、Map、Crawl 都有清楚的 credit 规则。相比 Firecrawl，Tavily 更偏 research workflow；Firecrawl 更偏网页抓取和动态页面处理。

## 5. Docs / Library Search

### 5.1 Context7

Context7 不是普通搜索服务，而是“当前库文档检索”。它的目标是减少模型用过期训练数据瞎写 API。

Context7 MCP 工具很简单：

- `resolve-library-id`
- `query-docs`

它适合：

- 框架 API
- SDK 用法
- CLI 配置
- 版本迁移
- 代码示例

它不适合替代新闻搜索、网页搜索、论坛搜索。

配置示例：

```bash
claude mcp add --scope user context7 -- npx -y @upstash/context7-mcp --api-key YOUR_API_KEY
```

或者远程 MCP：

```bash
claude mcp add --scope user \
  --header "CONTEXT7_API_KEY: YOUR_API_KEY" \
  --transport http \
  context7 https://mcp.context7.com/mcp
```

### 5.2 Exa 的代码 / 文档检索

Exa 官方 MCP 文档把 `web_search_exa` 和 `web_fetch_exa` 作为默认工具，也强调 coding agents 可以用它搜 docs、repos、changelogs、Stack Overflow。它更像“搜索层”，Context7 更像“文档库层”。

工程上可以这样分工：

```text
已知库 / 版本 / API：Context7
未知问题 / issue / changelog / repo 搜索：Exa / Brave / Serper
找到 URL 后读全文：Exa Fetch / Jina / Firecrawl / Tavily Extract
```

## 6. Answer 型搜索和模型内置搜索

### 6.1 Perplexity

Perplexity API Platform 提供 Sonar、Search、Agent、Embeddings 等能力。官方 overview 里给了 Search API、Agent API、带 web_search tool 的示例。

它适合让 agent 快速拿到“带来源的综合答案”。但它不是普通 SERP API；成本、模型、输出格式和引用质量都需要单独评估。

### 6.2 Anthropic Web Search

Anthropic web search tool 会让 Claude 自己决定什么时候搜索，API 执行搜索并把结果交给 Claude，最终回复带 citations。`web_search_20260209` 增加 dynamic filtering：Claude 可以在搜索结果进入上下文前写代码过滤结果，从而降低无关内容占用。

这类内置搜索的特点是：模型最会用，但可迁移性差。离开 Anthropic API 或特定 Claude Code 环境，就不能原样复用。

### 6.3 OpenAI / Codex Web Search

OpenAI Responses / Codex 也有内置 web search 路线。优点同样是模型自然会用，缺点同样是和账号、模型、CLI 实现绑得很紧。

如果你要跨多个 code agent 复用，MCP 或 CLI wrapper 比内置工具更可控。

### 6.4 Gemini Google Search

Gemini CLI 文档把 `google_web_search` 和 `web_fetch` 分开讲。这个设计很合理：先搜索，再对具体 URL 做深读。对于已经在用 Gemini CLI 的人，原生搜索就是最省心的路径。

## 7. 自托管 / 聚合 / 代理方案

### 7.1 SearXNG

SearXNG 的价值在于自托管和聚合。它可以把多个搜索引擎统一成一个 `/search?q=...&format=json` 接口。

适合：

- 想自托管
- 能维护代理和反爬
- 不想把所有搜索都绑到商业 API

不适合：

- 追求零维护
- 用公共实例高频调用
- 要稳定商业 SLA

### 7.2 自己做统一 Search Gateway

当接入的搜索源超过三四个，就会出现重复问题：

- 每个 agent 都要配一遍 key
- 每个 MCP 都暴露一堆工具
- provider 失败时模型不知道怎么换
- 费用和 quota 分散在各个地方

这时可以自己做一层 Search Gateway，统一暴露一个 OpenAI-compatible / MCP / CLI 接口，后端再接 Brave、Serper、Tavily、Bocha、Jina、Exa 等。

这种方案只有在你已经有明确痛点时才值得做。否则直接用现成 MCP 更省。

## 8. 怎么选

### 8.1 最小组合

如果只想给 code agent 补一套实用联网能力：

```text
Context7：库文档
Brave 或 Serper：通用网页搜索
Jina 或 Firecrawl：网页正文读取
```

这套组合简单、可解释、可迁移。

### 8.2 偏工程 / 代码资料

```text
Context7 + Exa + Jina
```

- Context7 查 API 文档
- Exa 搜 docs / repo / changelog / Stack Overflow
- Jina 读 URL 和做批量读取

### 8.3 偏中文

```text
Bocha + Metaso / Tencent WebSearchMCP + Jina
```

- Bocha 做中文网页和结构化模态卡
- Metaso 或腾讯云作为备选中文搜索源
- Jina / Firecrawl 负责网页正文读取

### 8.4 偏 research

```text
Tavily + Perplexity + Jina / Firecrawl
```

- Tavily 做 search / extract / map
- Perplexity 做带来源综合答案
- Jina / Firecrawl 读原文和抓动态页面

### 8.5 偏自托管

```text
SearXNG + Jina / Firecrawl + 自己的 wrapper
```

SearXNG 做搜索入口，Reader / Scraper 做正文读取，wrapper 做结果格式统一。

## 9. 配置时的几个原则

### 9.1 不要一次暴露太多工具

MCP tool schema 会占上下文。一个 server 暴露 20 个工具，模型还未开始干活就先背了一堆工具描述。

能过滤就过滤：

```json
{
  "env": {
    "BRAVE_MCP_ENABLED_TOOLS": "brave_web_search"
  }
}
```

```text
https://mcp.jina.ai/v1?include_tags=search,read
```

```text
https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa
```

### 9.2 Search 和 Fetch 分开

不要指望搜索摘要承担完整证据责任。更稳的流程是：

```text
search -> pick source URLs -> fetch/read -> synthesize -> cite
```

Search 结果只告诉你“可能相关”；Fetch 才让模型看到真实页面内容。

### 9.3 Library docs 不走普通搜索优先

库文档、SDK 参数、框架配置，优先走 Context7 或官方 docs MCP。普通网页搜索容易搜到旧教程、过时博客和复制粘贴的错答案。

### 9.4 为中文和英文分开准备源

英文技术资料：Brave、Exa、Serper、Tavily 通常够用。中文实时信息：Bocha、Metaso、腾讯 WebSearchMCP 更值得单独看。

### 9.5 免费额度不要当生产承诺

很多服务写了 free plan，但限流、刷新周期、是否需要信用卡、是否可商用并不总是清楚。博客、个人配置可以用免费额度；生产系统要按付费方案和 SLA 重新评估。

## 10. 一张表

| 服务 | 类型 | MCP / 接入 | 免费信息 | 适合场景 |
| --- | --- | --- | --- | --- |
| Context7 | Library docs | `@upstash/context7-mcp` / remote MCP | 免费 API key 可提高限流 | 库、框架、SDK、CLI 文档 |
| Brave Search | Web Search | `@brave/brave-search-mcp-server` | Free 计划可用，dashboard 为准 | 通用英文网页搜索 |
| Serper | Google SERP API | `serper-search-mcp` | 2,500 free queries，无需信用卡 | 结构化 Google 搜索结果 |
| Exa | Neural search / fetch | hosted MCP / `exa-mcp-server` | hosted MCP free plan；Search `$7/1k` | 技术资料、repo、docs、changelog |
| Tavily | Agent search / extract | remote MCP / `tavily-mcp` | 1,000 credits/月，无需信用卡 | research、搜索+提取 |
| Jina | Reader / search / rerank | `https://mcp.jina.ai/v1` | API key 可提高限流 | URL 转 Markdown、批量读取、学术搜索 |
| Firecrawl | Search / scrape / crawl | remote MCP / `firecrawl-mcp` | 500 one-time credits，无需信用卡 | 抓网页、动态页面、爬站 |
| Bocha | 中文 Web / AI Search | `BochaAI/bocha-search-mcp` | overview 写 1000 次资源包；pricing 写 free | 中文搜索、模态卡 |
| Metaso | 中文 search / fetch / Q&A | 官方 API / MCP | 第三方报道 0.03 元/次 | 中文搜索、网页读取、问答 |
| Tencent WebSearchMCP | 腾讯云中文搜索 | `Tencent/WebSearchMCP` | 以腾讯云为准 | 腾讯云体系、搜狗来源中文搜索 |
| Kagi | Premium Search API | API / community wrappers | closed beta；`$25/1000 queries` | 付费高质量搜索 |
| SearXNG | Self-hosted metasearch | HTTP API / wrappers | 自托管免费，维护成本自负 | 自托管、聚合搜索 |
| Perplexity | Answer / Search API | API / wrappers | 以 console 为准 | 带来源综合答案 |
| Anthropic Web Search | 模型内置搜索 | Claude API / Claude Code | 以 Anthropic 计费为准 | Claude 原生搜索与引用 |
| OpenAI / Codex Web Search | 模型内置搜索 | Responses / Codex | 以 OpenAI 计费为准 | Codex / Responses 原生搜索 |
| Gemini Google Search | 模型内置搜索 | Gemini CLI / API | 以 Google 账号与模型为准 | Gemini 原生搜索与 fetch |

## 11. 参考链接

- Context7: <https://github.com/upstash/context7>
- Brave Search MCP: <https://github.com/brave/brave-search-mcp-server>
- Serper: <https://serper.dev/>
- Serper MCP: <https://www.npmjs.com/package/serper-search-mcp>
- Exa MCP: <https://docs.exa.ai/reference/exa-mcp>
- Exa pricing: <https://exa.ai/pricing>
- Tavily MCP: <https://docs.tavily.com/documentation/mcp>
- Tavily credits: <https://docs.tavily.com/documentation/api-credits>
- Jina MCP: <https://github.com/jina-ai/MCP>
- Jina Reader: <https://jina.ai/reader/>
- Firecrawl MCP: <https://docs.firecrawl.dev/mcp-server>
- Firecrawl pricing: <https://www.firecrawl.dev/pricing>
- Bocha open platform: <https://open.bochaai.com/overview>
- Bocha Search MCP: <https://github.com/BochaAI/bocha-search-mcp>
- Metaso API playground: <https://metaso.cn/search-api/playground>
- Tencent WebSearchMCP: <https://github.com/Tencent/WebSearchMCP>
- Kagi Search API: <https://help.kagi.com/kagi/api/search.html>
- SearXNG Search API: <https://docs.searxng.org/dev/search_api.html>
- Perplexity API overview: <https://docs.perplexity.ai/getting-started/overview>
- Anthropic web search tool: <https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/web-search-tool>

## 12. 我的结论

给 code agent 接 Web Search，不要追求“全都装”。比较好的做法是按层次配：

1. **Docs 层**：Context7 或官方 docs MCP。
2. **Search 层**：Brave / Serper / Exa / Tavily 选一两个。
3. **Fetch 层**：Jina / Firecrawl / Tavily Extract / Exa Fetch 选一个。
4. **中文层**：需要中文实时信息时再加 Bocha / Metaso / Tencent WebSearchMCP。
5. **内置层**：Claude、Codex、Gemini、Kimi 自带的搜索能力按宿主环境使用，不要把它当跨 agent 的统一方案。

如果只想要一套不折腾的个人 code-agent 配置，我会从这个组合开始：

```text
Context7 + Brave/Serper + Jina
```

如果更偏代码资料和工程搜索：

```text
Context7 + Exa + Jina
```

如果更偏研究和实时资料：

```text
Tavily + Perplexity + Firecrawl
```

如果你关心中文搜索：

```text
Bocha + Metaso/Tencent + Jina
```

核心原则只有一个：**搜索源少而准，正文读取可靠，库文档单独走专用通道。**
