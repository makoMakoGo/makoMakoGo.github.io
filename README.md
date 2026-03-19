# makoMakoGo's Blog

这是 `makoMakoGo` 的个人博客仓库，包含两部分：

- 博客框架：基于 Astro 的静态博客骨架
- 博客内容：文章、站点信息、个人品牌资源

这个仓库最初是从一个基于 [TMaize/tmaize-blog](https://github.com/TMaize/tmaize-blog) 的旧 Jekyll 博客骨架起步，当前代码已经脱离 Jekyll / Ruby，改为 Astro 底座。现在保留的是原来那套极简风格、页面结构和静态资源组织，不再保留旧生成器的运行方式。

更具体的许可与归属说明见 [NOTICE](./NOTICE)。

## 复用本仓库骨架

欢迎复用这个仓库的代码骨架。

推荐做法：

1. 通过 GitHub 的 `Use this template`、`fork` 或直接克隆仓库开始。
2. 修改 `src/lib/site.ts`，替换站点标题、描述、域名、菜单、版权等全局配置。
3. 清空或替换 `src/content/posts` 里的文章内容。
4. 根据自己的需要调整 `src/pages`、`src/layouts` 和 `public/static`。
5. 如果你直接复用当前代码骨架，请保留 `LICENSE` 和 `NOTICE` 里的来源说明。

## 本地运行

```bash
npm install
npm run dev
```

默认开发地址：

```text
http://127.0.0.1:4321
```

## 构建与检查

```bash
npm run build
npm run check
```

## 仓库结构

- `src/content/posts`：博客文章内容
- `src/pages`：页面路由与 XML 输出
- `src/layouts`：基础布局与文章布局
- `src/components`：页头、页脚等公共组件
- `src/lib/site.ts`：站点标题、描述、菜单、域名等全局配置
- `public/static`：样式、脚本、图片等静态资源

## 内容写作

文章文件放在 `src/content/posts`，文件名建议保持：

```text
yyyy-MM-dd-slug.md
```

Frontmatter 结构：

```yaml
---
title: 标题
date: 2026-03-18
categories:
  - 分类
description: 摘要
draft: false
---
```

文章最终链接会生成成：

```text
/posts/yyyy/mm/dd/slug.html
```

## 页面路由

- 开发模式：`/`、`/pages/categories`、`/pages/search`、`/pages/links`、`/pages/chat`、`/pages/about`
- 构建产物：`/`、`/pages/categories.html`、`/pages/search.html`、`/pages/links.html`、`/pages/chat.html`、`/pages/about.html`

## 更换图标与静态资源

如果你要替换站点图标、头像或品牌资源，优先改这些文件：

- `public/static/img/site-avatar.png`：页头左上角圆形头像；友情链接页里输出的头像地址也指向它
- `public/apple-touch-icon.png`：`apple-touch-icon`
- `public/favicon.ico`：页面 favicon；浏览器默认也会尝试请求这个根路径图标
- `public/static/img/icon-theme-light.svg`：浅色主题按钮图标
- `public/static/img/icon-theme-dark.svg`：深色主题按钮图标
- `public/static/img/icon-arrow-top.svg`：回到顶部按钮图标
- `public/static/img/icon-loading.svg`：搜索页 loading 图标

和站点身份一起改的配置入口：

- `src/lib/site.ts`：站点标题、描述、关键词、作者、页脚版权、域名、菜单、友链数据
- `src/pages/pages/links.astro`：友情链接页里展示的站点名称、描述、地址、头像文案
- `src/components/Footer.astro`：页脚内容
- `public/static/js/blog.js`：控制台里打印的站点身份信息

## 许可与版权

- 代码骨架与站点实现：按仓库根目录的 [LICENSE](./LICENSE) 和 [NOTICE](./NOTICE) 处理
- 博客文章与个人品牌资源：默认不随代码骨架一起开放复用，除非文件内另有声明
- 如果你只是参考视觉方向，但没有复制当前仓库代码、资源或结构实现，就不需要沿用这里的仓库声明
