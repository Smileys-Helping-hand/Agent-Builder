# The continuous builder

Give Agent Builder a project and a goal, however big ("build my own Linux OS",
"make SaveState a flawless emulator"), and it works on it around the clock until
you stop it. App → Agent → **Continuous & approvals**, or ask Jarvis.

## What it does

1. **Plans.** Reads your goal and the project and writes a roadmap of milestones.
   A new instruction you send later revises the roadmap.
2. **Builds.** Milestone by milestone, in its **own workspace**: one copy of the
   project that every step builds on, so long goals add up instead of starting
   over. After each step it runs the checks. A milestone that keeps failing is
   parked and tried again once the rest is built; nothing is dropped.
3. **Fixes.** When the roadmap is done it runs every check and fixes until all
   pass. A fix that makes things worse is rolled back.
4. **Completes.** It asks whether the goal is fully met and adds milestones for
   anything missing. A session set to *Finish it, then stop* stops here.
5. **Improves, forever.** A session set to *keep improving* never stops on its
   own: it keeps a research topic running on the project, makes one improvement
   at a time (an improvement that breaks the checks is undone), and every few
   improvements plans bigger upgrades and builds them.

It waits while everything is paused (game mode), backs off when something fails
(the model server down, a build crashing) and tries again — it never gives up
by itself. Sessions and workspaces survive restarts; a stopped session can
**Carry on** from where it got to.

## Checks

What "clean" means: the project's own checks (install, typecheck, build, tests,
lint for Node projects), plus a **check command** you give (`make`,
`cargo test`, `npm test`, a script that boots your OS in QEMU…). Without one it
detects `cargo build`, `go build ./...`, `make` or CMake when their tool is
installed. If nothing applies, the session says so: add a check command.

## Your project stays safe

Nothing touches your project until you approve. Whenever the workspace is clean
and has something new, one **delivery** waits for you: everything since your
last approval, file by file, grouped by folder. Changes with many files,
deletions, or build, dependency or config files are flagged **major**: tick the
parts you want.

- Approved parts are applied three-way — a file you changed since is never
  overwritten — and committed on the project's live branch.
- Declined parts are taken back out of the workspace, so later work does not
  build on them, and it learns not to bring them back.
- Your own commits to the project are brought into the workspace, so it builds
  on your work too.

## Starting

- **A project I have** — pick it; the goal is optional for "keep making it better".
- **A new project from nothing** — a name and the goal; it creates the folder
  (in `E:/Projects`, or `CONTINUOUS_NEW_PROJECTS_DIR`) and a git repository.

- **A game** — from the Game Maker (**Keep building a game**), or a new project
  whose goal is a game: see [GAMES.md](GAMES.md). Every finished milestone is
  released as a version you can play.
- **Agent Builder itself** — Agent → Continuous → **Improve itself**: its own
  record (parked milestones, repeating failures, lessons that do not help,
  choices getting worse, features rebuilds miss, broken tools) becomes the
  goal, and every step must pass its typecheck and smoketests
  (`SELF_CHECK_COMMAND` to change that). Its changes wait for your approval
  like any project's. Test: `npm run test:self-improve`.

Settings: `CONTINUOUS_STEP_LIMIT_MS` (one build step, default 6 h),
`CONTINUOUS_CHECK_LIMIT_MS` (the check command, default 60 min),
`CONTINUOUS_MAX_FILES` / `CONTINUOUS_MAX_BYTES` (largest project it copies,
default 250,000 files / 6 GB). Test: `npm run test:continuous`.

## A breakdown after every step (8 November)

After each step it writes a breakdown: what it did, what changed (files and lines, from git), the result, what it
learned, and one concrete thing to do differently next time. The next steps are told the last four of those, so each
run applies what the one before learned; a concrete correction from a step that did not succeed is kept as a lesson,
which LessonMemory then verifies by use. It is the first tab of each iteration in the Iteration Explorer.

**A full disk** no longer takes the builder down: while less than 3 GB is free (`DISK_MIN_FREE_GB`), builds, installs
and steps wait and say why, and the launcher starts the builder with node directly (npx itself needed disk space).

**A slow disk** no longer restarts the builder: when it stops answering but is alive and hardly using the CPU, it is
waiting on the disk (E: is a laptop hard drive shared with downloads and sync), and the launcher gives it up to 15
minutes, logging "waiting on the PC". A restart there cost 5 to 20 minutes of boot on the same disk and interrupted every
build. A builder spinning the CPU without answering is restarted after two minutes, as before. Moving the builder to an
SSD (K: or H:) is what would make it fast.

## Why every session failed from 8 to 22 November, and what changed

The record showed it plainly: Lanternfall 0 of 25 steps succeeded, Driftworks 0 of 25, self-improvement 0 of 35,
NexusOS 88 of 111 failed. The milestone names moved on only because a milestone is parked after four failed tries.

- **The games:** their first install failed on 8 November because the disk was full. The build's repair loop then asked
  the model to fix the install, and the model added packages: Lanternfall went from 15 dependencies to 44 (a whole Vue
  stack in a Phaser game), Driftworks from 16 to 30 (two do not exist on npm). Those repairs were kept because the score
  was 0 before and after, and every install since failed on them. The original dependency lists resolve cleanly.
- **NexusOS:** a step wrote React JSX into `src/app/ai-assistant/page.ts`, beside a `page.tsx` of the same page.
  TypeScript reads JSX in a `.ts` file as broken syntax and never says "JSX", so every repair rewrote the code and the
  same 17 errors stayed for days.
- **In every case the breaking step was kept**: a building step kept its changes whatever the checks said, so each
  broken step became the next one's starting point.

What changed:

- **No step leaves the project worse than it found it** (`madeWorse`: a check that passed now fails, a new check fails,
  or the same checks fail with more errors). On a healthy project the breaking step is kept for one more step to fix
  what it broke (feature work often breaks something on the way); if the project is still worse than before after
  that, both steps are rolled back together. On a project that is already broken, a step that makes it worse is
  rolled back at once. The journal says which.
- **Fixes that need no model run first** when the last check failed (`preStepDoctors`):
  - *InstallDoctor* (`src/repair/InstallDoctor.ts`) reads npm's own error. The PC's problems (disk, network, a locked
    file) change nothing. A missing package, a missing version or a peer conflict: packages added since the session's
    starting point that caused it, or that nothing in the project uses, are removed; what the code imports, its types
    and the tools its scripts run are kept.
  - *SourceDoctor* (`src/repair/SourceDoctor.ts`): a `.ts` file whose syntax errors come from JSX is renamed to `.tsx`,
    or removed when a `.tsx` of the same name exists.
  Each is committed, checked, and undone if it made things worse.
- **The build's repair loop** runs the InstallDoctor before any model touches a failing install, stops at once when
  the failure is the PC's, and undoes any install repair that leaves install failing.
- **Repair memory** (`src/repair/RepairLedger.ts`, `data/repair-ledger.jsonl`): every repair attempt, in builds and
  continuous steps, is recorded under the fingerprint of the errors it was for, with the files it changed, a hash of
  exactly what it changed, and the error count before and after. The next attempt is told what was tried and how it
  went; a patch identical to one that already failed is undone at once; after `REPAIR_BUDGET` (12) attempts that did
  not help on the same errors in one project, repair stops and Jarvis is told it needs a person.

Tests: `npm run test:repair-doctors` (6 checks, on throwaway projects shaped like the three real failures).
