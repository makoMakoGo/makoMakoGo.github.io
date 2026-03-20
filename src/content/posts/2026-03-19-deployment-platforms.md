---
title: 现代应用部署：从容器到边缘函数
date: 2026-03-19
description: Docker、Vercel、Netlify、Render、Railway、Cloudflare Workers、Deno Deploy——这些部署技术各自解决什么问题，怎么选。
categories:
  - 运维
  - 开发
draft: false
---

## 先搞清楚几个基本概念

在看具体平台之前，有必要先把背后的技术范式理清楚，否则每个平台的优缺点会显得很随机。

### IaaS、PaaS、SaaS 是什么关系

云计算的服务模型本质上是一条"控制权 vs 便利性"的光谱：

- **IaaS**（基础设施即服务）：云厂商提供虚拟机、网络、存储，你负责从操作系统往上的所有东西。自由度最高，但要操心的也最多。
- **PaaS**：在 IaaS 之上再抽象一层，操作系统、运行时、中间件都由平台管，你只管写代码。本文讨论的大部分平台都归这一类。
- **SaaS**：完全不用管，打开浏览器就能用。

本文的主角——Vercel、Render、Railway、Netlify——都站在 PaaS 的位置上。Cloudflare Workers 和 Deno Deploy 则更进一步，属于 FaaS（函数即服务）/ 边缘计算。

**责任边界在哪里：**

| 管理内容 | 本地部署 | IaaS | PaaS | SaaS |
|---------|---------|------|------|------|
| 应用程序 | 你 | 你 | 你 | 厂商 |
| 数据 | 你 | 你 | 你 | 厂商 |
| 运行时 | 你 | 你 | 厂商 | 厂商 |
| 操作系统 | 你 | 你 | 厂商 | 厂商 |
| 虚拟化 | 你 | 厂商 | 厂商 | 厂商 |
| 服务器 | 你 | 厂商 | 厂商 | 厂商 |

### 容器和虚拟机的区别

这两个概念经常被混为一谈，但它们的虚拟化层次完全不同。

**虚拟机**通过 Hypervisor 虚拟化**物理硬件**。每台虚拟机都有自己的完整操作系统，隔离性好，但资源开销大——一个 VM 动辄几个 GB，启动要几分钟。

**容器**虚拟化的是**操作系统层面**。所有容器共享宿主机的操作系统内核，只打包应用代码和它的依赖项。体积小（MB 级）、启动快（秒级）、资源利用率高。

Docker 把容器的使用体验标准化了：写一个 Dockerfile 描述环境，`docker build` 打成镜像，`docker run` 启动容器。同一个镜像在开发机、测试环境、生产服务器上跑出来的结果完全一致。这就是容器最大的价值——消除了"在我机器上能跑"的问题。

从虚拟机到容器，关注点从"隔离机器"转向了"隔离应用"。正是因为容器够轻量，把一个大应用拆成多个可独立部署的微服务才变得现实。

### 边缘计算和 V8 Isolates

"边缘"指的是分布在全球各地、物理上靠近用户的服务器节点。在边缘跑代码，网络延迟天然更低。

Cloudflare Workers 和 Deno Deploy 这类边缘平台的性能关键在于 **V8 Isolates**。V8 是 Chrome 和 Node.js 底层的 JavaScript 引擎。一个 Isolate 是 V8 进程内部的一个轻量执行上下文，有自己的内存堆，但不需要启动一个完整的进程。

对比一下：

- **进程 / 容器型执行模型**：通常要拉起更完整的运行时实例，启动开销相对更高
- **V8 Isolates**：多个隔离执行上下文可以共享同一个底层进程，启动更轻，更适合短请求

代价是限制更严格。边缘函数通常有更紧的 CPU 时间、内存和状态约束，适合处理鉴权、缓存命中、轻量 API 聚合这类逻辑，不适合长时间运行的重计算任务。

## 几个主要平台对比

理清了上面这些概念，再看各个平台就清晰多了。

先给一个比“平台名气”更有用的选择框架：

1. **你的服务是不是要常驻？**
   如果需要 WebSocket、后台任务、队列消费者、长事务，优先看 Render / Railway 这类能跑常驻服务的平台。
