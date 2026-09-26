# Workout Log

Personal workout logger. Installable web app (PWA) that runs on iPhone from the Home Screen, works offline, and keeps all data on the device.

**Live:** https://kirbygmod-stack.github.io/workout-log/

## Features (v1)
- Sections: Push, Pull, Legs, Abs, Bodyweight, Cardio
- Log weight × reps (lifts), reps + optional added weight (bodyweight), time (planks), duration/speed/incline/calories (cardio)
- Rest timer runs automatically after each set; actual rest is recorded per set against a per-exercise target
- Last session's numbers shown inline and used to pre-fill the next set
- Per-exercise notes, history, exercise library editing
- JSON backup/restore (Settings)

## Development
```
npm install
npm run dev      # local dev server
npm run build    # production build → dist/
```
Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`.

Stack: Vite, React, TypeScript, Dexie (IndexedDB), vite-plugin-pwa.
