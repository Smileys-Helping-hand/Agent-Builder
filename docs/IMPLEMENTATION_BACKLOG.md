# Implementation backlog (the live tracker)

The directive of 22 November 2026: storage and resource management, Gaming Mode, Jarvis as
coordinator, local AI only, then intelligence and repair, the model laboratory, app and game
quality, controlled self-improvement and media. Each task: priority (P0 highest), dependencies,
status, who did it, when, the files, the tests and their result, blockers, and the next action.
Jarvis reads this file through `GET /api/system/backlog` (`backlog` action).

Status: **done** (tested), **in progress**, **next**, **blocked**, **later**.

## Phase 0: audit (done)

| ID | P | Task | Status | Agent | Start → done | Result |
|---|---|---|---|---|---|---|
| A0.1 | P0 | Git state and uncommitted work | done | Claude | 22 Nov 12:00 | Another session's uncommitted Unity router (server.ts, Logger.ts, VoiceController.ts, dashboard/) left untouched; only this work's files are committed. |
| A0.2 | P0 | Map what exists for resources | done | Claude | 22 Nov 12:10 | Game mode (`server/gameMode.ts`, `utils/GameMode.ts`), every background loop gated on it, `SystemResourceService` (CPU/RAM/GPU), Host Manager services, Jarvis bridge (`jarvisActions.ts`) and events (`JarvisClient.send`). Extended, not replaced. |
| A0.3 | P0 | Inventory disks, drives, games, NAS | done | Claude | 22 Nov 12:20 | 8 disks: 3 SSDs (all nearly full of games), 3 × 7,200 rpm, 2 × 5,400 rpm; 17 game libraries; NAS 192.168.31.201 answers SMB. See WORKSTATION.md. |
| A0.4 | P0 | Find hidden cloud AI | done | Claude | 22 Nov 12:30 | Router fallbacks to Gemini/Anthropic/OpenAI for some roles; Settings offered Claude/OpenAI; **vector memory sent task results to OpenAI embeddings** (PGVECTOR_URL is set). All closed in S1.6. |

## Phase 1: storage and system resources

| ID | P | Task | Depends | Status | Start → done | Files | Tests | Next |
|---|---|---|---|---|---|---|---|---|
| S1.1 | P0 | Storage inventory: disks by kind (not letter), drives, Steam/Epic libraries from manifests, Agent Builder's pieces, NAS check, sizes on request, write benchmark | A0.3 | done | 22 Nov 12:20 → 13:10 | `src/system/StorageInventory.ts` | test:system 2 checks + LIVE inventory | Measure repo/builds/data sizes so moves can be sized |
| S1.2 | P0 | Allocation recommendations (SSDs kept for games; every move needs approval) | S1.1 | done | → 13:10 | same | test:system | Owner decides on the 3 moves (WORKSTATION.md) |
| S1.3 | P0 | Telemetry: counters per drive, processes by CPU/memory/disk, GPU; "why is it slow" findings | — | done | 12:35 → 12:55 | `src/system/Telemetry.ts` | test:system 3 checks + LIVE sample | — |
| S1.4 | P0 | Workload registry with safe pause/undo per workload | S1.3 | done | → 13:20 | `src/system/Workloads.ts` | test:game-mode (real pause/resume, throwaway model server) | Add Unity batch builds and Blender renders once they run as jobs |
| S1.5 | P0 | Profiles, Gaming Mode, staggered Resume All, retry, recovery after restart, audit | S1.4 | done | → 13:35 | `src/system/ResourceModes.ts`, `src/utils/GameMode.ts`, `src/server/gameMode.ts` | test:system, test:game-mode | Live run on the PC (S1.10) |
| S1.6 | P0 | Local AI only (router, clients, embeddings, Settings) and research offline mode | A0.4 | done | 13:15 → 13:30 | `src/tools/LocalOnly.ts`, `ModelRouter.ts`, `OpenAIClient.ts`, `AnthropicClient.ts`, `GeminiClient.ts`, `builderSettings.ts`, `research/SourceProviders.ts` | test:system 2 checks | — |
| S1.7 | P1 | Game detection (ask / auto / off, grace period, launchers and anti-cheat excluded) | S1.1, S1.5 | done | → 13:40 | `src/system/GameWatcher.ts` | test:system 2 checks | Watch it through one real game session |
| S1.8 | P1 | Resource-aware scheduling: hold, and heavy work waits for sustained pressure (max 20 min) | S1.3 | done | → 13:45 | `src/system/Scheduler.ts`, 12 background loops (`GameMode.paused()`), `ContinuousImprover.ts` | test:system 2 checks | Apply to BuildService installs and the art queue |
| S1.9 | P0 | Jarvis: status, why, modes, resume, hold, retry, detection, storage, audit, model unload, AI policy; events on every switch | S1.5 | done | → 13:50 | `src/server/jarvisActions.ts`, `src/server/system.ts` | typecheck; live via the bridge in S1.10 | — |
| S1.10 | P0 | Control centre in the app (Gaming Mode / Resume All first on Control, measurements, findings, workloads, detection, storage, audit) and a live end-to-end run on this PC | S1.5–S1.9 | done (22 Nov 14:40) | 13:55 → 14:40 | `remote/app/control/system.tsx`, `remote/app/game-mode.tsx`, `remote/lib/api.ts`, `globals.css` | **Live on this PC:** Gaming Balanced in 2 min 14 s, measured VRAM 5,268 → 799 MB, free RAM 8.0 → 13.2 GB, CPU 40 → 14%, E: 0.1 → 85% idle; model calls refused, model server down, downloads below normal. Resume All in 13 s: model server, Jarvis, 2 builds, 15 topics, sessions, priorities all back. Jarvis bridge: system.why, storage, ai.policy answer; 155 actions. UI check 15/15 | Watch one real game session with detection on "ask" |
| S1.11 | P2 | Archive manager (completed projects and old game versions to the NAS, verified copies, nothing deleted without approval) | S1.1 | later | | | | Needs the NAS mapping reconnected |
| S1.12 | P2 | Duplicate detection and retention policies | S1.1 | later | | | | |

