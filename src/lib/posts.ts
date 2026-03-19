import { getCollection, type CollectionEntry } from 'astro:content';
import { pageUrl } from './site';

export type PostEntry = CollectionEntry<'posts'>;

export async function getPosts() {
  const posts = await getCollection('posts', ({ data }) => !data.draft);
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export function getPostSegments(post: PostEntry) {
  const year = post.data.date.getFullYear().toString();
  const month = String(post.data.date.getMonth() + 1).padStart(2, '0');
  const day = String(post.data.date.getDate()).padStart(2, '0');
  const rawSlug = post.data.slug ?? post.id.replace(/\.(md|mdx)$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
  const slug = rawSlug.trim();
  return { year, month, day, slug };
}

export function getPostUrl(post: PostEntry) {
  const { year, month, day, slug } = getPostSegments(post);
  return pageUrl(`/posts/${year}/${month}/${day}/${slug}`);
}

export function groupPostsByYear(posts: PostEntry[]) {
  return posts.reduce<Record<string, PostEntry[]>>((acc, post) => {
    const year = post.data.date.getFullYear().toString();
    if (!acc[year]) {
      acc[year] = [];
    }
    acc[year].push(post);
    return acc;
  }, {});
}

export function getCategoryMap(posts: PostEntry[]) {
  return posts.reduce<Record<string, PostEntry[]>>((acc, post) => {
    for (const category of post.data.categories) {
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(post);
    }
    return acc;
  }, {});
}

export function stripMarkdown(input: string) {
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/[#*_~>-]/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getPostExcerpt(post: PostEntry) {
  return stripMarkdown(post.body ?? '').slice(0, 180);
}

export function formatDate(date: Date, sep = '/') {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return [year, month, day].join(sep);
}

export function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
