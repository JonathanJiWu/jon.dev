---
title: Isles of Resistance
summary: A turn-based air-defense strategy game in Godot. Defend a procedurally generated archipelago against an AI that adapts to your defenses, on a deterministic simulation core tested by bots that play whole campaigns.
kind: Personal
period: 2025 – 2026
stack: [Godot 4.4, GDScript, Game AI, Procedural generation, GitHub Actions, NSIS]
order: 2
image: ../../assets/projects/isles-of-resistance.webp
imageAlt: The Isles of Resistance battle screen. A hex-map archipelago with flak batteries and a radar station around the capital, the construct panel on the left and an enemy-intel report on the right.
links:
  - label: Download for Windows
    href: https://github.com/JonathanJiWu/Isles-of-Resistance/releases/latest
    kind: download
  - label: Source on GitHub
    href: https://github.com/JonathanJiWu/Isles-of-Resistance
    kind: source
---

## The game

Isles of Resistance is a single-player, turn-based defense game set in a fictional archipelago, and every campaign generates a new hex map from a seed. On your turn you build air defenses, research weapons, fly squadrons and launch operations. In the enemy phase, waves of drones, fighters, gunships, heavy bombers, cruise missiles and stealth bombers fly at your islands while your defenses fire automatically. You win by surviving every wave or sinking every enemy carrier, and lose if your capital falls.

## Systems worth a look

- **A deterministic simulation core.** The game logic lives in `Scripts/core`, independent of the engine: campaign, game state, map generation, pathfinding and enemy AI. It emits event streams that the view layer animates, so the rules never depend on how a frame is drawn.
- **An enemy with its own fog of war.** The AI knows only what its aircraft have seen, plus any defense that fired at them. It routes around known air defenses, remembers where it took losses, shifts its approach between waves, and rebalances each wave against your favorite weapons. Every wave arrives with an intelligence report on how it's adapting.
- **Altitude and terrain that matter.** Flak shreds low flyers but barely touches high bombers, SAMs are the opposite, and lasers hit everything. Radar coverage adds accuracy to every weapon in range. Hills extend weapon range, forests hide structures, and mountains carry long-range radar and force low flyers to detour.
- **A campaign that feeds back into the rules.** Four acts of political directives, each with explicit consequences for supplies, research, enemy wave strength and what the enemy knows.
- **No external assets.** All art is procedural vector drawing, and every sound is synthesized in code. Three procedurally composed music cues crossfade between planning and battle.

## Tested like a simulation

- A headless GDScript test suite plays simulated full campaigns, and a rendered mouse-and-keyboard playtest drives the real interface.
- The four difficulty levels were tuned with simulated campaigns, so each one ramps evenly.
- GitHub Actions runs the suite on every push. Pushing a version tag builds Windows x64 and ARM64 installers, plays the exported game, and publishes a GitHub release with SHA-256 checksums.
- The game runs on Godot's GL Compatibility renderer for modest GPUs, and falls back to Direct3D 11 where OpenGL isn't available, as on many ARM laptops.
