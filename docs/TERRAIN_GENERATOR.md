# Procedural Terrain Generator

The procedural terrain generator creates ready-to-use Roblox terrain scripts that can be synced into Studio from the dashboard.

## Generating Terrain

1. Navigate to the **Terrain** tab.
2. Enter a description, such as *"Generate mountains with caves and rivers."*
3. Choose a biome preset or use the default blend.
4. Click **Build Terrain**. The dashboard calls `/api/roblox/terrain` which runs the `TerrainGenerator` utility.

## Output

- Generated assets are saved to `games/roblox/terrain/` as Luau scripts based on `templates/roblox/terrain.lua`.
- The `RobloxAgent` automatically includes generated terrain files the next time it syncs a project.

## Advanced Options

- Provide a seed value to produce repeatable noise.
- Toggle **Auto-sync** to push scripts to Studio immediately through the bridge.

## Troubleshooting

If the generated terrain appears flat, ensure the Roblox workspace has Terrain enabled and that Studio accepted the script. Use the debug overlay to inspect logs from the generator.
