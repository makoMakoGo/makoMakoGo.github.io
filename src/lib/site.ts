export const pagePaths = {
  categories: '/pages/categories',
  search: '/pages/search',
  links: '/pages/links',
  chat: '/pages/chat',
  about: '/pages/about',
} as const;

export const site = {
  title: "makoMakoGo's Blog",
  description: 'I love math and dinosaurs.',
  keywords: 'makoMakoGo,Blog,Math,Programming,Go,Python',
  author: 'makoMakoGo',
  footerText: 'Copyright © 2026 makoMakoGo',
  domainUrl: 'https://makoMakoGo.github.io',
  baseUrl: '',
  extClickEffect: true,
  extMath: false,
  extCount: false,
  links: [] as Array<{ title: string; url: string; desc?: string }>,
  menu: [
    { title: '首页', url: '/' },
    { title: '归类', url: pagePaths.categories },
    { title: '搜索', url: pagePaths.search },
    { title: '友链', url: pagePaths.links },
    { title: '留言', url: pagePaths.chat },
    { title: '关于', url: pagePaths.about },
  ],
} as const;

export function withBase(path: string) {
  if (/^https?:\/\//.test(path)) {
    return path;
  }
  return `${site.baseUrl}${path}`;
}

export function pageUrl(path: string) {
  if (path === '/') {
    return path;
  }
  return import.meta.env.DEV ? path : `${path}.html`;
}
