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
| Jarvis Core, its task list | In the separate Jarvis repository, with a task API | Used as it is: Agent Builder keeps work up to date on it; his code is unchanged |

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
- **Agent → Agent Builder:** continuous sessions, approvals, improving itself.
- **Agent → Iterations:** every project: what is known about it (its twin), and each
  iteration, running or finished; pick two to compare.
- **Agent → Simulation Lab:** computed experiments of your own and those in investigations;
  the optimiser picks each next round from the last.
- **Agent → Learning Centre:** knowledge by status, kind and source; verify or reject; who has
  used what.
- **Agent → Evaluations:** run and compare benchmarks. One runs by itself each day.
- **Agent → Agent Activity:** the ledger; open a record and follow it in both directions.
- **Agent → Knowledge Graph:** how the records connect.
- **Lab:** VMs, live console, test runs ([VIRTUAL_TEST_LAB.md](VIRTUAL_TEST_LAB.md)).
- **Research → Deep investigation** ([INVESTIGATIONS.md](INVESTIGATIONS.md)).
- **Games** ([GAMES.md](GAMES.md)).
- **Jarvis:** long-running work appears on his task list, and he can drive all of the above.

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

**Implemented and tested**

- Virtual Test Lab: every VM operation in the spec, persistent records, resource limits, surviving
  builder restarts, live screen and terminal, OCR, video recording, reproduction.
- Agent-run tests: boot, serial login, commands with exit codes, keys, clicks, clicking by label;
  14 profiles and custom ones; evidence per step; failures reported to a builder.
- A bootable NexusOS with an installer; a change rebuilt, re-booted and re-tested.
- Iteration Explorer, the evidence ledger, investigations, the Simulation Lab and optimiser,
  knowledge statuses and contributions, the learning loop, evaluations, project twins, the
  Knowledge Graph and Activity pages, Jarvis's task list.
- Games: Phaser and three.js starts verified in a real browser; play in the app, download, Windows
  `.exe` (launched for real), SaveState shelf.

**Tested with a stand-in model only; real results come from running**

- Whether the local model produces good investigations, games and OS work. The machinery is proven;
  the quality of what the model does with it is what Evaluations and the running sessions measure.
  Its record so far is weak: the first self-improvement session finished 0 of 12 milestones.

**Different from the spec, on purpose**

- Task lifecycle: Jarvis's tasks have four states (todo, in_progress, blocked, done), not the
  spec's nine. Work maps onto those, with the phase in the notes, rather than changing his schema.
- libvirt, openQA, Avocado: QEMU driven directly behind one backend object does what was needed.
- Dashboard: the spec's sections as tabs on the Agent page, with Research and the Lab one click away,
  rather than a new shell around the app.
- Clipboard: the guest would need an agent, so text is typed instead.

**Does not exist to integrate with**

- Internet Lock, Emergency Shutdown as a Jarvis feature, and Restore: none of them are in the Jarvis
  code (searched). Game Mode is honoured (VMs pause with it), and the Lab has its own emergency stop.

**Not done**

- Native engines for games (Godot, Unity export from this flow), and a signed installer.
- Vision: agents read text on a screen, not pictures; "does this look right" still needs you.
- Per-agent private memory: lessons are shared and tracked by who used them, not partitioned per agent.

**Limited by this PC**

- No hardware acceleration in WSL on Windows 10, so VMs are emulated: a desktop boots in about
  4 minutes. Windows 11 or a Linux host with KVM would make it fast with no code change.

## Recovery

- **Stop every VM:** Lab → Emergency stop, or `POST /api/lab/stop-all`.
- **Rollback:** every change here is additive (`evidence*` tables, `lessons.decision`, new files
  under `data/`); deleting them returns to the old behaviour. `NET_RELAY=off`, `LEARNING_LOOP=off`
  and `LEARNING_RECONSTRUCT=off` turn off the background parts.
- **Tests:** `npm run test:acceptance` runs the spec's scenarios (`-- --vm` adds the real boots);
  each also runs alone (`test:vmlab`, `test:iterations`, `test:investigation`, `test:learning`,
  `test:platform`, `test:game-director`, `test:net-kit`, `test:continuous`, `test:self-improve`,
  `check:game-engines`). The new background parts turn off with `JARVIS_TASKS=off` and
  `LEARNING_EVALUATE=off`.
