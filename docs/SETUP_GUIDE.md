# 🧰 Setup & Installation Guide

## 1. System Preparation
1. Install **Node.js 20+** and **npm 10+**.
2. Install **PostgreSQL** and enable **pgvector**:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
3. Start **Redis**, **RabbitMQ**, or **NATS** for queues.
4. *(Optional)* Install **Ollama** or **LM Studio** for local models.
5. *(Optional)* Install **Rust + Cargo** for the desktop build.

## 2. Clone and Install
```bash
git clone https://github.com/<your-org>/agent-builder-ultra.git
cd agent-builder-ultra
npm install
npm --prefix dashboard install
npm install --prefix src-tauri
```

## 3. Environment Configuration
Copy `.env.example` → `.env` and fill in:
```env
AI_PROVIDER=openai
OPENAI_API_KEY=sk-XXXX
PG_URL=postgres://user:pass@localhost:5432/agentbuilder
QUEUE_PROVIDER=redis
JWT_SECRET=change_me
PLAN=free
```

## 4. Database Setup
```bash
psql -U postgres -c "CREATE DATABASE agentbuilder;"
psql -d agentbuilder -f ./scripts/schema.sql
```

## 5. Build & Verify
```bash
npm run verify
```
* Confirms both backend & dashboard compile.
* Runs lint checks and dependency audit.

## 6. Running the Platform
```bash
npm run start                   # Start backend server
npm --prefix dashboard run dev  # Start dashboard
```
Access the dashboard at <http://localhost:3000>.

## 7. Assets & Project Structure
| Directory | Purpose |
| --- | --- |
| `src/` | Core runtime, orchestrator, agents |
| `dashboard/` | Next.js Mission Control UI |
| `src-tauri/` | Tauri desktop build |
| `policy.yaml` | Security policy definitions |
| `data/` | Persistent data, memory, feedback |
| `logs/` | Structured JSON logs |
| `docs/` | Documentation & setup guides |

## 8. Optional Desktop Packaging
```bash
cd src-tauri
cargo tauri build
```
Generates binaries in `src-tauri/target/release/`.

## 9. Verification Checklist
- `npm run verify` completes with ✅
- `curl http://localhost:4000/api/health` returns JSON
- Dashboard tabs load correctly
- Agents execute in dry-run mode first
- Logs appear under `/logs` and telemetry in `/metrics`

## 10. Common Issues
| Symptom | Fix |
| --- | --- |
| Build fails | Ensure Node 20+, npm 10+, correct TypeScript target |
| pgvector error | `CREATE EXTENSION vector;` |
| Queue timeout | Verify Redis/NATS/RabbitMQ is running |
| Dashboard blank | `npm --prefix dashboard run build` |
| Auth failure | Update `JWT_SECRET` & restart |

## 11. Next Steps
- Read `docs/SUPERVISED_BOOTSTRAP.md` for operational flow.
- Add custom agents under `src/agents/`.
- Adjust `policy.yaml` for tighter control.
- Explore Developer SDK in `src/sdk/`.
