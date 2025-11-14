# Roblox Game Builder

The Agent Builder Ultra dashboard ships with a dedicated Roblox tab for generating playable prototypes. It combines handcrafted Lua templates with the new `RobloxAgent`, which can summarize prompts, stitch scripts, and deliver `.rbxlx` packages.

## Quick Start

1. Open the **Game** tab in the dashboard.
2. Choose a starter template (Obby, Tycoon, Shooter, or Racing).
3. Enter a short description of the experience you want to build.
4. Click **Generate** to create a bundle of Lua scripts and metadata.
5. Optionally export the experience as an `.rbxlx` file and open it in Roblox Studio.

## Templates

Starter templates live under `templates/roblox/`:

- `obby.lua` – checkpoint-based obstacle course.
- `tycoon.lua` – incremental factory with cash accrual.
- `shooter.lua` – projectile combat loop.
- `racing.lua` – lap tracking with live leaderboard events.

Feel free to add more templates to the directory; the agent will automatically load them on startup.

## API Endpoints

| Endpoint | Description |
| --- | --- |
| `GET /api/roblox/templates` | Lists available templates. |
| `POST /api/roblox/generate` | Generates a Roblox experience from a template + prompt. |
| `POST /api/roblox/export` | Encodes assets as a downloadable `.rbxlx` file. |

All routes require authentication with at least viewer privileges.

## Tips

- Configure `GAME_MODE=roblox` and `AUTONOMY_LEVEL=semi` in your `.env` to surface Roblox-specific UI quickly.
- When exporting, the dashboard streams a base64 payload to the browser; the download link remains available until you navigate away from the tab.
- Vector memory captures each generation request, allowing the orchestrator to reuse context for follow-up prompts.
