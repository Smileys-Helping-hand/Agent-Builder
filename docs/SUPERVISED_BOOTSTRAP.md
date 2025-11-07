# Agent Builder Ultra – Supervised Bootstrap Script

> **Important:** These commands are designed for supervised, step-by-step execution. Read each section fully before copying commands into your terminal, confirm the outcome, and proceed only when you are satisfied with the results.
>
> Do **not** pipe this file directly into a shell or execute it unattended.

---

## 1. Verify Environment

Confirm the prerequisites are installed and available on your PATH:

- Node.js 20 or later (`node --version`)
- npm 10 or later (`npm --version`)
- PostgreSQL with the `pgvector` extension
- Redis **or** RabbitMQ for queue integrations
- Optional local model hosts: Ollama or LM Studio
- Rust + Cargo (required for the desktop build through Tauri)

Document the versions you find so you can reference them during debugging.

---

## 2. Install Dependencies

Install workspace dependencies in sequence, checking for warnings or missing peer dependencies after each command:

```bash
npm install
npm --prefix dashboard install
npm install --prefix src-tauri
```

If you encounter issues, resolve them before moving on.

---

## 3. Build Verification

Run the full verification script to build both the backend and the dashboard:

```bash
npm run verify
```

Inspect the output for TypeScript or lint errors before continuing.

---

## 4. Launch Backend (Manual)

After the build succeeds, start the backend manually in a new terminal session:

```bash
npm run start
```

Ensure the process stays healthy and monitor logs for policy, queue, and memory initialization events.

---

## 5. Launch Dashboard (Manual)

In a separate terminal, start the dashboard:

```bash
npm --prefix dashboard run dev
```

Verify that it connects to the backend (defaults to `http://localhost:4000`).

---

## 6. Optional Desktop Build

Only attempt the desktop packaging step once you have confirmed the backend and dashboard work locally:

```bash
cd src-tauri
cargo tauri build
cd ..
```

Check the output directory for the generated artifacts.

---

## 7. Confirm API Endpoints

Use a REST client or `curl` to validate the key service endpoints:

- `http://localhost:4000/api/health`
- `http://localhost:4000/api/memory/search`
- `http://localhost:4000/api/queues`
- `http://localhost:4000/api/governance`

Record the responses (or screenshots) for future regression comparisons.

---

## 8. Confirm Dashboard Tabs

Load `http://localhost:3000` in a browser and verify that the following tabs render and respond as expected:

Dashboard · Queue · Health · Security · Logs · Governance · Cluster · Plugins · Analytics

Check live data feeds, Socket.IO connectivity, and authenticated features where applicable.

---

## 9. Environment Variables (`.env`)

Ensure your `.env` file contains the required configuration keys:

```env
AI_PROVIDER=openai
OPENAI_API_KEY=sk-XXXX
PG_URL=postgres://user:pass@localhost:5432/agentbuilder
QUEUE_PROVIDER=redis
JWT_SECRET=change_me
PLAN=free
```

Do not commit real secrets to version control.

---

## 🔟 Safe Testing Sequence

Follow this recommended order when exercising new functionality:

1. Run the orchestrator in dry-run mode.
2. Approve task graphs manually from the dashboard.
3. Observe telemetry panels and structured logs.
4. Test rollback and policy enforcement with sample tasks.
5. Keep RLTrainer in simulation mode until you review the generated actions.

Document any deviations or issues discovered during the process.

---

## ✅ Release Checklist

After verification:

- Commit your changes and tag `v10.0.0`.
- Enable the GitHub Actions workflow at `.github/workflows/build.yml`.
- Optionally publish the Developer SDK (`src/sdk`) to npm.

Always double-check release notes and environment parity before promoting to production.

---

### Notes

- The orchestrator, queue adapters, sandbox, policy engine, and supporting services already exist in the repository.
- Modify or extend files only when explicitly requested.
- Never execute generated code automatically without review.

