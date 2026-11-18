import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

/**
 * Case studies. One Markdown file per project in src/content/projects/; the
 * frontmatter is validated against this schema at build time.
 */
const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    /** One or two sentences: the problem and what was built. Shown on the card. */
    summary: z.string(),
    kind: z.enum(['Professional', 'Personal', 'Teaching']),
    org: z.string().optional(),
    role: z.string().optional(),
    period: z.string(),
    stack: z.array(z.string()).min(1),
    /** Card order on the home page, ascending. */
    order: z.number(),
    links: z.array(z.object({ label: z.string(), href: z.url() })).default([]),
  }),
});

export const collections = { projects };
