---
title: Cyberpunk 2D77
summary: A browser action platformer with roguelite runs. Three playable characters, eight enemy types and two multi-phase bosses, written in plain JavaScript, with 44 automated browser tests gating every deploy.
kind: Personal
period: 2021 – 2026
stack: [JavaScript, HTML5 Canvas, Web Audio, Playwright, GitHub Actions, Python]
order: 3
image: ../../assets/projects/cyberpunk-2d77.webp
imageAlt: Cyberpunk 2D77 mid-run. A neon pixel-art city at night with a giant billboard hologram, rooftop platforms and enemies on the street, under a HUD showing health, heat, the run timer and the countdown to the boss.
links:
  - label: Play it
    href: https://jonathanjiwu.github.io/Cyberpunk-2D77/
    kind: play
  - label: Source on GitHub
    href: https://github.com/JonathanJiWu/Cyberpunk-2D77
    kind: source
---

## The game

Cyberpunk 2D77 is a side-scrolling action platformer built around timed, roguelite runs. Each run goes like this:

1. Pick one of three Individual Contributors and two starting skills.
2. Drop into Cyber City.
3. Fight off growing hordes that drop XP. Every level-up offers three hardware upgrades: GPUs, CPUs, RAM and more.
4. At 2:30 the Overseer arrives. Once it falls, the Demon GOAT comes for the final fight.

You get three lives. The game plays on desktop with keyboard and mouse, and on phones and tablets with touch controls.

## Engineering

- **Plain JavaScript, no framework.** 22 modules over an HTML5 canvas cover the world, player, enemies, bosses, upgrades, input, rendering and sound.
- **Data-driven tuning.** Balance numbers live in `config.js`. Characters, enemies, bosses and upgrades live in `database.js`, so tuning the game doesn't mean touching game logic.
- **Sound generated in the browser.** The original darksynth soundtrack is generated live with Web Audio and gets nastier during boss fights. Audio unlocks correctly under browsers' autoplay rules.
- **Pixel art from code.** The enemies, both bosses, the billboard and the hardware cards are drawn by a Python script from ASCII pixel maps and shape helpers. All its randomness comes from fixed seeds, so re-running it produces byte-identical images.
- **Difficulty tuned with bots.** Bot runs play full games with each character to tune the curve. The bots always beat the Overseer and win about five runs in six with every character.
- **44 automated browser tests.** Playwright plays the game in headless Chromium on a desktop and an emulated phone. The tests cover controls, every character's kit, both bosses through to a win, the leaderboard, the hacking terminal, real audio under Chrome's autoplay policy, and the touch controls. GitHub Actions runs them on every push and deploys to GitHub Pages only when they pass.

## Since 2021

The first commit landed in August 2021. Version 3.0, *The Individual Contributor Update*, shipped in November 2026 and added:

- bosses that fight like rival characters;
- three lives;
- hardware level-ups;
- a hacking minigame;
- a leaderboard.

The full history is in the repository's `PATCH_NOTES.md`.
