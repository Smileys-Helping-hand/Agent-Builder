# The research, testing and learning platform

What exists, how it connects, and an honest status against the "Jarvis Agent Builder
2.0" specification (November 2026).

## Audit: what was already there

| Area | State found | Done about it |
| --- | --- | --- |
| Research engine (`src/research`) | Solid: cycles, question frontier, source credibility tiers, grounded findings, documents, feeds builds through `relevantFindings` | Extended by Investigations, not replaced |
| Continuous builder (`ContinuousImprover`) | Working, but only ran project checks; "done" meant nothing about really running | Can now require an OS to boot and pass tests |
| NexusOS (`os/`) | **30 of 36 milestones "done", but no bootable image existed**: shell scripts around a Next.js build | Real image kit in `os/image`, boots and passes tests |
| Iterations | A short journal of the last 80 steps, no diffs | Iteration Explorer; journal kept for 2000 steps, ledger for good |
| Lessons (`LessonMemory`) | Created and retired by use, with no statuses or source | Status, category, source, your decision |
| Reconstructor, Self-improver | Separate features you had to start | The learning loop drives them from the record |
| Evaluations | None: progress was self-reported | Benchmarks with code graders |
| VMs | None; WSL broken until virtualization was turned on | Virtual Test Lab |
| Jarvis Core, its task tracker, Internet Lock | In the separate Jarvis repository | **Not changed in this work** (see Not done) |

"REA" was searched for and found nowhere, in code or on GitHub. Here it is taken as the
research engine plus the Reconstructor, working as part of learning.

## How it connects

```
           you: notes, approvals, feedback ──────────────┐
                                                         ▼
 Research ─ Investigation ─ specialists ─ findings ─► builds are told what is relevant
     ▲            │                                      │
     │        experiments (sandbox)                      ▼
     │            │                       Continuous builder ─ steps ─ checks
     │            ▼                                      │        ├ project checks
 Learning loop   conclusions ─► LESSONS ◄─ fixes         │        ├ asset rules (games)
     ▲                            ▲  │ verified by use   │        └ VM test: build ISO,
     │                            │  ▼                   │          boot, test profiles
 the record: parked,          Reconstructor              ▼
 repeated, missed ◄────────── what rebuilds miss    Iteration Explorer, releases
     │
     └────────► Evaluations: fixed challenges, with and without what was learned

 Evidence ledger: every step, VM run, experiment, lesson and piece of feedback,
 linked in both directions (GET /api/agent/evidence?ref=…)
```

## Where to find it

- **Agent → Overview:** agents, VMs, research, iterations, discoveries, what waits for you.
- **Agent → Continuous:** each session's Iteration Explorer: click any iteration, running
  or finished; pick two to compare.
- **Agent → Learning:** knowledge by status, kind and source; verify or reject.
- **Agent → Evaluations:** run and compare benchmarks.
- **Lab:** VMs, live console, test runs ([VIRTUAL_TEST_LAB.md](VIRTUAL_TEST_LAB.md)).
- **Research → Deep investigation** ([INVESTIGATIONS.md](INVESTIGATIONS.md)).
- **Games** ([GAMES.md](GAMES.md)).

## What "learning" means here

Adding to memory does not change an LLM's weights, and nothing here claims it does. What
changes is what the system tells the model and how it decides: which lessons and findings
are retrieved, which approaches the reinforcement policies choose, and the builder's own
code (through approved self-improvement). **Evaluations** measure the effect on the same
model, with and without that knowledge, using graders that are code.

Lessons: **candidate** → **verified** (helped at least 3 times, utility ≥ 0.55) →
**deprecated** (applied 4+ times, utility below 0.25; no longer given to builds, still
searchable). **Rejected** and **verified** can be set by you. Failed knowledge is kept.

## Status against the specification

**Fully implemented and tested**

- Virtual Test Lab: create, start, stop, pause, resume, restart, delete, clone, live and
  offline snapshots, ISO management, hardware and network settings, resource limits, usage,
  persistent records and history, survives builder restarts.
- Agent-run tests: boot, serial login, commands with exit codes, keys and clicks, screenshots
  with content measures; 12 profiles and custom ones; evidence per step; failures reported to
  a builder. Proven on Alpine Linux and on NexusOS.
- A bootable NexusOS: ISO built from `os/image`, boots to a desktop, passes the profiles; a
  change was rebuilt, re-booted and re-tested (0.1.0 → 0.1.1).
- Iteration Explorer: timeline, running and finished, real diffs, functions touched,
  dependencies and config, decisions from the build's passes, lessons, tests, feedback
  reaching the session, two-iteration comparison.
- Evidence ledger with links, in the existing database (additive tables; dropping them removes
  only the ledger).
- Investigations: per-subject plan, specialists with dependencies, findings, sandboxed
  experiments with sensitivity and repeatability, physical-test protocols, contradictions,
  citation checking, another round for open questions, candidate knowledge, feedback.
- Knowledge statuses, categories, sources, your decisions; the learning loop; evaluations with
  hidden tests, baselines, comparisons, regressions and custom regression challenges.
- Games: Phaser and three.js starts, verified in a real browser; play in the app, download,
  SaveState shelf.

**Implemented, proof still running or depending on the model**

- The coffee investigation and the first real evaluation numbers are started on the live server
  and take hours. Their machinery is tested with a stand-in model; **the real results did not
  exist when this was written.**
- The continuous builder taking NexusOS forward through its VM check, and the self-improvement
  session, depend on the local model's ability. Its record so far is weak: its first self-
  improvement session finished 0 of 12 milestones (it broke its own test scripts, since guarded).

**Partly implemented**

- GUI testing: keys, clicks and screenshots with a content measure work, but nothing *reads* a
  screen, so an agent cannot yet navigate menus by looking. There is no vision model here.
- Recording: periodic screenshots with a run, not video.
- OS profiles: fresh installation has no built-in profile (the live image has no installer yet);
  add one per installer as a custom profile.
- Knowledge contribution: by source and use, not per named agent, and no "who reused whose".
- Reproduction: runs record the ISO, its date and the VM's settings, and VMs can be cloned;
  there is no one-click reproduce.
- Dashboard: Overview and tabs inside the existing Agent page, not the ten-section redesign.
- Clipboard in the console: not wired up.

**Not done**

- Jarvis Core changes: the live task tracker, its task lifecycle, Internet Lock and Restore are
  not integrated. Long-running work reports through Agent Builder's own pages and Jarvis actions.
- Separate Simulation Lab and Knowledge Graph pages (experiments live in investigations; links
  are in the ledger's API, with no graph view).
- libvirt, openQA, Avocado: QEMU driven directly behind one backend object was enough here.
- Project digital twins, the experiment optimiser and periodic per-agent benchmarks.
- Native desktop game builds (`.exe`), and native engines.

**Limited by this PC**

- No hardware acceleration in WSL on Windows 10, so VMs are emulated: a desktop boots in about
  4 minutes. Windows 11 or a Linux host with KVM would make it fast with no code change.

## Recovery

- **Stop every VM:** Lab → Emergency stop, or `POST /api/lab/stop-all`.
- **Rollback:** every change here is additive (`evidence*` tables, `lessons.decision`, new files
  under `data/`); deleting them returns to the old behaviour. `NET_RELAY=off`, `LEARNING_LOOP=off`
  and `LEARNING_RECONSTRUCT=off` turn off the background parts.
- **Tests:** `npm run test:vmlab`, `test:iterations`, `test:investigation`, `test:learning`,
  `test:game-director`, `test:net-kit`, `test:continuous`, `test:self-improve`,
  `check:game-engines`.
