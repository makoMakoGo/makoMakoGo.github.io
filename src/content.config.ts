import { glob } from 'astro/loaders';
import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';

const posts = defineCollection({
  loader: glob({ base: './src/content/posts', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    categories: z.array(z.string()).default([]),
    description: z.string().default(''),
    draft: z.boolean().default(false),
    extMath: z.boolean().optional(),
    slug: z.string().optional(),
  }),
});

export const collections = { posts };