2. **你是否想把数据库、缓存和应用放在一个平台里？**
   如果是，Render 这类全栈 PaaS 会更顺手；如果不是，前端平台 + 外部数据库也完全可以。
3. **你是否强依赖 Next.js 的平台特性？**
   如果要用 ISR、Server Actions、Edge Middleware 这些能力，而且不想折腾兼容层，Vercel 仍然是默认选项。
4. **你更在意低延迟，还是更在意预算可预测？**
   低延迟全球分发优先考虑 Cloudflare Workers / Deno Deploy；如果更在意账单稳定，按实例规格计费的平台通常更容易估算。

后文里我会尽量把“长期有效的信息”和“容易过时的信息”分开。运行模型、状态约束、适用场景相对稳定；价格、免费额度、构建时长、节点数量这类信息则要默认会变。

### Vercel：前端优先的 PaaS

Vercel 由 Next.js 背后的团队主导，和 Next.js 的集成最深。ISR（增量静态再生成）、Server Actions、Edge Middleware 这些能力在 Vercel 上支持最完整，预览部署体验也最好。

但这种深度集成也意味着更强的平台绑定。项目如果大量依赖 Vercel 特有能力，后续迁移通常会更麻烦。

Vercel 更适合承载前端、SSR、边缘逻辑和短时函数，不适合自己托管常驻后端。Vercel Functions 有执行时间和运行模型限制，也不支持直接作为 WebSocket 服务器。如果项目需要长连接、后台进程或数据库常驻连接，通常得把这部分拆到别的平台或第三方服务上。

它的计费也更偏用量模型。对流量波动大的项目来说，预算没有实例计费那样直观。

### Netlify：框架中立的静态站点平台

Netlify 比 Vercel 更早进入 JAMstack 领域，对各种静态站点生成器的支持更均匀。Hugo、Astro、SvelteKit、Gatsby 这类项目放上去通常都比较顺手。

它有几个 Vercel 没有的实用功能：

- **内置表单处理**：静态站点不用搭后端就能接收表单提交
- **Split Testing**：原生 A/B 测试
- **Identity**：有内置认证能力，但这块产品路线近两年有过调整，正式采用前最好看最新文档

Next.js 支持方面，Netlify 主要通过 OpenNext 适配器实现，能用，但通常没有 Vercel 原生。计费方面，截至 2026 年 3 月，Netlify 已采用 credit-based plans；这类信息变化很快，最好直接看官方 pricing，而不要沿用旧的 build minutes / bandwidth 配额印象。

### Render：更适合全栈和后端服务

Render 的定位很像“现代版 Heroku”，目标是把应用、数据库、缓存、预览环境都尽量收在一个平台里。

和 Vercel 相比，Render 的优势在于它能托管更完整的后端形态：

- 长时间运行的 Web 服务
- 后台工作进程（background workers）
- 定时任务（cron jobs）
- WebSocket 长连接
- Docker 容器部署
- 托管的 PostgreSQL 和 Redis

数据库和后端服务之间可以走平台内部网络，这会比“前端平台 + 外部数据库 + 公网连接”更省心。

Render 的预览环境也更偏全栈：一次 PR 可以带出接近完整的后端环境，而不是只预览前端页面。

定价按实例规格走，对预算控制更友好。你当然还是要看具体价格表，但至少它不像纯用量计费那样容易出现“突然一波流量把账单抬上去”的情况。免费 Web 服务会休眠，这点也要提前接受。

**Render vs Vercel：**

| 特性 | Render | Vercel |
|------|--------|--------|
| 核心定位 | 全栈与后端 | 前端与边缘 |
| Docker 支持 | 支持 | 不支持 |
| WebSocket | 支持 | 不支持 |
| 后台任务 | 原生支持 | 不支持 |
| 托管数据库 | PostgreSQL、Redis | 不支持（需第三方） |
| 预览环境 | 全栈（含数据库） | 仅前端/函数 |
| 构建时长限制 | 120 分钟 | 45 分钟 |
| 定价模型 | 基于实例（可预测） | 基于用量（可能波动） |

### Railway：上手很轻快

Railway 的核心卖点是上手快。连 Git 仓库、自动识别运行时和构建命令、再一键起数据库，原型项目几分钟就能落地。

和 Render 的区别在于：

