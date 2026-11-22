## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` (full path below) before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. When the answer is under a Markdown heading, `graphify section "<heading>"` prints that section's text, so the .md need not be opened. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, rebuild with `powershell -ExecutionPolicy Bypass -File scripts\graphify-update.ps1` (code only, AST, no model, GRAPHIFY_BACKEND=none). Never run `graphify extract` or the `/graphify` semantic pass here: `extract` auto-detects the API keys in .env and would send content to a cloud model, and Agent Builder is local-AI only.
- Graphify lives at `E:\Tools\graphify-venv\Scripts\graphify.exe` (not on PATH). Set `GRAPHIFY_BACKEND=none` and `GRAPHIFY_QUERY_LOG_DISABLE=1` when calling it.
- The graph is a map, not the authority: check `graphify-out/built-at.json` against `git rev-parse HEAD`, and read the source before changing anything. Measured here (docs/GRAPHIFY.md): it answers plain-language questions in ~90% less context than grep-and-read-whole-files, but found 89% of the right files against grep's 100%, so confirm with grep when a name is known.
- graphify-out/ is git-ignored here: the graph is rebuilt locally, never committed.
