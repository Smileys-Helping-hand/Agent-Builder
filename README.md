# Agent Builder

A local-first app builder, packager and maintainer. It runs on your own
hardware against a local Ollama model — no cloud credits, no API keys — and it
trades time for quality: a build is not finished because a model says so, but
because install, typecheck, build, test and lint all pass.

What it does:

- **Builds apps.** Describe one; it generates, installs, verifies and repairs it
  until the objective checks pass, keeping the best-scoring attempt.
- **Learns from its own failures.** Every fix becomes a lesson, retrieved the
  next time a similar error appears, and retired if it stops helping.
- **Researches continuously.** Give it a topic and it keeps reading, checks each
  finding against its source, and rewrites study documents as it learns.
- **Watches the whole machine.** It keeps a live picture of every project on
  your drives and exposes it to other agents (Jarvis included) so work can
  continue across sessions — see **[ECOSYSTEM.md](ECOSYSTEM.md)**.
- **Ships as a desktop app.** A Windows installer carrying its own API — see
  **[INSTALL.md](INSTALL.md)**.

## �🚀 Quick-Start

Agent Builder Ultra is a local-first multi-agent development environment.
It lets you design, build, and deploy complete applications through supervised AI orchestration — no cloud credits required.

### Requirements
- Node.js 20+
- npm 10+
- PostgreSQL with pgvector extension
- Redis or RabbitMQ (for queues)
- Rust & Cargo (for optional Tauri desktop app)
- Optional: Ollama or LM Studio for local model inference

### Clone & Install
```bash
git clone https://github.com/<your-org>/agent-builder-ultra.git
cd agent-builder-ultra
npm install
npm --prefix dashboard install
npm install --prefix src-tauri
```

### Configure

Create a `.env` file at the repo root and populate the core settings:

```bash
cp .env.example .env
```

```env
AI_PROVIDER=ollama # or openai / lmstudio
MODEL=llama3
OPENAI_API_KEY=sk-XXXX
PG_URL=postgres://user:pass@localhost:5432/agentbuilder
QUEUE_PROVIDER=redis
JWT_SECRET=change_me
PLAN=free
VOICE_ENABLED=true
TTS_ENGINE=edge-tts
AUTONOMY_LEVEL=semi
BUILD_MODE=app
PROJECT_OUTPUT=./projects
AUTO_DEPLOY=false
MERGE_MODE=semantic
QA_ON_MERGE=true
GAME_MODE=roblox
TRAINING_ENABLED=true
AUTO_LEARN=true
ROBLOX_SYNC_ENABLED=true
COLLAB_PORT=35000
CLOUD_SYNC=false
WORLD_MEMORY_DB=./data/storyworld/worldmemory.db
VOICE_NARRATOR_VOICE=en-US-GuyNeural
STORYWORLD_ENABLED=true
STORYWORLD_SIMULATION_ENABLED=true
STORYWORLD_TICK_MS=60000
COGNITIVE_NPC_INTERVAL_MS=45000
AI_PLAYER_SIMULATION=true
MAX_AI_PLAYERS=10
PLAYER_GOAL_INTERVAL=60000
NARRATE_PLAYER_EVENTS=true
```

### Build & Verify
```bash
npm run verify
```

### Run

**Backend →**
```bash
npm run start
```

**Dashboard →**
```bash
npm --prefix dashboard run dev
```

Visit <http://localhost:3000>

### Explore
- **Dashboard Tabs:** Overview · Build · Voice · Collaborate · AutoCode · Game · NPC AI · Terrain · StoryWorld · Social · Simulation · Players · Queue · Health · Security · Logs · Governance · Cluster · Plugins · Analytics
- **CLI:** `npm run shell` to open the interactive Agent Shell
- **SDK:** `src/sdk/DeveloperSDK.ts` for embedding into other apps

