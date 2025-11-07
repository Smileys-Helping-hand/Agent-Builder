# 🧠 Agent Builder

A modular, autonomous multi-agent builder powered by OpenAI.
It can generate, design, test, and deploy apps from a single prompt.

## 🚀 Quick-Start

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
AI_PROVIDER=openai
OPENAI_API_KEY=sk-XXXX
PG_URL=postgres://user:pass@localhost:5432/agentbuilder
QUEUE_PROVIDER=redis
JWT_SECRET=change_me
PLAN=free
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
- **Dashboard Tabs:** Dashboard · Queue · Health · Security · Logs · Governance · Cluster · Plugins · Analytics
- **CLI:** `npm run shell` to open the interactive Agent Shell
- **SDK:** `src/sdk/DeveloperSDK.ts` for embedding into other apps

For a deeper walkthrough, see [`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md).

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
