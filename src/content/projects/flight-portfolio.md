---
title: This site, a flight model in the browser
summary: The aircraft behind these pages flies a point-mass flight model and a three-loop autopilot, stepped at a fixed 120 Hz with RK4 and drawn with Three.js.
kind: Personal
period: '2026'
stack: [TypeScript, Three.js, WebGL2, GLSL, Astro, Vitest]
order: 2
links:
  - label: Source on GitHub
    href: https://github.com/JonathanJiWu/jon.dev
---

## Why a flight model

Instead of describing real-time simulation, this site runs one. Each section of the home page is a waypoint on a flight plan. Scroll to a section and the autopilot flies direct to its waypoint, then enters a standard right-hand hold until you move on. The **engineering view** shows the forces, the control loops and the timing as they happen.

## Architecture

The code is split so that the physics never knows it is being drawn:

```text
src/sim     flight model, guidance, autopilot      plain TypeScript: no DOM, no three.js
src/world   terrain and route                      pure functions, shared by physics and graphics
src/scene   rendering                              reads the simulation, never writes to it
```

Because the simulation has no rendering dependency, it is tested in Node, and the same terrain function that builds the mesh also feeds the autopilot's terrain-clearance check, so the two can never disagree.

## The flight model

A three-degree-of-freedom point mass in wind axes, over a flat Earth with no wind, in the International Standard Atmosphere:

```text
m·dV/dt         = T·cos α − D − m·g·sin γ
m·V·dγ/dt       = (L + T·sin α)·cos φ − m·g·cos γ
m·V·cos γ·dψ/dt = (L + T·sin α)·sin φ

L = q·S·CL(α)    D = q·S·(CD0 + k·CL²)    q = ½·ρ(h)·V²
```

Bank angle, angle of attack and engine output each follow their commands through first-order lags, with a roll-rate limit. That stands in for the inner attitude loops a full six-degree-of-freedom model would resolve. The parameters describe a generic four-engine turboprop transport, with round, plausible numbers rather than data for any real type.

## Guidance and control

- **Guidance.** Vector fields for straight-line and circular-orbit following, after Beard and McLain's *Small Unmanned Aircraft*. A "direct to" draws a line from present position to the waypoint; inside 1.3 hold radii the aircraft switches to the orbit field.
- **Lateral loop.** Course error to bank command, with the steady-turn bank (tan φ = V²/gR) fed forward on the hold, limited to 30°.
- **Vertical loop.** Altitude error to flight-path angle, then angle of attack by inverting the γ equation for the lift required, including the extra lift a banked turn needs, plus an integral trim for whatever the model gets wrong.
- **Speed loop.** Drag-and-climb feedforward on throttle, with PI correction and anti-windup.
- **Terrain clearance.** The commanded altitude is raised whenever the ground up to 2.5 km ahead would come within 220 m.

## The real-time loop

Physics runs at a fixed 120 Hz with fourth-order Runge–Kutta, and the autopilot at 60 Hz, holding its outputs between updates like a flight control computer. Each animation frame banks its wall-clock time into an accumulator, runs however many fixed steps that covers, and renders an interpolation between the last two states. A long frame, such as returning from a background tab, can't trigger a spiral of catch-up steps. The integrator allocates nothing per step, so garbage collection never causes a hitch.

## Tested like a simulation

The test suite checks the properties that matter for a simulation, not just that code runs:

- a trimmed aircraft stays trimmed;
- a coordinated turn turns at g·tan φ / V;
- RK4 error falls about sixteen-fold when the step is halved;
- two runs are bit-for-bit identical;
- jittery frame times give exactly the same physics as fixed steps;
- every waypoint is captured and held without exceeding bank, stall-margin or terrain-clearance limits.

## Fast and accessible first

Every word on the site is plain HTML that works without JavaScript. The 3D scene is an enhancement: it loads only on devices with real WebGL2 hardware. Software renderers, reduced-motion preferences and data-saver mode get a still image instead, with an opt-in. Rendering pauses in background tabs, and resolution adapts when frames run long.
