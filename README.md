# makoMakoGo's Blog

个人博客，基于 Astro，推送到 main 分支后由 GitHub Actions 自动部署到 GitHub Pages。

代码最初源自 [TMaize/tmaize-blog](https://github.com/TMaize/tmaize-blog)（Jekyll），后来整体迁移到 Astro，保留了原有的极简样式和页面结构，不再依赖 Jekyll / Ruby。来源与许可说明见 [NOTICE](./NOTICE)，代码结构与写作约定见 [AGENTS.md](./AGENTS.md)。

## 本地运行

```bash
npm install
npm run dev       # 开发服务，http://127.0.0.1:4321
npm run build     # 构建到 ./dist
npm run preview   # 预览构建产物
npm run check     # 类型检查
```

## 写文章

文章放在 `src/content/posts/`，文件名为 `yyyy-MM-dd-slug.md`，构建后的链接为 `/posts/yyyy/mm/dd/slug.html`。

frontmatter 如下，另有可选字段 `draft: true`（不参与构建）和 `slug`（覆盖文件名中的 slug）：

```yaml
---
title: 标题
date: 2026-03-18
categories:
  - 分类
description: 摘要
---
```

## 复用

欢迎复用代码骨架。全局配置（标题、描述、域名、菜单、友链）集中在 `src/lib/site.ts`，头像和图标在 `public/` 下，替换 `src/content/posts/` 里的文章即可。

文章与头像等个人内容不在 MIT 授权范围内；复用代码时请保留 LICENSE 和 NOTICE。