## Phase 2: intelligence and repair

| ID | P | Task | Depends | Status | Next |
|---|---|---|---|---|---|
| I2.0 | P0 | **Found:** every continuous session failed for two weeks (games 0/25, self-improvement 0/35, NexusOS 88/111 failed): repairs that added packages were kept, and broken steps were kept. See CONTINUOUS_BUILDER.md | — | done (22 Nov 14:30) | — |
| I2.1 | P0 | Repair controller: InstallDoctor and SourceDoctor (model-free), progress judged along install → typecheck → build → test, no step kept that makes checks worse (one grace step on a healthy project), install repairs undone when install still fails, repair ledger with briefing, repeats undone, budget and escalation | I2.0 | done (22 Nov 14:40): test:repair-doctors 6/6 | **Live:** NexusOS's stray JSX file removed (its 17 errors gone, other errors now visible); Lanternfall and Driftworks install for the first time since 8 Nov (28 and 14 bad packages removed); their remaining typecheck/build/test errors go to normal steps |
| I2.2 | P0 | Why knowledge makes evaluations worse (0.6–0.7 with vs 0.8 without): per-item impact against the no-knowledge baseline (KnowledgeImpact); 13 items that hurt (race diagnosis 0.55 vs 1.0, web planning 0.73 vs 1.0, the WSL procedure 0.09 vs 0.33) benched from retrieval, released when they recover, retried after 14 days; refreshed after every evaluation. Also: evaluation records named the wrong model (gpt-4o-mini, a stale LMSTUDIO_MODEL); they ran on the local qwen2.5-coder:14b, and now say so | — | done (22 Nov 15:40): test:knowledge-impact 3/3 | The next daily evaluations show whether the with-knowledge score rises |
| I2.3 | P1 | Selective retrieval: a lesson or finding is handed out only with 3+ specific terms shared with the task, or (lessons) most of its error signature present. Evidence: 65 measured task-item pairs: 1–2 shared terms averaged -0.12/-0.15 and were all 16 harmful pairings; the rule keeps 8 (mean -0.04, none harmful). Learning scorecard (`/api/learning/scorecard`) | I2.2 | done (22 Nov 20:45): research 48/48, learning, test:model-lab | **Measured:** without 0.667, with 0.733 (3 trials each, same model): no longer worse; the gain is within noise. Repeat with 5 trials |
| I2.4 | P1 | Memory kinds made explicit (episodic, semantic, procedural, project, meta) over the existing stores | I2.3 | later | |
| I2.5 | P0 | Model laboratory (`src/learning/ModelLab.ts`, docs/MODEL_LAB.md): 16 graded challenges, one model at a time, load/GPU split/peak VRAM+RAM/TTFT/tokens per second, memory guard, never promotes | I2.2 | done for what fits (22 Nov): 14B 81% at 7.8 t/s (keep), 7B and 3B 56% at 75/141 t/s; test:model-lab 6/6. qwen3-coder:30b needs ~19.6 GB, 17.6 GB free even in Quiet; qwen3.6:35b ~23.6 GB | Run qwen3-coder:30b with VS Code, Chrome and ComfyUI closed (`models.lab.run`) |

| I2.7 | P0 | Continuous builder: milestones parked while install was broken reopen once install works (Lanternfall and Driftworks parked their design, art bible and vertical slice that way); every breakdown has attempted, changed, files (also for rolled-back steps), tests, result, learned, next time, with a factual fallback | I2.1 | done (22 Nov 20:50): continuous suite incl. a new check | Watch both games work through the reopened milestones |
| I2.8 | P0 | Gaming Mode: a build's model call waits through Gaming Mode instead of failing (a build failed in the minute of the live test) | S1.5 | done: test:model-lab | — |
| I2.9 | P0 | A hold also holds background builds already under way (their model calls wait); Jarvis: `blockers` (sessions, failing checks, stuck repairs, storage, learning verdict) and `repairs`; Learning Centre scorecard + model lab card; storage migration plan (docs/STORAGE_MIGRATION_PLAN.md) | — | done (22 Nov 21:00): test:model-lab 6/6 | — |
| I2.6 | P1 | Graphify (docs/GRAPHIFY.md): local code-only graph (6,382 nodes, 75 s), `scripts/graphify-update.ps1`, project-scoped Claude Code skill + non-blocking hook, measured: 89–93% less context than grep-and-read, 89% recall against grep's 100% | — | done (22 Nov 20:30) | Rebuild on commit (graphify hook install) once it proves useful in daily work |

## Phases 3–6

| ID | P | Task | Status |
|---|---|---|---|
| G3.1 | P1 | Game-playing test agent (input, screenshots, objectives) for web games | later |
| G3.2 | P1 | Unity Test Framework / batch validation; Blender scene checks | later |
| G3.3 | P2 | Local vision model for visual QA, loaded only when the GPU is free | later |
| J4.1 | P1 | Learning sync with Jarvis; task tracking from this backlog | later |
| L5.1 | P2 | Training-data curation and LoRA experiments (small, measured, never promoted without approval) | later |
| M6.1 | P3 | Story and media production pipeline | later |
