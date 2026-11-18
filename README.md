# jon.dev

Jonathan Wu's portfolio. The site is a fast, plain-HTML résumé with a live flight
simulation running behind it. Each section of the page is a waypoint on a flight plan.
Scroll to a section and the autopilot flies there and enters a hold. The **engineering
view** shows what's happening underneath: the forces, the control loops and the timing.

- Live site: <https://jonathanjiwu.github.io/jon.dev/> (once deployed, see below)
- How the simulation works: [`src/content/projects/flight-portfolio.md`](src/content/projects/flight-portfolio.md)
- What's next: [`docs/ROADMAP.md`](docs/ROADMAP.md)

## Quick start

Requires Node.js **22.23 or newer** (see `.nvmrc`).

```sh
npm install
npm run dev        # http://localhost:4321/jon.dev/
npm test           # simulation unit tests (Vitest)
npm run check      # type-check .astro and .ts files
npm run build      # production build into dist/
npm run preview    # serve dist/ locally
npm run ci         # test + check + build, exactly as CI runs it
```

Useful URL parameters:

| Parameter     | Effect                                                                          |
| ------------- | ------------------------------------------------------------------------------- |
| `?scene=on`   | Force the 3D scene on, even where the site would decline (software GPU, etc.).  |
| `?poster`     | Capture mode: hides the page and freezes a deterministic frame for stills.      |

## Updating the content

All the text comes from two places. You shouldn't need to touch any markup.

- **`src/data/profile.ts`** holds the intro, bio, facts, skills, experience,
  education and the robotics/teaching cards. To add a role, append to `experience`.
- **`src/content/projects/*.md`** holds the projects, one Markdown file each. The
  frontmatter is validated at build time against the schema in
  `src/content.config.ts`, so a typo fails the build instead of shipping:

  ```yaml
  ---
  title: EyeLevel
  summary: One or two sentences for the card.
  kind: Personal            # Professional | Personal | Study | Teaching
  period: Since 2025
  stack: [React Native, Expo, TypeScript]
  order: 5                  # card order, ascending
  featured: true            # true: card with screenshot + its own page; false: compact card
  status: In progress       # optional tag
  image: ../../assets/projects/eyelevel.webp   # optional; needs imageAlt
  imageAlt: What the screenshot shows, for screen readers.
  links:
    - { label: Play it, href: https://example.com, kind: play }   # play | download | source | other
  ---
  The case study, in Markdown (featured projects only).
  ```

  "Play" and "Download" links appear as buttons on the card. Put screenshots in
  `src/assets/projects/`; Astro resizes and converts them at build time.

After changing how the scene *looks*, regenerate the still image and the social card:

```sh
npm run build && npm run poster   # needs: npm i -D playwright && npx playwright install chromium
```

## Architecture

```text
src/
  sim/        Flight model, guidance, autopilot. Plain TypeScript: no DOM, no three.js.
  world/      Terrain and route: pure, deterministic functions shared by physics and graphics.
  scene/      three.js rendering. Reads the simulation, never writes to it.
  scripts/    boot.ts: section tracking + the "should this device run 3D?" decision.
  components/ Astro components (hero, sections, flight plan, engineering panel…).
  data/       profile.ts: the résumé content.
  content/    Markdown case studies.
  pages/      index, /projects/[slug]/, 404, robots.txt.
```

**Why the split.** The simulation has no rendering dependency, so it runs and is tested
in Node. The terrain function that builds the mesh also feeds the autopilot's
terrain-clearance check, so the graphics and the physics can't disagree.

**The real-time loop.** Physics runs at a fixed 120 Hz using RK4, and the autopilot at
60 Hz. Each animation frame adds its wall-clock time to an accumulator, runs however
many fixed steps that covers, then draws a pose interpolated between the last two
states. The physics is identical at any frame rate, and a test proves it.

**Progressive enhancement.** Every word is in the HTML and works without JavaScript.
`boot.ts` (about 3 KB) decides whether to fetch the 3D chunk (about 155 KB gzipped):

```text
no WebGL2 ............................ still image, no 3D toggle
software renderer (no GPU) ........... still image + "Start it anyway"
prefers-reduced-motion / Save-Data ... still image + "Start it anyway"
visitor turned 3D off ................ still image + "Turn it on" (remembered)
otherwise ............................ live scene fades in over the still
```

While it runs, the scene pauses in background tabs, lowers its resolution when frames
run long, and falls back to the still image if the GPU context is lost.

## Deploying

The site deploys to **GitHub Pages** through GitHub Actions (`.github/workflows/deploy.yml`).
Pull requests are tested, type-checked and built. Pushes to `main` also deploy.

**One-time setup:** open the repository's **Settings → Pages → Build and deployment**
and set **Source** to **GitHub Actions**. After that, merging to `main` publishes to
`https://jonathanjiwu.github.io/jon.dev/`.

The URL is detected automatically by `actions/configure-pages`, so these later changes
need no code edits:

- **Custom domain.** Buy one, add it under Settings → Pages → Custom domain, and point
  DNS at GitHub as GitHub's instructions describe. The base path becomes `/` on its own.
- **Root URL on github.io.** Rename this repository to `JonathanJiWu.github.io`. That
  name is currently used by the Per Scholas homework repository, which would need
  renaming first.

To deploy somewhere other than GitHub Pages, run `npm run build` with
`SITE_URL=https://your.domain BASE_PATH=/` and upload `dist/`. Any static host works,
for example Cloudflare Pages, Netlify or Vercel.

## Testing

`npm test` runs 25 tests on the simulation and the world:

- ISA atmosphere against standard-table values;
- trimmed flight stays trimmed;
- coordinated-turn rate equals g·tan φ / V;
- RK4 shows fourth-order convergence;
- the guidance vector fields behave as specified;
- every waypoint is captured and held within bank, stall-margin and terrain-clearance limits;
- runs are bit-for-bit deterministic and independent of frame rate;
- the terrain is pure, the runway is flat, and the holds clear the ground.

## License

Code: MIT (see `LICENSE`).
