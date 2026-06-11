# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Project Overview

Personal blog site (Chinese-language) built with Astro v6. Forked from TMaize/tmaize-blog (Jekyll) and rebuilt on Astro. Deployed to GitHub Pages via GitHub Actions on push to `main`.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server at `http://127.0.0.1:4321` |
| `npm run build` | Static build to `./dist` |
| `npm run preview` | Preview production build |
| `npm run check` | TypeScript/Astro type checking (`astro-check`) |

No test runner or linter is configured.

## Git

Commit subjects: capitalized imperative, no type prefix, no scope.

## Architecture

**Content Layer API** (`src/content.config.ts`): Blog posts are Markdown/MDX files in `src/content/posts/` loaded via Astro's glob loader with Zod schema validation (`title`, `date`, `categories`, `description`, `draft`, `slug?`).

**Routing**:
- Post pages: `src/pages/posts/[year]/[month]/[day]/[slug].astro` — builds to `/posts/yyyy/mm/dd/slug.html`
- Non-post pages: `src/pages/pages/*.astro` — builds to `/pages/about.html`, etc.
- XML feeds: `src/pages/static/xml/` — `rss.xml.ts`, `search.xml.ts`, `sitemap.xml.ts` (APIRoute endpoints)
- Build format is `file` (individual `.html` files, no `/index.html` nesting)

**Layout hierarchy**: `BaseLayout.astro` (HTML shell, meta, CSS, scripts, dark mode) → `PostLayout.astro` (article title/subtitle wrapper). The `layoutType` prop controls which CSS is loaded (`page.css` vs `post.css` + code highlighting).

**Centralized config** (`src/lib/site.ts`): Site title, description, menu items, feature flags (`extClickEffect`, `extMath`, `extCount`), URLs, friend links.

**URL helpers** (`src/lib/posts.ts`): `withBase(path)` prepends baseUrl; `pageUrl(path)` appends `.html` in production.

**Dark mode**: CSS class-based (`html.dark`), persisted in `localStorage.darkMode`, falls back to `prefers-color-scheme`. Uses a 500ms CSS transition on theme toggle.

**Client JS** (vanilla, in `public/static/js/`): `blog.js` (dark mode toggle, image lightbox, click text effect), `search.js` (fetches `search.xml` for client-side full-text search with CJK support), `sw-cleanup.js` (legacy Jekyll service worker cleanup).

**Styling**: Plain CSS in `public/static/css/` — no preprocessor, no Tailwind. Separate files for common, page, post, dark theme, and code highlighting themes.

## Writing Content

Posts go in `src/content/posts/` with filename format `yyyy-mm-dd-slug.md(x)`.

Required frontmatter: `title`, `date` (yyyy-mm-dd), `categories` (array), `description`.

Optional frontmatter: `draft: true` (excluded from build), `slug` (overrides filename slug).

### Category convention

Each post has exactly one category in the `categories` array. The vocabulary is fixed to the following 7 buckets — do not invent new ones without updating this list:

| Category | What goes here |
|---|---|
| `Harness` | AI agent 内部机制、提示词机制（subagent/swarm/memory 机制、prompt 风格/路由/结构、agent 内部源码级拆解） |
| `Vibe Coding` | AI agent 的配置与使用（BYOK 配置、provider/extension 控制、跨 agent 集成选型、reasoning effort 配置等） |
| `Tooling` | 接入踩坑、环境踩坑、日志解读（WSL bug、sub2api 接入失败、agent 日志占位符等不深挖 agent 内部的问题） |
| `LLM` | 模型本体行为（口癖、模型层 bug、模型能力研究） |
| `前端` | 前端建站相关 |
| `运维` | 部署、监控、自托管 |
| `逆向` | 抓包、协议复现、reverse engineering |

Boundary rule: 机制 vs 配置是 Harness 和 Vibe Coding 的分水岭。"agent 怎么工作的"→ Harness；"agent 怎么配 / 怎么用 / 怎么选"→ Vibe Coding。

## Deployment

GitHub Actions workflow (`.github/workflows/deploy.yml`): Node 22, `npm ci`, `npm run build`, deploys `./dist` to GitHub Pages.

## Legacy

Root directories `_includes/`, `_layouts/`, `static/`, `pages/` are empty remnants of the original Jekyll setup and can be removed.
