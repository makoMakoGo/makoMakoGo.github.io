# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

## Deployment

GitHub Actions workflow (`.github/workflows/deploy.yml`): Node 22, `npm ci`, `npm run build`, deploys `./dist` to GitHub Pages.

## Legacy

Root directories `_includes/`, `_layouts/`, `static/`, `pages/` are empty remnants of the original Jekyll setup and can be removed.
