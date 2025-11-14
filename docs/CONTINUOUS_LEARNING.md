# Continuous Learning & Feedback Loop

Agent Builder now records every build, simulation event, and user rating to `data/feedback.jsonl`. This dataset powers local fine-tuning, AutoUpdater summarization, and the dashboard training workflow.

## Data Flow

1. **Event capture** — BuildEngine, StoryWorld orchestrators, and manual feedback submissions append JSON lines via `FeedbackStore.append`.
2. **AutoUpdater** — Periodically aggregates FineTuner feedback, marks entries as processed, and appends a summary record to `feedback.jsonl`.
3. **LocalTrainer** — On `POST /api/train/start`, unprocessed feedback records are consumed and transformed into `data/train.jsonl` for LoRA/Ollama fine-tuning.
4. **Model Router** — Updated checkpoints can be loaded by pointing `AI_PROVIDER`/`MODEL` to the new artifacts.

The JSONL schema is lightweight:

```json
{
  "id": "build-1700000000-plan",
  "source": "build-engine",
  "message": "Planned app build: scaffold + QA",
  "metadata": { "plan": [...] },
  "createdAt": "2024-05-12T02:15:44.000Z"
}
```

## Commands

- Kick off aggregation and dataset refresh:
  ```bash
  curl -X POST -H "Authorization: Bearer <token>" http://localhost:4000/api/train/start
  ```
- Inspect the latest records:
  ```bash
  tail -n 20 data/feedback.jsonl
  ```

## Environment Variables

```env
TRAINING_ENABLED=true
AUTO_LEARN=true
AI_PROVIDER=ollama
MODEL=llama3
```

Set `AUTO_LEARN=false` to disable automatic AutoUpdater flushes. When running in `full` autonomy, leave `AUTO_LEARN=true` so the engine self-improves without manual intervention.

## Best Practices

- Tag feedback entries with `metadata` (e.g., `taskId`, `rating`) to improve filtering.
- Use the dashboard Feedback view to inspect processed vs. pending entries.
- Periodically archive `data/feedback.jsonl` to preserve historical runs before large migrations.
