# Build Automation & Unified Builder Mode

The v12 release introduces the **BuildEngine**, a central orchestrator that coordinates Builder, QA, Ops, UX, Roblox, and StoryWorld agents from a single command. This guide explains how to launch builds, monitor progress, and integrate voice-driven planning.

## Quick Start

1. Ensure the backend is running (`npm run start`).
2. Open the dashboard and switch to the **Build** tab.
3. Describe your desired app, game, or hybrid experience. Example prompts:
   - `Create a SaaS billing dashboard with Stripe webhooks and admin metrics.`
   - `Generate a Roblox obby with checkpoints, NPC helpers, and live Studio sync.`
   - `Fusion mode: build a fitness tracker that mirrors player morale from the StoryWorld simulation.`
4. Optionally provide repository paths (comma separated) to merge or reuse existing projects. Hustle Studio archives can be unpacked and pointed at the engine.
5. Choose the autonomy tier:
   - `manual` — every step pauses for confirmation.
   - `semi` — proposed edits stream to the dashboard for approval (default).
   - `full` — the engine runs end-to-end, including optional deployment hooks.

## Voice Flow Integration

When **VoiceFlowController** is enabled (`VOICE_ENABLED=true`), microphone commands will:

1. Transcribe via Whisper/edge-tts.
2. Route through `VoicePlanner` to generate a JSON build plan.
3. Dispatch to `BuildEngine.startBuild`, automatically populating the Build tab and narrating progress if `TTS_ENGINE` is configured.

Use narrator mode for hands-free updates:
```ts
import { VoiceFlowController } from "src/voice/VoiceFlowController";
VoiceFlowController.enableNarratorMode(true);
```

## Monitoring Progress

Each build emits structured events over `/api/build/history` and the websocket event bus (`type: "build"`). The Build tab surfaces:

- Current status (`planning`, `running`, `merging`, `testing`, `deploying`, `completed`).
- Step-by-step agent assignments, logs, and timestamps.
- Exported project directories written under `PROJECT_OUTPUT` (defaults to `./projects`).
- Merge summaries saved to `merge-summary.md` whenever Hustle Studio archives or repositories are fused.

To query programmatically:

```bash
curl -H "Authorization: Bearer <token>" http://localhost:4000/api/build/history
```

## Autonomy & Deployment

Control autonomy via environment variables:

```env
AUTONOMY_LEVEL=semi
BUILD_MODE=app
PROJECT_OUTPUT=./projects
AUTO_DEPLOY=false
MERGE_MODE=semantic
QA_ON_MERGE=true
```

- `MERGE_MODE=semantic` keeps conflict copies with a `.incoming` suffix.
- Set `AUTO_DEPLOY=true` and plug in deployment hooks (Docker/GitHub) to trigger OpsAgent once QA passes.

## Feedback Logging

Every build writes summaries to `data/feedback.jsonl`. The `AutoUpdater` and `LocalTrainer` consume this feed to grow `data/train.jsonl` for LoRA/Ollama fine-tuning. To manually refresh the dataset:

```bash
curl -X POST -H "Authorization: Bearer <token>" http://localhost:4000/api/train/start
```

## API Endpoints

See [`docs/API_REFERENCE.md`](./API_REFERENCE.md) for a complete list of REST endpoints, including:

- `POST /api/build/start` — launch a new build.
- `GET /api/build/status/:id` — inspect a specific job.
- `POST /api/build/cancel` — request cancellation.
- `POST /api/build/merge` — invoke the RepoMerger directly.
- `GET /api/project/export` — list generated artifacts.

## Tips

- Attach a collaboration session ID to broadcast build updates into a shared room.
- Use `Voice` tab narration to keep stakeholders updated without leaving the command console.
- Exported builds include `merge-summary.md` and `feedback.jsonl` references for reproducibility.
