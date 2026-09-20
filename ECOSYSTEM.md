# Ecosystem API — connecting Jarvis

Agent Builder keeps a live picture of every project on this machine: what it is,
which branch it is on, what is uncommitted, what GitHub says about it, what past
builds learned, and what is currently broken. Jarvis connects with an **agent
key** and can read all of it, report problems, and ask for fixes.

The point is continuity. When a session ends — or you run out of tokens — the
next agent asks one question and knows where everything stands.

## 1. Get a key

```
npm run key:agent -- --name jarvis --scopes read,write,execute
```

The key is printed once and stored only as a SHA-256 hash. Rerun to rotate
(which invalidates the old one); `--revoke` to kill it; `--list` to see what
exists.

Scopes are separate on purpose:

| Scope | Allows |
| --- | --- |
| `read` | List projects, read any file in them, get briefings, search everything learned |
| `write` | Report issues, update issue status, trigger a rescan |
| `execute` | Run a project's checks, attempt repairs |

## 2. Connect

Every call needs the key as a header:

```
x-agent-key: ab_...
```

The API listens on `http://127.0.0.1:4000` and is loopback-only by default.
**Keep it that way** — these routes expose the source of every project on the
machine and can start builds.

A signed-in dashboard user with a suitable role can call the same routes, so the
UI does not need a key.

## 3. What Jarvis can do

### See everything at once

```
GET /api/ecosystem/handoff?format=markdown
```

A briefing across the whole machine: projects most recently worked on, anything
with uncommitted work, unpushed commits, open issues, recent activity. This is
the "pick up where we left off" call.

### Understand one project

```
GET /api/ecosystem/projects                      # list
GET /api/ecosystem/projects/:id                  # state + issues + activity
GET /api/ecosystem/projects/:id/context          # full briefing (JSON)
GET /api/ecosystem/projects/:id/context?format=markdown
```

The context pack is the important one. It gathers, in a single response: what
the project is and is built with, its git state, uncommitted files, open issues,
GitHub issues/PRs/CI, lessons earlier builds learned, related research findings,
its `CLAUDE.md` notes, and concrete suggested next steps.

### Read the code

```
GET /api/ecosystem/projects/:id/tree?path=src
GET /api/ecosystem/projects/:id/file?path=src/index.ts
```

Paths are resolved through symlinks and confined to the project; `.git`,
`node_modules` and build output are not served. Files over 400 KB are refused.

### Search everything the builder knows

```
GET /api/ecosystem/search?q=sqlite%20migration
```

Full-text across research findings, study documents, lessons and project
summaries.

### Report a problem

```
POST /api/ecosystem/issues
{ "project": "e-projects-agent-builder", "title": "build fails after upgrade",
  "detail": "...", "severity": "error" }
```

Issues are deduplicated per project on a normalised signature, so reporting the
same failure every minute keeps one row. `GET /api/ecosystem/issues?status=open`
lists them; `PATCH /api/ecosystem/issues/:id` updates one.

### Get it fixed

```
POST /api/ecosystem/projects/:id/diagnose
POST /api/ecosystem/projects/:id/repair   { "issueId": 12, "maxAttempts": 3 }
```

`diagnose` runs the project's own checks — install, typecheck, build, test, lint
— and records what fails. `repair` asks the local model for a patch, and this is
where the safety rules matter:

- a project with **uncommitted work is refused** unless you pass `force`, because
  your in-progress changes are not the app's to gamble with;
- work happens on a **new branch** (`agent-builder/fix-<timestamp>`), never on
  your current one;
- a patch is kept **only if the verified score improves**, otherwise it is rolled
  back;
- **nothing is ever pushed**, and no pull request is opened.

A successful repair is written back into lesson memory, so the same failure is
recognised faster next time.

## 4. What runs on its own

A sweep every 30 minutes (`ECOSYSTEM_SCAN_INTERVAL_MS`) rescans every root and
records a warning when a project's latest GitHub Actions run failed. It reads
only — it never builds or edits on a timer, because those cost GPU time and
change files. Fixing stays an explicit request.

Roots scanned default to `H:/ts,E:/Projects,K:/Projects`; override with
`ECOSYSTEM_ROOTS`.

## 4b. Keys are per-installation

The API keeps its data beside wherever it runs, so the installed desktop app
and the development server have **separate key stores**. A key minted in the
repo works against `npm run dev:server`, not against the installed app.

To mint one for the installed app, run the command from its data directory:

```
cd %APPDATA%\com.agent.builder
npx tsx E:\Projects\Agent-Builder\scripts\mint-agent-key.ts --name jarvis --scopes read,write,execute
```

Both listen on port 4000, so only one runs at a time anyway.

## 5. Honest limits

- **Repairs are as good as a 7B local model.** It fixes the class of failure the
  build pipeline already handles well — type errors, missing imports, wrong test
  wiring. It is not going to redesign an app.
- **Reads are local.** The registry is built from what is on these drives.
  Projects that exist only on GitHub are visible through
  `GET /api/ecosystem/github/repos` but have no local state.
- **GitHub access uses the `gh` CLI** already signed in on this machine
  (`mraaziqp`), falling back to `GITHUB_TOKEN`. Nothing new is stored here.
- **There is no dashboard screen for this yet.** It is an API for agents; the
  web UI does not show projects or issues.
- **This key is powerful.** It can read every line of source on these drives and
  start processes. Treat it like an SSH key: local only, rotate it if it leaks.
