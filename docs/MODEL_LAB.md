# The Model Laboratory

Which local model is best on this PC, measured. `src/learning/ModelLab.ts`; run it from the app's API
(`POST /api/models/lab/run { "models": [...] }`), Jarvis (`models.lab.run`), or `npx tsx scripts/model-lab.ts [models]`.

- **The same 16 graded challenges for every model:** the Evaluations' fixed ten (coding, diagnosis, grounded reading,
  planning, this PC's procedures) and six of the lab's own: structured JSON (exact keys and types), a tool call (the
  right tool and argument), a fact in a ~9,000-token document, repairing a buggy function (hidden tests), a platformer
  movement rule (hidden tests), and a synthesis that must cite all three sources and notice where they disagree.
  Every grader is code; no model judges.
- **One model at a time:** everything is unloaded before each model loads, through the same GPU lock the builder uses.
- **Measured per model:** load time, its GPU/RAM split (from Ollama), peak video memory and RAM (sampled every 2 s),
  time to first token and tokens a second (Ollama's own counters), errors.
- **Safe:** refused in Gaming Mode, stops if a game starts, skips a model that would not fit in free video memory plus
  available RAM with 3 GB to spare (`MODEL_LAB_SPARE_GB`), caps each answer at 1,500 tokens and 4 minutes.
- **Never promotes a model.** It recommends, with the evidence, and keeps the production model unless a candidate
  beats it by 10 points or more; switching is the owner's decision (Settings → OLLAMA_MODEL).

## Results (22 November 2026, one trial each, context 16,384)

| Model | Score | Tokens/s | First token | Load | On GPU | Peak VRAM | RAM added |
|---|---|---|---|---|---|---|---|
| qwen2.5-coder:14b (production) | 13/16 (81%) | 7.8 | 448 ms | 89 s | 57% | 7.7 GB | 7.9 GB |
| qwen2.5-coder:7b | 9/16 (56%) | 75 | 47 ms | 33 s | 100% | 6.4 GB | 1.5 GB |
| llama3.2:3b | 9/16 (56%) | 141 | 38 ms | 28 s | 100% | 4.7 GB | 1.7 GB |
| qwen3-coder:30b (MoE) | not run | | | | | | |
| qwen3.6:35b (MoE) | not run | | | | | | |

The two Qwen 3 mixture-of-experts models were skipped by the memory check: 18.6 and 22.6 GB on disk against 17.5 GB of
video memory plus available RAM at that moment. The 35B cannot run safely beside anything else on 32 GB; the 30B
needs everything else paused (the Quiet profile) and is the run still to do.

By kind (pass rate): the 14B passes all of structured output, tool use, long context, repair, game logic, research
synthesis, reading and planning; it fails one coding challenge (parse a duration), the stale-closure diagnosis and
the PC-procedure question. The 7B fails reading, planning, repair and 3 of 5 coding, but passed the stale-closure
diagnosis the 14B failed. The 3B fails game logic, synthesis and both diagnoses.

**Recommendation: keep qwen2.5-coder:14b** for building, repair and planning. For roles where speed matters and the
challenge is narrow, the small models are 10 to 18 times faster and pass structured JSON, tool calls and long-context
lookup: a fast routing/JSON model is a candidate role for llama3.2:3b or the 7B. One trial is noisy (one challenge is
6 points); repeat before acting on a gap under 10 points.
