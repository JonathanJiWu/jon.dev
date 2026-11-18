# Roadmap

The site is built in stages. Each one is shippable on its own, and the plain-HTML
résumé always works no matter what the 3D is doing.

## Done

### Milestone 1: the content-first site
- Astro 7 + strict TypeScript. Every section is plain HTML that works without JavaScript.
- Content from the résumé in `src/data/profile.ts`; case studies as validated Markdown.
- SEO: canonical URLs, Open Graph card, Person structured data, sitemap.
- Accessibility: skip link, visible focus, semantic landmarks. axe-core reports 0
  violations (WCAG 2.2 AA + best practices) on the home page, both case studies and the 404.

### Milestone 2: the flight simulation
- 3-DOF point-mass flight model with an ISA atmosphere, integrated by RK4 at a fixed 120 Hz.
- Vector-field guidance, a three-loop autopilot, and terrain clearance.
- 25 unit tests, including determinism and frame-rate independence.

### Milestone 3: the scene
- Terrain drawn like a synthetic-vision display, with contour lines computed per pixel.
- A dusk sky. Fog uses the same sky function as the dome, so distant hills fade into the matching sky color.
- A procedural four-turboprop transport with correct navigation lights.
- The flight plan drawn in the world: route, active leg, hold and fix beams.
- Sections are waypoints: scrolling sends the aircraft direct to each one.
- A capability check, a still-image fallback, adaptive resolution and pausing in background tabs.

### Milestone 4: the engineering view
- Force vectors, autopilot readouts, a strip chart of loop response, and real-time loop stats.
- Sim-rate control (×1, ×2, ×4).

### Deployment
- GitHub Actions: test, type-check and build on pull requests; deploy to Pages from `main`.

## Your turn (content only you can write)

1. **Rewrite the bio** in `src/data/profile.ts` (`about`) in your own voice. The current
   text is a factual draft built from your résumé. A line or two about what draws you to
   simulation would do a lot.
2. **Deepen the C-130J case study** (`src/content/projects/c130j-pneumatics.md`). Cover
   how the pressurization loop was structured, how you validated it, the hardest bug,
   and what you'd do differently. Recruiters remember specifics.
3. ~~Pick GitHub projects to feature.~~ Done:
   - **Case studies:** Isles of Resistance, Cyberpunk 2D77 and EyeLevel.
   - **Compact cards:** Star System, Pong, motionSimulation and vector3d.
4. **EyeLevel update notes** (`src/content/projects/eyelevel.md` is the page to refresh as it changes):
   - Move the TMDB key out of `app/config/tmdbConfig.ts`. Rotate it in your TMDB account
     settings, then read it from an `EXPO_PUBLIC_TMDB_API_KEY` entry in a git-ignored `.env`.
   - Upgrading from Expo SDK 52: step one SDK at a time with `npx expo install expo@^NN --fix`
     and Expo's per-version changelogs.
   - A live demo would lift the card. The app already builds for the web (`expo start --web`,
     react-native-web), so a hosted web build plus an Android preview build would let
     recruiters try it.
   - Consider archiving the older watchlist repos (`eye-level`, `eyelevel-v3-frontend`,
     `movie-watchlist*`) so visitors land on the current one. Keep
     `movie-watchlist-react-springboot-mysql` public: the EyeLevel page links to it as the 2021 version.
5. **Small fixes on GitHub:**
   - `vector3d/README.md` lists subtract, dot product and normalize as done, but they're
     commented out in `vector3d.py`.
   - `PongCppRaylib` has a known velocity bug noted in `Ball.cpp`.
   - Reviewers do click through, so these are worth tidying.
6. **Own the flight model.** Read `src/sim/`. It's your domain. Re-tune the parameters in
   `aircraft.ts` and the gains in `autopilot.ts`, and keep `npm test` green. That makes it
   genuinely yours to discuss in interviews.

## Next milestones

- **M5: Interactive pressurization demo.** A simplified, clearly labeled cabin-pressure
  model with a controller you can disturb (change altitude, open a valve, watch it
  recover), embedded in the C-130J case study. 2D canvas, so it works everywhere.
- **M6: "Take the controls".** Keyboard, touch or gamepad flying, with the autopilot
  as a stability augmentation you can switch off. Opt-in, never in the way of reading.
- **M7: Polish.**
  - a custom domain;
  - Lighthouse CI budgets on pull requests;
  - privacy-friendly analytics (e.g. Plausible or GoatCounter);
  - optional ambient sound (off by default);
  - an RSS-driven "Writing" section from Critical Bits.
- **Maybe:** a 6-DOF rigid-body model behind the same interface; a WebGPU renderer once
  it's the safe default.