For a deeper walkthrough, see [`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md).
To orchestrate persistent lore, quests, and narration, read the [`StoryWorld Orchestrator guide`](docs/STORYWORLD_ORCHESTRATOR.md).
To operate the autonomous simulation loop, explore the [`StoryWorld Engine guide`](docs/STORYWORLD_ENGINE.md).
For multi-agent dialogue, social graphs, and diplomacy loops, review the [`Social Simulation guide`](docs/SOCIAL_SIMULATION.md).
To direct AI player cognition and global goals, check the [`AI Player Simulation guide`](docs/AI_PLAYER_SIMULATION.md).
Automated build orchestration, repo merging, and deployment tips live in [`docs/BUILD_AUTOMATION.md`](docs/BUILD_AUTOMATION.md) and [`docs/REPO_MERGE_GUIDE.md`](docs/REPO_MERGE_GUIDE.md).
For collaborative rooms, context memory, and human/AI pair programming, reference [`docs/COLLABORATION_ROOMS.md`](docs/COLLABORATION_ROOMS.md).
Voice-first planning plus the external SDK/API surface are covered in [`docs/BUILD_AUTOMATION.md`](docs/BUILD_AUTOMATION.md) and [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md).
For continuous learning loops driven by `data/feedback.jsonl`, see [`docs/CONTINUOUS_LEARNING.md`](docs/CONTINUOUS_LEARNING.md).

> 🛡️ **Need a supervised walkthrough?** Follow the step-by-step checklist in
> [`docs/SUPERVISED_BOOTSTRAP.md`](docs/SUPERVISED_BOOTSTRAP.md) to recreate the
> environment manually without executing any scripts automatically.

### 🔌 Model routing

Agent Builder can target OpenAI, Ollama, or LM Studio through the built-in model router. Configure the provider via env vars:

```env
MODEL_PROVIDER=openai # or "ollama" / "lmstudio"
OPENAI_MODEL=gpt-4-turbo
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3
LMSTUDIO_BASE_URL=http://localhost:1234
LMSTUDIO_MODEL=gpt-4o-mini
```

When using Ollama or LM Studio, ensure their local servers are running. The router falls back to OpenAI if the provider is unknown.

Run with a custom prompt via the CLI:

```bash
npm run cli -- "Build a React dashboard with Node.js backend and PostgreSQL"
```

Start the API server (after compiling with TypeScript):

```bash
npm run build
npm start
```

## 📊 Mission Control Dashboard

The repository ships with a Next.js dashboard for launching prompts, reviewing agent results, and monitoring the live event stream.

```bash
cd dashboard
npm install
cp .env.local.example .env.local # optional, set NEXT_PUBLIC_API_URL
npm run dev
```

By default the dashboard targets `http://localhost:4000`. Update `NEXT_PUBLIC_API_URL` if you expose the API elsewhere.

### 🧭 Dashboard Tabs

| Tab | Purpose |
| --- | --- |
| **Overview** | Launch prompts, monitor tasks, inspect memory, and stream live logs. |
| **Graph** | Visualize the multi-agent DAG planned by the orchestrator, including dependencies and duration telemetry. |
| **Marketplace** | Browse catalogued plugins, request installs, and approve manual rollouts with role-based access control. |
| **Analytics** | Review usage metrics, RL feedback insights, and manage sandbox container runs that require manual approval. |
| **Queue** | Inspect broker connectivity, queue depth, distributed cluster nodes, and publish diagnostic messages. |
| **Health** | View consolidated health snapshots sourced from the runtime, queue adapter, vector memory, and policy engine. |
| **Security** | Explore the active `policy.yaml`, validate sandbox requests, and audit enforcement outcomes. |
| **Governance** | Review consent records, capture manual approvals, and audit compliance events emitted by the agents. |
| **Controls** | Prototype voice + AR hooks for issuing natural-language or gesture commands into the orchestrator loop. |
| **Build** | Coordinate Builder/QA/Ops/Roblox agents with the unified Build Engine and Hustle Studio merger. |
| **Voice** | Drive the Voice Flow pipeline, narrate status updates, and launch hands-free builds. |
| **AutoCode** | Chat-driven file inspection, guided edits, and microphone-enabled workflows backed by the AutoCode engine. |
| **Game** | Generate Roblox experiences, inspect Lua assets, and export `.rbxlx` packages for Roblox Studio. |
| **Collaborate** | Launch multiplayer rooms, invite teammates, sync shared context memory, and stream live diff snapshots. |
| **NPC AI** | Generate Luau behaviour scripts for dialogue, patrol, and shop NPCs with live sync to Studio. |
| **Terrain** | Produce procedural terrain scripts with optional seeds and biome presets. |
| **StoryWorld** | Direct persistent lore, quests, and factions. Commands feed the WorldMemory graph and optional narration. |
| **Social** | Inspect faction diplomacy, social graphs, and NPC-to-NPC dialogue loops. |
| **Simulation** | Observe autonomous NPC cognition, faction influence shifts, and control the world tick cadence. |
| **Players** | Manage autonomous AI adventurers, assign world goals, and monitor their resources. |
| **Logs** | Browse structured JSON logs persisted by the orchestrator for quick triage and export. |

### 🔔 Observability & Metrics

* `npm run build && npm start` bootstraps OpenTelemetry with a Prometheus exporter (configurable via `METRICS_PORT`/`METRICS_ENDPOINT`).
* `/api/health` returns a composite snapshot covering runtime load, queue connectivity, vector memory status, and policy revisions.
* Structured logs are captured in `data/logs.json` and exposed via `GET /api/logs` (viewer+ role).

### 📨 Queue Adapters

Set `QUEUE_PROVIDER` to `memory`, `redis`, `nats`, or `rabbitmq`. When pointed at Redis/NATS/RabbitMQ, the adapter auto-connects using the corresponding `*_URL` environment variables and emits queue events to the dashboard. Enable distributed coordination with `QUEUE_CLUSTER_MODE=true` to register multi-node workers that surface in the Queue tab. Authenticated editors can publish diagnostic payloads with one click.

### 🌿 Adaptive Graphs & Eco Mode

The new `AdaptiveGraphOptimizer` restructures TaskPlanner output before execution, clustering agent phases and, when `ECO_MODE=true`, prioritising low-energy operations. A companion `GeneticBuildPlanner` runs a dry-run genetic search to score alternate DAG permutations for future optimization work.

### 🧑‍⚖️ Governance & Consent

Governance events are written to `data/governance.json` and exposed via `/api/governance/*`. Use the dashboard Governance tab to review audit logs, capture consent scopes, and maintain compliance evidence for manual overrides.

### 🗣️ Voice & AR Control Hooks

Prototype voice commands and AR gestures using `/api/controls/voice` and `/api/controls/gestures`. The new dashboard Controls tab lets authenticated operators record sample inputs that flow through the orchestration event bus.

### 🧵 AutoCode Chat & Offline Fine-Tuning

The AutoCode tab exposes a multi-turn chat interface that can inspect files, propose edits, and stage commits. Enable the microphone toggle to drive conversations hands-free (see [`docs/VOICE_GUIDE.md`](docs/VOICE_GUIDE.md)). Each turn is persisted to vector memory so the orchestrator can recall prior context. Collected feedback flows into `LocalTrainer`, which generates `data/train.jsonl` for Ollama or LM Studio fine-tuning via `POST /api/train/start`.

### 🎮 Roblox Game Builder

Switch to the Game tab to produce fully-scripted Roblox experiences. Behind the scenes the new `RobloxAgent` stitches Lua templates from `templates/roblox/`, summarizes your prompt, and can export the project as an `.rbxlx` archive for Roblox Studio. Learn more in [`docs/ROBLOX_BUILDING.md`](docs/ROBLOX_BUILDING.md) and enable live Studio mirroring with the [`ROBLOX_STUDIO_SYNC`](docs/ROBLOX_STUDIO_SYNC.md) guide.

### 🤝 Collaborative Sessions

The Collaborate tab pairs the Socket.IO collaboration server with the dashboard. Create sessions, invite teammates, and track live cursors and diffs inside the panel. Configuration and troubleshooting steps live in [`docs/COLLABORATION_GUIDE.md`](docs/COLLABORATION_GUIDE.md).

### 🧟 NPC AI Agent

Generate Luau NPC scripts directly from prompts using the NPC AI tab. The `NpcAgent` stores each script under `games/roblox/npcs/` and pushes updates to Roblox Studio automatically when the bridge is connected. Review the behaviour templates and usage tips in [`docs/NPC_AI_GUIDE.md`](docs/NPC_AI_GUIDE.md).

### 🏔️ Procedural Terrain Generator

The Terrain tab wraps the `TerrainGenerator` utility for crafting mountains, deserts, and volcanic biomes with optional seeds. Generated scripts are saved under `games/roblox/terrain/` and synced via the bridge. See [`docs/TERRAIN_GENERATOR.md`](docs/TERRAIN_GENERATOR.md) for presets and best practices.

### 🛡️ Policy Engine & Sandbox Manager

The runtime loads `policy.yaml` through the new `PolicyEngine`, enforcing guardrails before container runs or queue publications. Use the Security tab (or `GET /api/security/policies`) to audit rules and `POST /api/security/validate` to simulate requests.

### 🗂 Template Library, Diff Viewer & Rollbacks

Persist reusable scaffolds with `POST /api/templates`, compute diffs via `POST /api/diff`, and restore past task snapshots from the rollback archive (`GET /api/rollbacks`). The Template Library integrates with the dashboard for quick reuse during orchestrations.

### 🔔 Notifications

Optional Slack and GitHub integrations trigger on orchestration completion. Configure `SLACK_WEBHOOK_URL`, `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, and `GITHUB_BRANCH` to forward summaries or open pull requests automatically.

## 🧩 SDK
```ts
import { AgentBuilder, DeveloperSDK } from "@agentx/sdk";

// Direct orchestration
const builder = new AgentBuilder();
await builder.create("Build a dashboard");

// Remote orchestration from another app
const sdk = new DeveloperSDK({ apiUrl: "https://agent.example.com", token: process.env.AGENT_TOKEN });
const tasks = await sdk.run("Prototype a design system");
```

## 🔄 Live Updates & Monitoring

With the development server running, send follow-up instructions to refine existing tasks without restarting the orchestrator:

```bash
curl -X POST http://localhost:4000/api/agent/update \
  -H "Content-Type: application/json" \
  -d '{"taskId":"<existing-task-id>","instruction":"Tweak the UI copy to be more formal."}'
```

The dashboard automatically connects to the Socket.IO gateway exposed by the API server to stream task changes and orchestrator logs in real time.

## 🧠 Vector Memory & Semantic Recall

Enable pgvector-backed memory to persist agent outputs and run semantic search:

```env
PGVECTOR_URL=postgres://user:pass@localhost:5432/agent
PGVECTOR_TABLE=agent_memory
OPENAI_EMBEDDING_MODEL=text-embedding-3-large
```

Once configured, each completed task is embedded and stored automatically. The dashboard's **Memory Browser** lets you query recent records or run similarity search (requires authentication). API endpoints:

* `GET /api/memory/recent` – latest vector records.
* `POST /api/memory/search` – semantic search (requires bearer token).

## 🔌 Plugin Registry

Drop-in agents can be registered through `agent.config.json`:

```jsonc
{
  "plugins": [
    {
      "path": "./plugins/DocsAgent.js",
      "metadata": {
        "name": "Docs Agent",
        "agentType": "DocsAgent",
        "description": "Generates comprehensive documentation.",
        "defaultTask": "Author documentation for {{prompt}}"
      }
    }
  ]
}
```

Each plugin module should export `createAgent()` or a default class extending `BaseAgent`. Registered agents automatically appear in the dashboard's **Plugin Gallery** and receive tasks when planners emit matching `agentType` values.

### 🧠 Optional “Sora” Assets

If you maintain Sora-related media or models, store them under `assets/sora/` and load them via a dedicated helper such as `src/tools/SoraLoader.ts`. Keeping these resources outside the runtime keeps packaging simple and avoids shipping large binaries with the core orchestrator.

## 🛰️ Graph Engine & DAG Execution

`TaskPlanner` now annotates each task with dependencies which feed into the `GraphEngine` for multi-agent DAG execution. The orchestrator emits live events for task start, completion, and failure, allowing the **Graph** dashboard tab to render the dependency graph with timing metadata.

## 🛒 Plugin Marketplace & Approvals

The API exposes a secure plugin marketplace with manual approval flow:

* `GET /api/marketplace/catalog` – list available plugins (requires auth).
* `POST /api/marketplace/install` – request an install; some plugins require an admin/owner to approve.
* `POST /api/marketplace/approve` – approve a pending request (admin/owner only).

Approved installs are persisted back into `agent.config.json` so future restarts automatically hydrate the plugin registry.

## 📝 Feedback Loop & Fine-Tuning

The new `FineTuner` captures user feedback in `data/feedback.json`. Submit entries via the dashboard or directly through the API:

```bash
curl -X POST http://localhost:4000/api/feedback \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"taskId":"<id>","rating":5,"notes":"Great UI polish."}'
```

The `AutoUpdater` processes unhandled feedback on a schedule (`AUTO_UPDATER_INTERVAL_MS`) and emits live updates over Socket.IO, ready to feed back into fine-tuning workflows.

The `RLTrainer` module aggregates this feedback to compute agent scores, tag histograms, and issue reports surfaced through the analytics endpoint.

## 🔐 Workspace Authentication

Use JWT-based auth to protect advanced endpoints:

```env
JWT_SECRET=super-secret-key
AUTH_TOKEN_EXPIRES_IN=1h
DEFAULT_TEAM_NAME="Core Team"
```

Register or log in from the dashboard **Workspace Access** card. Tokens are stored locally and automatically attached to feedback and vector-search requests. Programmatic access is available via:

* `POST /api/auth/register`
* `POST /api/auth/login`
* `GET /api/auth/me`

Users now belong to teams with explicit roles (`owner`, `admin`, `editor`, `viewer`). Protected routes use `authorizeRoles` middleware so only privileged users can install plugins, approve sandbox runs, or view analytics.

## 📈 Analytics & Reinforcement Insights

`GET /api/analytics/usage` (viewer+ role) returns task throughput, duration telemetry, vector-memory status, and reinforcement-learning insights derived from feedback logs. The dashboard **Analytics** tab renders these metrics and refreshes on demand.

## 🧪 Docker Sandbox & Manual Approval

The `containers.ts` service provides a lightweight Docker sandbox queue backed by JSON storage. Requests submitted via `POST /api/containers/run` start in a `pending` state and emit WebSocket events. Administrators approve and execute runs through `POST /api/containers/:id/approve`, simulating execution with captured logs. The dashboard exposes this workflow alongside analytics, enabling manual verification before potentially destructive operations.

## 💻 Desktop Packaging with Tauri

Ship the dashboard as a desktop app using the bundled Tauri scaffold under `src-tauri/`:

```bash
# Install Rust + Tauri prerequisites first
cargo tauri dev   # launches the Next.js dashboard in a desktop shell
cargo tauri build # produces native installers
```

The configuration launches the existing Next.js dashboard (`npm run dashboard` in dev, `npm --prefix dashboard run build` for production) and wraps it in a 1280×800 mission control window.
