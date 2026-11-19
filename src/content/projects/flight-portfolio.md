---
title: This site, a flight simulation in the browser
summary: A planned instrument flight between two fictional airports, flown live by a flight model, autopilot and flight management system, with a glass cockpit whose instruments all read the same simulation.
kind: Personal
period: '2026'
stack: [TypeScript, Three.js, WebGL2, GLSL, Canvas 2D, Web Workers, Astro, Vitest]
order: 4
image: ../../assets/poster.jpg
imageAlt: The site's live scene at dusk, with a four-engine transport on final approach following its magenta glide path toward a lit runway, and mountains on the horizon.
links:
  - label: Source on GitHub
    href: https://github.com/JonathanJiWu/jon.dev
    kind: source
---

## Why a flight simulation

Instead of describing real-time simulation, this site runs one. It opens in **Fly**: a
generic four-engine turboprop flies a planned instrument flight between two fictional
airports. It takes off, climbs, cruises over a waypoint for each part of the portfolio,
descends, flies an approach and lands, then turns around for the next flight. **Read**
puts the portfolio back in front, with the flight as its backdrop. Scroll to a section and
the aircraft holds over that section's waypoint until you move on.

## Architecture

The physics never knows it is being drawn:

```text
src/sim     flight model, planner, FMS, autopilot, systems     plain TypeScript: no DOM, no three.js
src/world   terrain, airports, navigation data                  pure functions, shared by physics and graphics
src/scene   rendering, cameras, cockpit, heads-up panels        reads the simulation, never writes to it
```

The simulation is tested in Node. The terrain function that builds the mesh also feeds the
planner's minimum altitudes and the flight's terrain checks, so graphics and physics can't
disagree. Each frame, one `FlightData` snapshot is built in cockpit units (knots, feet,
magnetic headings), and every display reads it: the page's readouts, the heads-up panels,
the engineering view, and all six cockpit displays.

## Planning a flight

Each flight is planned like an instrument flight, using real rules of thumb on fictional data:

- **Runways** are chosen most into the wind, among those long enough for the takeoff and for a
  landing factored to 60% of the runway, the usual dispatch margin.
- **Departure.** Climb on runway heading to 1,000 ft above the field, then turn direct to
  the first fix. These are ARINC 424 leg types VA and DF; later legs are TF, and a turn over
  110° becomes a fly-over and direct-to.
- **Minimum en-route altitude**: the highest terrain within 4 NM of the route plus 1,000 ft.
- **Cruise altitude** follows the IFR semicircular rule (14 CFR 91.179): odd thousands
  eastbound, even thousands westbound. It takes the lowest altitude that still leaves room
  to climb and descend.
- **Profile.** Top of climb from an integrated climb; top of descent for a 3° path to the
  first approach fix.
- **Approach.** RNAV-style: initial fix at 7 NM, final approach fix at 4 NM, a 3° glide path
  crossing the threshold at 50 ft. It is entered straight in or via a base leg depending on
  which side the aircraft arrives from, as in an FAA terminal arrival area. The initial
  approach altitude keeps 1,000 ft above the terrain around the base leg.
- **Time and fuel**, segment by segment: the wind triangle on every leg, and the thrust each
  segment needs from the same drag model the simulation flies, plus a 45-minute reserve. The
  test suite checks the plan against the flight: flown time and fuel come within 12% of plan.
- **Weather** comes as simulated METARs. The briefing in the flight-plan panel shows the
  runways, V-speeds, fuel and any warnings.

Everything is labelled as simulated: the airports, weather and procedures are fictional and
must not be used for navigation.

## The flight model

A three-degree-of-freedom point mass in wind axes, in the International Standard
Atmosphere, with a steady wind (so ground track and heading differ, and the aircraft crabs):

```text
m·dV/dt         = T·cos α − D − m·g·sin γ
m·V·dγ/dt       = (L + T·sin α)·cos φ − m·g·cos γ
m·V·cos γ·dψ/dt = (L + T·sin α)·sin φ

L = q·S·CL(α, flaps)    D = q·S·(CD0 + ΔCD(flaps, gear) + k·CL²)    q = ½·ρ(h)·V²
```

Flaps and gear change lift and drag. Mass falls as fuel burns. Propeller thrust falls with
speed and altitude, and reverse thrust works on the ground. On the runway a separate ground
model takes over, with rolling friction, braking, airspeed equal to ground speed plus
headwind, and lift-off once the wing carries the weight. Bank, angle of attack and engine
output each follow their commands through first-order lags, standing in for the inner loops
of a full six-degree-of-freedom model. The numbers describe a generic transport, not any
real type.

## Flight management and autopilot

