# AI Player Simulation & Global Goals

The v11.9 upgrade introduces autonomous "AI player" agents that explore the world alongside NPCs. Each simulated player maintains a personality profile, actively pursues global goals, and influences faction economies.

## Getting Started

1. Ensure the v11.9 environment variables are enabled:
   ```bash
   AI_PLAYER_SIMULATION=true
   MAX_AI_PLAYERS=10
   PLAYER_GOAL_INTERVAL=60000
   NARRATE_PLAYER_EVENTS=true
   ```

2. Launch the backend and dashboard as usual:
   ```bash
   npm run start
   npm --prefix dashboard run dev
   ```

3. Open the dashboard and select the **Players** tab to manage the simulation.

## Dashboard Controls

- **Add New AI Player** – Spawns a new autonomous player with unique traits, faction alignment, and resource inventory.
- **Assign Global Goal** – Creates a world-scale objective (conquest, discovery, diplomacy, artifact crafting, or exploration). Players will compete or collaborate to complete these goals.
- **Pause/Resume Simulation** – Temporarily halts or resumes the player cognition loop without affecting the wider world simulator.

The panel also surfaces live metrics:

- **Morale / Energy** – High morale keeps players proactive; low energy risks failing their current goal.
- **Influence / Reputation** – Tracks how successful the player has been when interacting with factions and NPCs.
- **Current Goals** – Displays active objectives with real-time progress.
- **Recent Events** – Streams the latest player deeds and global goal updates.

## Voice Narration

Each AI player receives a lightweight voice profile. When `NARRATE_PLAYER_EVENTS=true`, the voice controller narrates their latest accomplishments using emotion-aware TTS cues so you can follow the simulation audibly.

## Persistence & Lore

Player actions are recorded into the StoryWorld mythos ledger via `LoreEngine.recordPlayerDeed`. When a global goal completes, `LoreEngine.recordGoalImpact` adds the outcome to the persistent history. These records influence future world summaries, faction diplomacy, and economy snapshots.

## API Endpoints

- `GET /api/storyworld/players` – Retrieve current players, goal snapshot, and simulation status.
- `POST /api/storyworld/players` – Spawn a new AI player. Optional body: `{ "name": "Astra" }`.
- `POST /api/storyworld/players/control` – Pause or resume the player loop with `{ "action": "pause" }`.
- `POST /api/storyworld/goals` – Seed a new global goal with optional `{ "type": "discovery", "catalyst": "ancient ruins" }`.

These endpoints require authentication (viewer for reads, editor for writes).

## Advanced Configuration

- **MAX_AI_PLAYERS** – Cap the number of concurrent AI players. Exceeding the limit forces new spawns to replace the lowest influence player.
- **PLAYER_GOAL_INTERVAL** – Controls how often the goal engine spawns fresh global objectives (milliseconds).
- **NARRATE_PLAYER_EVENTS** – Toggle per-player voice narration.

Combine the player simulation with the Social and Simulation tabs to see how AI players reshape faction economies, diplomacy, and lore in real time.
