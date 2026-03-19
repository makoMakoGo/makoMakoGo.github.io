import type { APIRoute } from 'astro';
import { escapeXml, getPostExcerpt, getPosts } from '../../../lib/posts';

export const prerender = true;

export const GET: APIRoute = async () => {
  const posts = await getPosts();
  const items = posts
    .map((post) => `<li>${escapeXml(getPostExcerpt(post))}</li>`)
    .join('');

  return new Response(`<ul>${items}</ul>`, {
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
    },
  });
};