- **Phases**: takeoff, climb, cruise, descent, approach, final, landing, parked, plus holds and
  direct-to on request. Flaps and gear are scheduled like a crew would: gear up with a
  positive rate, approach flaps when slow enough, gear down before the final approach fix.
- **Lateral.** Vector-field guidance (after Beard and McLain's *Small Unmanned Aircraft*)
  flown on the ground track, so it corrects for wind. Fly-by turns start early enough to roll
  out on the next leg.
- **Vertical.** Altitude, path (descent and glide path), speed-on-pitch climbs, and an
  exponential flare. Each becomes an angle of attack by inverting the flight-path equation
  for the lift it needs, plus an integral trim.
- **Thrust.** Speed by autothrottle (drag feedforward plus PI), or fixed settings for
  takeoff, climb, idle and reverse; autobrake to a target deceleration.
- **Annunciation** like an airliner's flight mode annunciator: thrust, roll and pitch modes,
  with FAC and G/P on the RNAV final.

## Systems

Fuel, gear and flap travel, and cabin pressurization. The pressurization model is a
deliberately simplified illustration of a closed-loop controller: bleed air in, an outflow
valve positioned by a PI controller to follow a scheduled cabin altitude within rate limits,
and pre-pressurization on the takeoff roll so there's no bump at lift-off. The cockpit
labels it as a simplified, simulated controller.

## The cockpit

The flight deck is a second render pass in the aircraft's own frame, so the
millimetre-scale interior and the 100 km world each get the depth precision they need. Its
six displays are drawn with Canvas 2D from the shared `FlightData`:

- **PFD**: attitude with pitch ladder and flight director, speed and altitude tapes with
  bugs and trend, vertical speed, heading, the mode annunciator and approach deviations.
- **ND**: the route, active leg, holds, top of climb and descent, airports and wind, with
  range control.
- **Engines**: torque, turbine temperature, gas-generator and propeller speed, fuel flow,
  flaps, gear and memo messages.
- **MFD**: pages for engines, fuel (with a predicted arrival fuel), pressurization, and a
  vertical profile of the route ahead over the terrain.
- **CDU**: LEGS, PROG, PERF, DIRECT TO and HOLD pages, with working line-select keys.
- **MCP**: selected speed, track and altitude, with the engaged modes lit.

You can look around, zoom, or click a display to lean in and face it squarely. Clicking a
key presses it.

## The world

Terrain is a pure function: rolling hills, a mountain ring on the horizon, flattened runway
pads and approach corridors kept clear of the glide path. A Web Worker builds the mesh,
fine where flights are flown and coarse toward the horizon, so the page never stutters.
Runway markings are painted in the shader so they stay crisp at any distance: threshold
bars, designators, aiming points and touchdown zones. The lighting follows FAA practice in
spirit:
- edge, threshold and runway-end lights;
- a simplified approach lighting system with sequenced flashers;
- PAPI units that turn red or white with your angle to the glide path;
- taxiway lights, beacons and towns.

## The real-time loop

Physics runs at a fixed 120 Hz with fourth-order Runge–Kutta, and the autopilot at 60 Hz.
Each animation frame adds its wall-clock time to an accumulator, runs however many fixed
steps that covers, and draws a pose interpolated between the last two states. Long frames
can't trigger a spiral of catch-up steps, and the integrator allocates nothing per step.

## Tested like a simulation

There are 225 tests. They check the properties that matter, not just that code runs:

- **Physics:**
  - a trimmed aircraft stays trimmed;
  - coordinated turns turn at g·tan φ / V;
  - RK4 shows fourth-order convergence;
  - wind drift is exact.
- **Planning:**
  - runway choice and the semicircular rule;
  - the minimum en-route altitude;
  - leg geometry and approach geometry;
  - top of climb and descent;
  - fuel and reserves.
- **Full flights:** both directions in six winds, with:
  - no incidents and every phase in order;
  - touchdown in the touchdown zone below 360 fpm;
  - bank, stall-margin and terrain-clearance limits respected;
  - flown time and fuel close to plan.
- **Requests:** hold, resume and direct-to.
- **Systems:** fuel burn, gear and flap travel, and pressurization rate and differential limits.
- **Determinism:** bit-for-bit identical runs, and the same physics at any frame rate.

## Fast and accessible first

Every word of the portfolio is plain HTML that works without JavaScript. The 3D scene is an
enhancement and loads only on devices with real WebGL2 hardware:
- a software renderer or data-saver mode starts in Read with a still image and an opt-in;
- reduced motion starts the flight paused, with camera moves that cut instead of glide.

New sessions open in Fly. The choice is kept for the session, and a link to a section
opens Read at that section. Rendering pauses in background tabs, resolution adapts when
frames run long, and every Fly control is a labelled button that works from the keyboard.
