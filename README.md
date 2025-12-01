# 🧠 Agent Builder

AutoDev Forge is a plug-and-play agent builder that ships with a guided setup wizard, one-click backend + dashboard runner, and a live builder console. No Roblox or game logic required.

## 🚀 Quick Start
1. Install dependencies:
   - `npm install`
   - `npm --prefix dashboard install`
2. Generate the environment defaults: `npm run regen-env`
3. Launch everything for development: `npm run start-app`
4. Visit `http://localhost:3000` and complete the First-time Setup Wizard.

### Desktop app (Electron)
- Build the packaged desktop app (Windows): `npm run desktop:win`
- Run the Electron shell against your local build: `npm run desktop`
- The installer output lives in `release/AutoDev Forge Setup.exe` after packaging.

## Settings
- Use **Settings** to enter your OpenAI key, pick models, and toggle optional Ollama/vector/voice features.
- The wizard validates your key, runs diagnostics, rewrites `.env`, and auto-starts the backend.

## Building
- Start a build from the homepage or the **Templates** page.
- The Builder Console streams logs from `ws://localhost:8090/builder-stream` with filters, search, and progress.
- Outputs are saved to `./projects` and downloadable from the console actions.

## Helpful Scripts
- `npm run regen-env` – regenerate `.env` from saved settings
- `npm run start-app` – run backend + dashboard together

Enjoy the AutoDev Forge theme, rounded cards, and neon blue highlights for a beginner-friendly experience.
