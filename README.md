# 🐄 Grasshopper Pasture

A first-person pastoral sandbox built with three.js and Next.js. Roam an open
pasture, lift and carry creatures, mount the beasts, hunt when you get hungry,
collect loot, explore the cities and islands, and survive the night when the
wolves come out.

![stack](https://img.shields.io/badge/Next.js-15-000)
![stack](https://img.shields.io/badge/React-19-61DAFB)
![stack](https://img.shields.io/badge/three.js-0.128-000)

## Features

- **First-person 3D world** — pointer-locked mouse look, WASD movement, sprinting.
- **Lift & carry** — grab creatures and haul them around (progress toward all 13).
- **Mount & ride** the beasts, and travel tower floors.
- **Day / night cycle** (a full day ≈ 300s) with night wolves.
- **Survival** — 10 hearts, a hunger meter that drains over time, and dropped
  meat you can eat to refill it.
- **Loot chests** scattered across the map.
- **Cities & islands** to explore.
- **Weapons** — pistol, shotgun, rifle, and AK-47.
- **Admin & cheat console** for powers and fun.
- **Mobile touch controls** — virtual stick plus LIFT / JUMP / PUNCH buttons.
- **Distance-based culling** so large scenes stay smooth.

## Tech stack

- **Next.js** `^15.5.0` (App Router)
- **React** `^19.1.0`
- **three.js** `0.128.0`

## Getting started

> Requires Node.js 18+.

```bash
# 1. Install dependencies
npm install

# 2. Run the dev server (hot reload)
npm run dev

# 3. Open http://localhost:3000
```

### Production

```bash
npm run build   # build for production
npm start       # serve the production build
```

## Controls

| Key | Action |
| --- | --- |
| **W A S D** / **Arrows** | Move (forward / left / back / right) |
| **Mouse** | Look and aim (click the canvas to lock the pointer) |
| **Shift** | Sprint / faster fly |
| **Space** | Jump (or climb while flying) |
| **E** | Punch — or shoot when a gun is armed |
| **F** | Interact: lift & carry, mount, feed, eat dropped meat, open a chest, or dismount (context-sensitive) |
| **G** | Descend a tower floor (or mount a target while in admin) |
| **1 – 4** | Select weapon (pistol / shotgun / rifle / AK-47) |
| **P** | Open the admin panel |
| **V** | Toggle fly mode |
| **M** | Mute / unmute sound |
| **F2** | Toggle the cheat console |
| **Enter** | Submit a cheat (in the console) |
| **Esc** | Close the cheat console |

> **Cheat console (F2):** type `admin` to unlock powers, or enter a gun code to
> grab a weapon. The console hints you in — try `admin` for powers, or `guns`
> for weapons.

## Project layout

```
grasshopper/
├── app/
│   ├── layout.js          # Root layout, metadata, fonts (Nunito + Titan One)
│   ├── page.js            # Renders <Game/>
│   └── globals.css        # Global styles (extracted from the original HTML)
├── components/
│   └── Game.js            # Client component: canvas, HUD, menu, cheat box, touch
├── lib/
│   └── game.js            # The game engine (world, entities, loop, culling, HUD)
├── tools/
│   └── extract.js         # One-shot extractor from the original single-file HTML
├── jsconfig.json          # Path alias @/* -> ./*
├── next.config.mjs        # reactStrictMode: false (single WebGL context boot)
├── package.json
└── .gitignore
```

## About the extraction

This project began as a single self-contained HTML file. `tools/extract.js`
splits that file into a Next.js project:

```bash
node tools/extract.js <source.html>
#   <style>  ->  app/globals.css
#   <body>   ->  tools/body.html
#   <script> IIFE  ->  the game module (lib/game.js)
```

`next.config.mjs` keeps `reactStrictMode: false` on purpose — the game boots a
single WebGL context and registers global listeners once, and `components/Game.js`
also guards against a double boot, so the world starts exactly once.

## License

Private project.
