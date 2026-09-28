# Agent Builder API Reference

The REST API exposes orchestration controls for builds, collaboration, storyworld simulation, and training. All endpoints live under `http://localhost:4000/api/*` by default.

## Authentication

- Register or log in via `/api/auth/register` and `/api/auth/login` to obtain a JWT.
- Include `Authorization: Bearer <token>` for protected routes.

## Autonomous Build

The build pipeline. Each iteration generates code into a git-backed workspace,
then verifies it objectively (install, typecheck, build, test, lint) and
attempts bounded repairs against the real error output before scoring it.

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/api/autonomous/start` | Start a build. Body: `{ projectName, description, targetPlatforms?, qualityThreshold?, maxIterations?, profile?, maxRepairAttempts?, autoPackaging? }`. `profile` is `fast` \| `balanced` \| `deep`. |
| `GET`  | `/api/autonomous/active` | List running builds. |
| `GET`  | `/api/autonomous/:buildId/status` | Build status, config, and per-iteration scores. |
| `GET`  | `/api/autonomous/:buildId/iterations` | Full iteration history including verification reports. |
| `POST` | `/api/autonomous/:buildId/pause` | Pause after the current iteration. |
| `POST` | `/api/autonomous/:buildId/resume` | Resume a paused build. |
| `POST` | `/api/autonomous/:buildId/stop` | Stop and discard the run. |
| `GET`  | `/api/autonomous/hardware` | Detected CPU/RAM/VRAM and the recommended model rung. |

> The earlier `/api/build/*`, `/api/build-studio/*` and `/api/agent/run`
> pipelines were removed: none of them wrote generated code to disk or
> verified it. `GET /api/agent/tasks` remains read-only for historical records.

## Collaboration Hub

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/api/collab/create` | Create a collaboration room. Body: `{ room? }`. |
| `POST` | `/api/collab/join` | Join a room. Body: `{ sessionId, participant }`. |
| `GET`  | `/api/collab/snapshot` | Fetch current participants, diffs, and context. Query: `sessionId`. |
| `GET`  | `/api/collab/list` | List all sessions with latest snapshots. |
| `POST` | `/api/collab/context` | Update session context memory. Body: `{ sessionId, context }`. |

## StoryWorld & Simulation

Existing routes remain available for narrative orchestration, social graphs, and player simulation:

- `POST /api/storyworld/command`
- `GET /api/storyworld/events`
- `GET /api/storyworld/social/state`
- `GET /api/storyworld/players`
- `POST /api/storyworld/players`
- `POST /api/storyworld/goals`
- `POST /api/storyworld/simulation/control`

Refer to [`docs/STORYWORLD_ENGINE.md`](./STORYWORLD_ENGINE.md) and [`docs/SOCIAL_SIMULATION.md`](./SOCIAL_SIMULATION.md) for a detailed breakdown.

## Training & Feedback

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/api/train/start` | Consume feedback records, regenerate `data/train.jsonl`, and report dataset statistics. |
| `POST` | `/api/feedback` | Submit manual ratings or notes associated with tasks. |
| `GET`  | `/api/feedback` | List feedback entries (`?processed=true` optional). |

The `AutoUpdater` service runs in-process and publishes `feedback` events on the websocket channel whenever new records are processed.

## Websocket Events

Connect via Socket.IO (`subscribeToEvents` in `dashboard/lib/api.ts`). Payload types include:

- `log`, `task`, `feedback`, `analytics`, `marketplace`, `container`, `queue`, `health`, `security`
- `roblox_sync`, `collaboration`, `build`, `story`, `simulation`

Use these events to power dashboards, CLI monitors, or external automation.