- **计费**：Railway 更偏用量计费，Render 更偏实例规格
- **免费层**：Railway 的免费额度更像试用金，Render 的免费层则更适合放低流量演示服务
- **界面**：Railway 的服务拓扑可视化做得很好，组件之间的关系一目了然

Railway 同样支持 Docker 和一键部署 PostgreSQL、Redis、MongoDB。它更适合原型、demo、side project，或者你就是想先把东西上线，再考虑后面要不要迁。

### Cloudflare Workers：边缘执行模型最成熟的一档

Cloudflare 的出发点和前面几个平台不太一样。它本来就是网络和基础设施公司，Workers 是建在这套全球网络上的开发者产品。

Workers 基于 V8 Isolates 运行，支持 JavaScript、TypeScript 和 WebAssembly。它适合拿来做鉴权、缓存、边缘 API、轻量聚合层；如果你要跑重计算、长任务、复杂状态机，就不该硬塞进去。

Cloudflare 的配套生态现在很完整：

- **KV**：全球分布的键值存储
- **D1**：基于 SQLite 的关系型数据库
- **R2**：S3 兼容的对象存储
- **Durable Objects**：有状态协调（绕过无状态限制）
- **Queues**：消息队列

如果你愿意按 Cloudflare 的平台思路来设计系统，它已经不只是“边缘脚本托管”，而是能承载相当完整的一套 Web 应用架构。

### Deno Deploy：运行时一致性更强

Deno Deploy 和 Cloudflare Workers 一样，都是全球边缘部署路线，但它强调的是“本地 Deno 运行时和云端环境尽量一致”。如果你的项目本来就用 Deno，这会比较顺。

它也提供 KV、Cron、Queues 这些原生能力，但生态规模和社区惯性仍然明显小于 Node.js / Cloudflare 这一侧。Deno 现在虽然能兼容不少 npm 模块，但你仍然要接受工具链选择更少、社区案例更少这件事。

## 怎么选

| 项目类型 | 推荐 | 关键理由 |
|---------|------|---------|
| 个人博客 / 静态站点 | GitHub Pages / Netlify | 免费、够用、不折腾 |
| Next.js 前端应用 | Vercel | 原生支持最好，预览部署体验最佳 |
| 全栈单体应用 | Render | 支持长连接、Docker、托管数据库 |
| 容器化微服务 | Render / Railway | 原生 Docker 支持 |
| 低延迟全球 API | Cloudflare Workers | 边缘执行模型成熟，适合轻量全球分发 |
| 需要后台任务 | Render | 原生后台进程和 cron |

实际上这些平台的边界越来越模糊，混合部署也越来越常见。前端放 Vercel，后端放 Render，边缘逻辑放 Cloudflare Workers，这种拆法并不奇怪。

部署策略的核心不是找一个“最好”的平台，而是先拆清楚需求：哪些部分需要常驻进程，哪些部分需要低延迟，哪些部分需要托管数据库，哪些部分要控制预算。把问题拆开之后，平台选择通常就没那么玄学了。

## 参考来源

- [Cloudflare Workers Overview](https://developers.cloudflare.com/workers/)
- [Cloudflare Workers: How Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/)
- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits)
- [Deno Deploy Docs](https://docs.deno.com/deploy)
- [Deno KV on Deploy](https://docs.deno.com/deploy/kv)
- [Deno Deploy Cron](https://docs.deno.com/deploy/reference/cron)
- [Deno Deploy Queues](https://docs.deno.com/deploy/classic/queues)
- [Vercel Functions Limits](https://vercel.com/docs/functions/limitations)
- [Vercel Limits](https://vercel.com/docs/limits)
- [Vercel Pricing](https://vercel.com/docs/pricing)
- [Netlify Functions Overview](https://docs.netlify.com/build/functions/overview/)
- [Netlify Credit-Based Pricing Plans](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/)
- [Netlify Split Testing](https://docs.netlify.com/manage/monitoring/split-testing/)
- [Netlify Identity Overview](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/overview/)
- [Render Pricing](https://render.com/pricing)
- [Render Web Services](https://render.com/docs/web-services)
- [Render Preview Environments](https://render.com/docs/preview-environments)
- [Render Build Pipeline](https://render.com/docs/build-pipeline)
