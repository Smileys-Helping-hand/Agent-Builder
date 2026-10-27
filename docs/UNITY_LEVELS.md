# Unity Level Studio

Describe a level, get a playable Unity scene. It's in **Game Maker → Unity Level Studio**, or Jarvis's `unity.level`.

```
prompt ─▶ level plan (src/media/UnityLevelStudio.ts)
       ─▶ Blender models (unity/blender/build_level_assets.py)      when Blender is found
       ─▶ Unity batch mode (unity/AgentBuilderKit → AgentLevelBuilder.cs)
            terrain, painted layers, water, sky, sun, fog, ACES/bloom post,
            props, collectibles, enemies, exit, player, HUD → scene, previews, optional player build
```

- **The plan**: biome, time of day, palette, terrain, objective, enemies, assets, scatter rules and landmarks. It comes from the 3D model role (Gemini when `GEMINI_API_KEY` is set, else your Settings model); if the model doesn't answer usably, it falls back to biome rules, and the job says which. Assets are lists of parts (box, sphere, rock, cylinder, cone, torus) from `RECIPES`, or custom parts the model designs.
- **Blender** builds each asset with bevels, subdivision, noise displacement and sharp-edge normals, exports FBX into the level's `Models/` folder, and renders an asset sheet. Without Blender, Unity builds the same parts itself (`AbMeshKit.cs`).
- **Unity** builds `Assets/Scenes/AB_<name>.unity` in `UNITY_LEVEL_PROJECT` (default `E:\Projects\AgentBuilderLevels`, created from the URP template on first use, about 13 minutes). Each level is added to Build Settings in order, so several prompts make a multi-level game. The previews are `Builds/<name>/preview-*.png`.
- **Players**: "Windows game" builds an `.exe` (the first build compiles shaders, about 23 minutes); WebGL works if the editor has the module.

Controls in the level: WASD, mouse, Space to jump, Shift to sprint, Esc to pause. Collect every pickup, then reach the exit.

## Setup

| | |
|---|---|
| Unity | Any Hub editor; it prefers one with WebGL. `UNITY_EXE_PATH` overrides. |
| Blender | `BLENDER_PATH`, or Program Files, or a portable copy in `<drive>:\Tools\blender-*`. This PC: `E:\Tools\blender-5.2.3-windows-x64` (the blender.org zip, no admin needed). |
| Project | `UNITY_LEVEL_PROJECT`. Close it in the Unity Editor before building (batch mode cannot open it while it's open). |

## Tests

`npm run test:unity-level -- "<prompt>" [none|windows|webgl]` builds a level from the biome rules and checks the scene and previews.
