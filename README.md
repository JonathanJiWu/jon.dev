# jon.dev

Jonathan Wu's portfolio, with a live flight simulation. It opens in **Fly**: a generic
four-engine turboprop flies a planned instrument flight between two fictional airports,
with chase, orbit and cockpit views and a glass cockpit whose instruments all read the
same simulation. **Read** is a fast, plain-HTML résumé with the flight as its backdrop.
Each section is a waypoint; scroll to one and the aircraft holds over it. The
**engineering view** shows the forces, control loops and timing underneath.

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

| Parameter       | Effect                                                                          |
| --------------- | ------------------------------------------------------------------------------- |
| `?view=fly`     | Open in Fly (the default for a new session) or `?view=read` in Read.            |
| `?at=600`       | Start that many seconds into the flight (deterministic): `?at=610` is on final. |
| `?scene=on`     | Force the 3D scene on, even where the site would decline (software GPU, etc.).  |
| `?poster`       | Capture mode: hides the page and freezes a deterministic frame for stills.      |

In Fly: drag to look around, scroll or pinch to zoom, `C` cycles chase, orbit and
cockpit, arrow keys orbit or look, `R` resets the view, `Esc` leaves an instrument.
Click a cockpit display to lean in to it; click its keys to press them.

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
  sim/        Plain TypeScript, no DOM, no three.js:
                dynamics.ts, ground.ts      flight model (RK4) and ground roll
                planner.ts, navdata.ts      flight planning, runways, wind, geometry
                fms.ts, autopilot.ts        phases, LNAV/VNAV, holds, direct-to; control loops
                systems.ts                  fuel, gear, flaps, simplified pressurization
                flightData.ts               the one snapshot every display reads
                simulation.ts               fixed-step loop tying it together
  world/      Terrain, airports and fixes: pure functions shared by physics and graphics.
  scene/      three.js rendering. Reads the simulation, never writes to it:
                main.ts                     render loop, input, Fly/Read
                cameraRig.ts                chase / orbit / cockpit, blended transitions
                aircraftModel.ts, airframe.ts   the aircraft, and the shape it shares with the cockpit
                cockpit/                    flight deck geometry and the six canvas displays
                terrainMesh.ts, terrain.worker.ts, groundLights.ts, airportLayout.ts
                hud.ts, routeViz.ts, labels.ts, engineering.ts
  scripts/    boot.ts: Fly/Read, section tracking, the "should this device run 3D?" decision.
  components/ Astro components (hero, sections, Fly HUD, flight plan, engineering panel…).
  data/       profile.ts: the résumé content.
  content/    Markdown case studies.
  pages/      index, /projects/[slug]/, 404, robots.txt.
```

**Why the split.** The simulation has no rendering dependency, so it runs and is tested
in Node. The terrain function that builds the mesh also feeds the planner's minimum
altitudes and the flight's terrain checks, so the graphics and the physics can't disagree.
And every instrument reads one `FlightData` snapshot per frame, so no two can disagree.

**The real-time loop.** Physics runs at a fixed 120 Hz using RK4, and the autopilot at
60 Hz. Each animation frame adds its wall-clock time to an accumulator, runs however
many fixed steps that covers, then draws a pose interpolated between the last two
states. The physics is identical at any frame rate, and a test proves it.

**Fly and Read.** A small inline script picks the view before first paint, so nothing
flashes. New sessions fly; the choice is kept for the session; a link to a section reads.
`boot.ts` (about 9 KB) then decides whether to fetch the 3D chunk (about 190 KB gzipped):

```text
no WebGL2 ............................ Read with a still image, no Fly/Read switch
software renderer (no GPU) ........... Read with a still image + "Fly anyway"
Save-Data ............................ Read with a still image + "Fly anyway"
prefers-reduced-motion ............... the flight starts paused; camera moves cut, not glide
visitor turned the backdrop off ...... Read with a still image + "Turn it on" (this session)
otherwise ............................ the live scene fades in over the still
```

Without JavaScript there is only Read.

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

`npm test` runs 225 tests on the simulation and the world (about 8 seconds):

- physics: ISA against standard tables; trimmed flight stays trimmed; coordinated turns at
  g·tan φ / V; RK4 fourth-order convergence; exact wind drift; flaps, gear and thrust lapse;
- ground roll: rotation distance matches the planner, braking never rolls backward;
- navigation: bearings, magnetic variation, runway designators, the E6B wind triangle,
  runway selection;
- planning, in six winds each way: runway into the wind, semicircular cruise altitudes,
  minimum en-route altitude, leg order, approach geometry and entry, top of climb/descent,
  fuel and reserves, no warnings;
- full flights both ways in five winds: no incidents, every phase in order, touchdown in
  the touchdown zone below 360 fpm, envelope and terrain clearance, time and fuel near plan;
- hold, resume and direct-to; systems limits; the FlightData snapshot against the state;
- determinism, frame-rate independence, warm-up, and the terrain (flat runways, clear approaches).

## License

Code: MIT (see `LICENSE`).
