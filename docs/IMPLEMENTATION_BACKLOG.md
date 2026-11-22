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
| S1.10 | P0 | Control centre in the app (Gaming Mode / Resume All, measurements, findings, workloads, detection, storage, audit) and a live end-to-end run on this PC | S1.5–S1.9 | in progress | 13:55 → | app built 14:20 | `remote/app/control/system.tsx`, `remote/app/game-mode.tsx`, `remote/lib/api.ts`, `globals.css` | typecheck (app and server) | Build the app, restart, run Gaming Mode and Resume All for real |
| S1.11 | P2 | Archive manager (completed projects and old game versions to the NAS, verified copies, nothing deleted without approval) | S1.1 | later | | | | Needs the NAS mapping reconnected |
| S1.12 | P2 | Duplicate detection and retention policies | S1.1 | later | | | | |

## Phase 2: intelligence and repair

| ID | P | Task | Depends | Status | Next |
|---|---|---|---|---|---|
| I2.0 | P0 | **Found:** every continuous session failed for two weeks (games 0/25, self-improvement 0/35, NexusOS 88/111 failed): repairs that added packages were kept, and broken steps were kept. See CONTINUOUS_BUILDER.md | — | done (22 Nov 14:30) | — |
| I2.1 | P0 | Repair controller: InstallDoctor and SourceDoctor (model-free), no step kept that makes checks worse, install repairs undone when install still fails, repair ledger (attempts by error fingerprint, files, patch hash, errors before/after), history briefed to the model, identical failed patches undone, budget with escalation to Jarvis | I2.0 | done (22 Nov 15:10): test:repair-doctors 6/6 | Watch the four sessions' next steps live; add a hypothesis line per attempt |
| I2.2 | P0 | Why knowledge makes evaluations worse (0.6 with vs 0.8 without): measure per lesson, retire lessons that hurt | — | next | Per-lesson ablation in Evaluations |
| I2.3 | P1 | Selective retrieval: only lessons and findings relevant to the task, with provenance, confidence, verification | I2.2 | next | |
| I2.4 | P1 | Memory kinds made explicit (episodic, semantic, procedural, project, meta) over the existing stores | I2.3 | later | |
| I2.5 | P1 | Model laboratory: installed models, sizes, quantisation, VRAM/RAM split, speed and quality on fixed tasks; Qwen 14B as the baseline; promotion only with evidence and approval | — | next | |

## Phases 3–6

| ID | P | Task | Status |
|---|---|---|---|
| G3.1 | P1 | Game-playing test agent (input, screenshots, objectives) for web games | later |
| G3.2 | P1 | Unity Test Framework / batch validation; Blender scene checks | later |
| G3.3 | P2 | Local vision model for visual QA, loaded only when the GPU is free | later |
| J4.1 | P1 | Learning sync with Jarvis; task tracking from this backlog | later |
| L5.1 | P2 | Training-data curation and LoRA experiments (small, measured, never promoted without approval) | later |
| M6.1 | P3 | Story and media production pipeline | later |
