# NPC AI Agent

The **NPC AI** tab in the dashboard pairs with the `NpcAgent` backend service to generate Luau behaviour scripts for friendly greeters, quest givers, shopkeepers, and patrol guards.

## Usage

1. Describe the NPC role you need, such as *"Create quest NPC with shop dialogue and item exchange."*
2. Select a behaviour template (Dialogue, Patrol, or Shop) to use as a starting point.
3. Click **Generate NPC**. The request is forwarded to `/api/roblox/npc` which invokes the `NpcAgent`.
4. Generated scripts are saved under `games/roblox/npcs/` and streamed to Roblox Studio via the bridge.

## Live Updates

Whenever the bridge is connected, NPC scripts are pushed immediately so you can test dialogue, patrol paths, or trading logic without restarting Studio.

## Tips

- Combine NPC prompts with terrain generation to create fully populated experiences.
- Use the debug overlay (installed with the AgentBridge plugin) to request explanations or regenerations directly inside Roblox Studio.
