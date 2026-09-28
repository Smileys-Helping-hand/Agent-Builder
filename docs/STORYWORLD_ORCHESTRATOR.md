# StoryWorld Orchestrator Guide

The StoryWorld Orchestrator layers persistent narrative memory, AI-driven quests, and live Roblox updates on top of the Agent Builder. Use it to coordinate characters, factions, and terrain with natural language commands.

## Key Concepts

- **WorldMemory** — a hybrid SQLite + vector store that tracks entities, events, and relationships across sessions. Every quest, NPC, and terrain update is recorded with timestamps and tags.
- **Story Orchestrator** — routes your directives to the Quest, NPC, Terrain, and Roblox agents, then broadcasts updates to all dashboards.
- **Quest Agent** — produces Luau quest scripts, including multi-stage objectives and rewards, and syncs them to the Roblox Studio bridge.
- **Narrator Mode** — optional voiceover that reads story updates using the configured TTS profile.

## Running a Narrative Command

1. Open the **StoryWorld** tab inside the dashboard.
2. Enter a directive such as:
   - `Introduce a rival faction that disrupts the main questline.`
   - `Create a treasure hunt quest with escalating challenges.`
   - `Add scouts patrolling the desert biome.`
3. Choose a session ID to group related events (defaults to `storyworld`).
4. Enable **Narrate with voice** if you want synthesized audio.
5. Submit the command — the orchestrator will generate quests/NPCs/terrain as needed and log every step.

## Inspecting World Memory

- The **World Timeline** lists the 150 most recent StoryWorld events.
- Selecting an entry loads the **Entity Memory** sidebar with recent events, metadata, and relationships for that entity.
- The **Session Summary** refreshes automatically and can be regenerated via the refresh button.

## Voice Narration

Narration uses the `VOICE_NARRATOR_VOICE` environment variable (fallback `en-US-GuyNeural`). Assign additional voice profiles for NPCs via code by calling `VoiceController.assignVoiceProfile(entityId, profile)`.

## API Endpoints

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/storyworld/command` | POST | Execute a story directive. Requires editor role. |
| `/api/storyworld/events` | GET | List latest StoryWorld events. |
| `/api/storyworld/timeline` | GET | Fetch cached timeline maintained by the collaboration hub. |
| `/api/storyworld/summary` | GET | Summarize recent session activity. |
| `/api/storyworld/entities/:id` | GET | Recall entity metadata, events, and relationships. |

All endpoints require authentication. Commands additionally require editor-level access.

## Storage

WorldMemory stores data in `./data/storyworld/worldmemory.db` by default. Override with the `WORLD_MEMORY_DB` environment variable. The service also records narrative events into VectorMemory when configured (PGVECTOR_URL).

## Troubleshooting

- **Narration missing:** Ensure `VOICE_ENABLED=true` and edge-tts is installed. If the bridge is offline, narration falls back to cached text files.
- **No quests or NPCs created:** Add more explicit language (`quest`, `npc`, `terrain`) to the command so the heuristics route to the proper agents.
- **Roblox assets not updating:** Verify the Roblox Studio bridge is connected (green pulse) and the AgentBridge plugin is installed.
