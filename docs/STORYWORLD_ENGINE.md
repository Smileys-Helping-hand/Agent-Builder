# StoryWorld Engine (v11.7)

The StoryWorld Engine layers autonomous NPC cognition, faction-level lore evolution, and a persistent simulation loop on top of the StoryWorld Orchestrator. Use it to let your Roblox experiences continue evolving without manual prompts.

## Components

- **World Simulator** – runs a periodic tick (configurable via `STORYWORLD_TICK_MS`) that advances the timeline, evolves factions, and generates emergent world events.
- **Cognitive NPC Agent** – assigns an independent reasoning loop to each NPC, recalling recent dialog via vector search and updating goals/moods in `WorldMemory`.
- **Dialog Memory** – stores chat transcripts per NPC under `data/storyworld/dialogs/` and indexes them into VectorMemory (when enabled) for semantic recall.
- **Lore Engine** – tracks factions, influence, and territories while producing lore beats that sync back into Roblox terrain and world memory.

## Dashboard Controls

Open the **Simulation** tab in the dashboard to:

1. Monitor live simulation activity, including faction influence and NPC state snapshots.
2. Pause, resume, step, or fast-forward the world tick.
3. Adjust the speed multiplier to accelerate background evolution.
4. Review merged logs from the simulator and autonomous NPC actions.

## API Endpoints

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/storyworld/simulation/state` | GET | Returns current simulation state, faction roster, NPC cognition snapshots, and recent events. |
| `/api/storyworld/simulation/control` | POST | Accepts `{ action: "pause" | "resume" | "step" | "fast_forward" | "set_speed", speed?, steps? }`. Requires editor role. |

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `STORYWORLD_SIMULATION_ENABLED` | `true` | Auto-start the simulator when the server boots. |
| `STORYWORLD_TICK_MS` | `60000` | Base tick interval in milliseconds. |
| `COGNITIVE_NPC_INTERVAL_MS` | `45000` | Default cadence for NPC cognition loops. |

Set these in `.env` or `.env.local`. You can also start/stop loops programmatically by dispatching `CognitiveNpcAgent` tasks with metadata `{"npcId": "npc-123", "command": "step"}`.

## Persistence

- Lore Engine writes faction state to `data/storyworld/factions.json`.
- Dialog Memory stores NPC transcripts under `data/storyworld/dialogs/`.
- All simulation events and NPC actions are logged into `WorldMemory`, so the orchestrator and StoryWorld timeline remain in sync.

## Tips

- Enable pgvector to get high-quality dialog recall for NPC cognition. Without it, the engine falls back to recent transcript history.
- Use the Simulation tab’s “Fast-forward” control after large content imports to quickly rebalance factions.
- Combine StoryWorld commands with the simulator to introduce new factions, then let the engine evolve them autonomously.
