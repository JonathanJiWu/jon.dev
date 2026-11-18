---
title: C-130J and AC-130J pneumatics simulation
summary: A real-time C++ simulation of an aircraft pneumatic system, with a closed-loop auto-pressurization algorithm that regulates bleed air, cabin pressure and temperature.
kind: Professional
org: Military Visualizations Inc.
role: Software Engineer
period: 2021 – 2025
stack: [C++, Real-time systems, Physics modeling, Control systems, Numerical methods]
order: 1
---

## The problem

An aircraft's pneumatic system takes bleed air from the engines and distributes it to systems such as cabin pressurization and air conditioning. In a flight simulator, that behavior has to respond in real time to three things at once: what the crew does, the physics of the air, and the state of the simulated hardware. It also has to stay cheap enough to run every frame alongside everything else the simulator is doing.

## What I built

- Architected and implemented the pneumatics simulation system for the C-130J and AC-130J in C++.
- At its core is a closed-loop auto-pressurization algorithm that dynamically regulates bleed air distribution, cabin pressure and temperature in real time, against human inputs, numerical physics and hardware parameters.
- More broadly, I translated complex real-world aeronautical systems (pneumatics, hydraulics and avionics) into accurate, performant simulation logic, balancing physical fidelity against runtime constraints.

## Shipping it

I shipped best-selling add-ons for Microsoft Flight Simulator and Lockheed Martin's Prepar3D, and maintained zero codebase-breaking incidents across more than three years and hundreds of build iterations.
