# Social Simulation & Multi-Agent Dialogue

The v11.8 upgrade layers an autonomous social fabric on top of the StoryWorld Engine. NPCs now gossip, negotiate, and influence faction economies without human input.

## Features

- **Dialog Engine** – pairs active cognitive NPCs for short gossip bursts, updates dialog memory, and adjusts trust via the social graph.
- **Social Graph** – tracks weighted trust, rivalry, and trade values between NPCs and factions, persisted under `data/storyworld/social-graph.json`.
- **Diplomacy Engine** – models treaties, rivalries, and wars between factions and announces shifts as simulation events.
- **Economy Engine** – simulates faction resource flows and exposes trends to both the dashboard and APIs.
- **Emotion Synthesis** – routes NPC dialogue through voice profiles with tone adjustments when `NPC_VOICE_EMOTION=true`.

## Dashboard Tour

Open the **Social** tab to inspect the live graph:

- **NPC Social Graph** – an auto-updating scatter visual showing connection density and recent conversations.
- **Recent Dialogue** – short transcripts from the dialog engine alongside social/economy simulation events.
- **Faction Influence & Diplomacy** – progress bars and highlights summarizing diplomacy status, tension, and resource pools.

The **Simulation** tab also surfaces a “Social Snapshot” card summarizing top relationships and diplomacy changes during each tick.

## API Endpoints

```http
GET /api/storyworld/social/state
```

Returns the serialized graph, diplomacy, economy, and dialogue snapshots. This endpoint requires authentication and the `viewer` role (or higher).

## Configuration

Add or edit the following entries in `.env` (see `.env.example` for defaults):

```env
SOCIAL_SIMULATION=true
DIALOGUE_LOOP_INTERVAL=5000
FACTION_DYNAMICS=true
NPC_VOICE_EMOTION=true
```

- **SOCIAL_SIMULATION** – toggles dialog, diplomacy, and economy subloops.
- **DIALOGUE_LOOP_INTERVAL** – minimum delay (ms) between autonomous NPC-to-NPC conversations.
- **FACTION_DYNAMICS** – enables diplomacy and economy adjustments during world ticks.
- **NPC_VOICE_EMOTION** – applies emotional tone presets via the `EmotionSynthesizer` when narrating NPC output.

## Persistence

All social data lives under `data/storyworld/`:

- `social-graph.json` – nodes (NPC/faction metadata) and weighted relationship edges.
- `dialogs/` – per-NPC transcripts recorded by the dialog engine.
- `worldmemory.db` – canonical world events and lore stored by the StoryWorld orchestrator.

Back up these assets if you intend to snapshot or migrate the simulation to another machine.

## Next Steps

- Extend `DialogEngine` prompts to include custom lore cues or player feedback.
- Feed social events into external analytics tooling via the `/api/storyworld/social/state` endpoint.
- Combine diplomacy tension with quest triggers to spawn faction-wide missions in Roblox experiences.
