import type { APIRoute } from 'astro';
import { escapeXml, getPostExcerpt, getPosts, getPostUrl } from '../../../lib/posts';
import { site } from '../../../lib/site';

export const prerender = true;

export const GET: APIRoute = async () => {
  const posts = await getPosts();
  const items = posts
    .map((post) => {
      const link = `${site.domainUrl}${site.baseUrl}${getPostUrl(post)}`;
      return `<item><title>${escapeXml(post.data.title)}</title><link>${escapeXml(link)}</link><guid>${escapeXml(link)}</guid><pubDate>${post.data.date.toUTCString()}</pubDate><description>${escapeXml(post.data.description || getPostExcerpt(post))}</description></item>`;
    })
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeXml(site.title)}</title><link>${escapeXml(site.domainUrl)}</link><description>${escapeXml(site.description)}</description>${items}</channel></rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
};
