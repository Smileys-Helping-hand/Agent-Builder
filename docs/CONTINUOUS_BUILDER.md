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

Settings: `CONTINUOUS_STEP_LIMIT_MS` (one build step, default 6 h),
`CONTINUOUS_CHECK_LIMIT_MS` (the check command, default 60 min),
`CONTINUOUS_MAX_FILES` / `CONTINUOUS_MAX_BYTES` (largest project it copies,
default 250,000 files / 6 GB). Test: `npm run test:continuous`.
