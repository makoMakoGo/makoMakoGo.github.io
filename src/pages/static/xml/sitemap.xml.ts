import type { APIRoute } from 'astro';
import { getPosts, getPostUrl } from '../../../lib/posts';
import { pagePaths, pageUrl, site } from '../../../lib/site';

export const prerender = true;

export const GET: APIRoute = async () => {
  const posts = await getPosts();
  const urls = [
    '/',
    pageUrl(pagePaths.categories),
    pageUrl(pagePaths.search),
    pageUrl(pagePaths.links),
    pageUrl(pagePaths.chat),
    pageUrl(pagePaths.about),
    ...posts.map((post) => getPostUrl(post)),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls
    .map((url) => `<url><loc>${site.domainUrl}${site.baseUrl}${url}</loc></url>`)
    .join('')}</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
};
