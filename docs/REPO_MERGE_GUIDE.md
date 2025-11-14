# Repo Merger & Hustle Studio Integrator

The RepoMerger utility fuses two existing codebases (or unpacked Hustle Studio exports) into the `PROJECT_OUTPUT` directory. Semantic merges preserve conflicting files for manual review while recording a detailed summary.

## Usage

### CLI

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"sourceA":"./projects/app","sourceB":"./projects/hustle","strategy":"semantic"}' \
  http://localhost:4000/api/build/merge
```

### BuildEngine Integration

Provide repositories when launching a build from the dashboard or voice prompt:

```
./apps/saas, ./archives/hustle-studio
```

The BuildEngine automatically:

1. Creates an output folder under `PROJECT_OUTPUT`.
2. Copies all files from `sourceA` and `sourceB`.
3. If `MERGE_MODE=semantic`, conflicting files from `sourceB` are stored as `<file>.incoming` alongside the original copy.
4. Writes `merge-summary.md` outlining counts, conflicts, and timestamps.
5. Emits a build event and feedback record for continuous learning.

### Strategies

- `semantic` (default) — keep both versions of conflicting files for later reconciliation.
- `overwrite` — prefer the second repo, replacing conflicting files in-place.

Configure defaults via environment variables:

```env
MERGE_MODE=semantic
QA_ON_MERGE=true
```

Set `QA_ON_MERGE=true` to automatically queue QAAgent checks after merges complete.

## Output

Every merge returns a report similar to:

```json
{
  "id": "merge-abc123",
  "summary": "semantic",
  "outputDir": "./projects/merge-1700000000000",
  "mergedFiles": ["src/index.ts", "src/index.ts.incoming"],
  "conflicts": ["src/index.ts"],
  "createdAt": "2024-05-12T02:15:44.000Z"
}
```

Inspect the generated `merge-summary.md` for an at-a-glance checklist. Conflicts should be resolved before enabling `AUTO_DEPLOY=true`.

## Tips

- Run `npm run verify` after a merge to ensure the combined project passes tests.
- Pair the merger with collaboration context memory to document outstanding conflicts.
- Use the Build tab to trigger merges repeatedly while iterating on Hustle Studio assets.
