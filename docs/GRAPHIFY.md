# Graphify: a code graph of Agent Builder, built locally

[Graphify](https://github.com/Graphify-Labs/graphify) turns the repository into a graph of files, functions, classes
and the calls and imports between them, which can be queried instead of reading whole files.

## How it is set up here

- **Installed** in its own environment, off the SSDs: `E:\Tools\graphify-venv` (graphifyy 0.9.115, Python 3.14).
- **Built locally, code only:** `scripts/graphify-update.ps1` runs `graphify update .`, which parses the code with
  tree-sitter on this PC: no model, no network. It sets `GRAPHIFY_BACKEND=none` (so nothing can fall back to an AI
  backend) and `GRAPHIFY_QUERY_LOG_DISABLE=1`, and records the commit it was built at in `graphify-out/built-at.json`.
  About 75 s for the whole repository: 6,382 nodes, 14,689 edges, 286 communities.
- **Never** `graphify extract` or the `/graphify` semantic pass: `extract` auto-detects the API keys in `.env` (OpenAI is
  one) and would send content to a cloud model. Agent Builder is local-AI only. Graphify Cloud and its hosted MCP
  server are not used.
- **What is indexed:** the repository minus `.gitignore` and `.graphifyignore` (builds, data, generated app output,
  games, site templates). `graphify-out/` is git-ignored: rebuilt, never committed.
- **Claude Code:** project-scoped (`graphify install --project`): the skill in `.claude/skills/graphify/`, its rules in
  `CLAUDE.md`, and a non-blocking hook in `.claude/settings.json` (it exits 0) that reminds before searches and reads.
  The hooks call the absolute path, since Graphify is not on PATH.

## Querying

```powershell
$env:GRAPHIFY_BACKEND="none"; $env:GRAPHIFY_QUERY_LOG_DISABLE="1"
E:\Tools\graphify-venv\Scripts\graphify.exe query "How is a running game detected?"
E:\Tools\graphify-venv\Scripts\graphify.exe path "GameWatcher" "startSwitch"
E:\Tools\graphify-venv\Scripts\graphify.exe explain "InstallDoctor"
```

## Measured value (22 November 2026, `scripts/graphify-bench.ts`)

Six real questions about this codebase, with the files that answer each known (18 files in all). The graph's answer
(`graphify query`, default budget) against grepping for the key name and reading every matching file. Tokens are
characters / 4.

| Approach | Context used | Right files found | Unneeded files named |
|---|---|---|---|
| Graph, asked in plain words | 11,928 tokens | 16 of 18 (89%) | 81 |
| Graph, asked by the identifier | 17,549 tokens | 16 of 18 (89%) | 36 |
| Grep for the identifier, read every match | 166,504 tokens | 18 of 18 (100%) | 8 |

- **89–93% less context** than reading every file grep finds, which is above the 70% hoped for, but measured against
  the most expensive way to look. A list of grep's matching files alone (without reading them) is also small.
- **Lower recall**: the graph missed 2 of 18 right files, and by a bare name like `resumeAll` it found 1 of 3. Grep
  found all of them, given the exact name. The graph names many files that are not needed (each in a line, cheaply).
- So: use the graph for plain-language and relationship questions (what calls what, the path between two parts), then
  read only the lines it points to; use grep when the exact name is known; and read the source before changing it.
  The graph is a map, not the authority, and is stale after a change until rebuilt.
