# How the agents learn, and what they share with Jarvis

App: **All → Training**. Code: `src/learning/Reinforcement.ts`, `src/learning/RewardWiring.ts`, `src/knowledge/SharedKnowledge.ts`.

## Reinforcement learning

Each agent makes some decisions the same way every time. Each of those decisions is a **policy**, with a few **approaches** (arms) to choose between:

| Policy | Approaches | Reward (0–1) |
|---|---|---|
| `chat.style`: how the research chat explains | answer first · teach step by step · example first | 👍/👎 in the app or told to Jarvis |
| `lesson.style`: how lessons teach (per learner level) | analogy first · worked example · first principles | the learner's **first** quiz score on that lesson, and 👍/👎 |
| `build.approach`: how a new build plans its first pass (per kind of app) | as it is · plan components first · logic and tests first | the build's best score / 100, +0.1 if it passed; failures caused by the PC (model server down, game mode) don't count |

Each time an agent acts, it picks an approach by **Thompson sampling**: it draws from each approach's Beta posterior and takes the highest draw. That keeps it exploring while it is unsure, and it settles on what works. A reward *r* adds *r* to the approach's α and 1 − *r* to its β. Old evidence fades (γ = 0.995) so the policy adapts when the model or the work changes. Each context bucket (a kind of build, a learner level) learns separately, starting from what worked everywhere else.

Rewards from several sources average. A second rating from the same source replaces the first, so nothing is counted twice. `RL=off` turns the choice off: agents always take the first approach, and tries are still recorded for comparison.

`npm run test:rl` shows the learning working. In a simulation where one approach is truly best (80% vs 50% vs 30%), it picks that approach on every one of the last 100 of 400 tries.

### Training the model itself

Every rewarded answer is kept with its prompt. **Export training data** (or `POST /api/rl/export`) writes two files to `data/rl/`:

- `sft.jsonl`: the best-rewarded answers, in chat format, for supervised fine-tuning
- `dpo.jsonl`: preference pairs (`prompt`, `chosen`, `rejected`). Use **Answer differently** in a research chat and rate both answers to make them.

Both are in the format TRL and Unsloth read. This PC has no PyTorch/TRL yet, so updating the model's weights is the next step once a training stack is installed. The data is collected from now on.

### API

```
GET  /api/rl/stats      policies, approaches, tries, average reward, chance each is best; recent episodes
POST /api/rl/feedback   { good | value, note?, policy?, episodeId?, source? }   (nothing named: the latest answer or lesson)
POST /api/rl/export     { minReward? }
POST /api/research/topics/:id/chat/:messageId/feedback   { good }
POST /api/research/topics/:id/chat/:questionId/again
POST /api/learn/:topicId/lessons/:i/feedback             { good }
```

## Knowledge shared with Jarvis

| Direction | How |
|---|---|
| Builder → Jarvis | Every report, summary, study guide, lesson and study pack is queued and filed in Jarvis's knowledge base (`SecondBrainClient` → `POST /api/ecosystem/knowledge`). He quotes it in his own answers (`loadKnowledgeBlock`). |
| Jarvis searches the builder | Bridge action `knowledge.search` → `GET /api/knowledge/search`: findings, reports, lessons, build lessons. |
| Builder reads Jarvis | `POST /api/ecosystem/knowledge/search` on Jarvis (new): the owner's own facts and preferences (memory kinds `fact` and `preference` only, never conversation summaries) and documents other apps shared. `SharedKnowledge.ownerContext()` puts the relevant ones into research-chat answers, lessons and new builds, cached for 10 minutes and given up after 4 s, so an offline Jarvis never slows anything. |
| Jarvis rates the builder | "That lesson was great" / "that answer was confusing" → `rl.feedback`, which rewards the approach that wrote it. |

The Jarvis side of this is in his repo: `app/api/ecosystem/knowledge/search/route.ts`, the `middleware.ts` allow-list entry, the TEACH pattern in `lib/jarvis/askBuilder.ts`, and `teachingLine` in `lib/jarvis/peers.ts`.
