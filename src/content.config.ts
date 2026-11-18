import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

/**
 * Projects. One Markdown file per project in src/content/projects/; the frontmatter
 * is validated against this schema at build time, so a typo fails the build instead
 * of shipping.
 *
 * featured: true  → a card with a screenshot under "Selected work", and its own page
 *                   built from the Markdown body.
 * featured: false → a compact card under "More projects" that links straight to the code.
 */
const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: ({ image }) =>
    z
      .object({
        title: z.string(),
        /** One or two sentences: the problem and what was built. Shown on the card. */
        summary: z.string(),
        kind: z.enum(['Professional', 'Personal', 'Study', 'Teaching']),
        org: z.string().optional(),
        role: z.string().optional(),
        period: z.string(),
        stack: z.array(z.string()).min(1),
        /** Card order, ascending. */
        order: z.number(),
        featured: z.boolean().default(true),
        /** A short tag such as "In progress". */
        status: z.string().optional(),
        /** Screenshot, relative to the Markdown file. */
        image: image().optional(),
        imageAlt: z.string().optional(),
        links: z
          .array(
            z.object({
              label: z.string(),
              href: z.url(),
              kind: z.enum(['play', 'download', 'source', 'other']).default('other'),
            }),
          )
          .default([]),
      })
      .refine((p) => !p.image || (p.imageAlt && p.imageAlt.length > 10), {
        message: 'A project with an image needs a descriptive imageAlt.',
        path: ['imageAlt'],
      }),
});

export const collections = { projects };
