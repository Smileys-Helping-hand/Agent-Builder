# Agent Builder API Reference

The REST API exposes orchestration controls for builds, collaboration, storyworld simulation, and training. All endpoints live under `http://localhost:4000/api/*` by default.

## Authentication

- Register or log in via `/api/auth/register` and `/api/auth/login` to obtain a JWT.
- Include `Authorization: Bearer <token>` for protected routes.

## Build Engine

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/api/build/start` | Launch a new build job. Body: `{ prompt, mode?, autonomy?, repositories?, sessionId? }`. |
| `GET`  | `/api/build/status/:id` | Retrieve build status and step metadata. |
| `GET`  | `/api/build/history` | List recent builds ordered by last update time. |
| `POST` | `/api/build/cancel` | Cancel a build in-flight. Body: `{ id }`. |
| `POST` | `/api/build/merge` | Merge two repositories with the RepoMerger. Body: `{ sourceA, sourceB, strategy?, outputDir? }`. |
| `GET`  | `/api/project/export` | Enumerate exported build directories under `PROJECT_OUTPUT`. |

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
