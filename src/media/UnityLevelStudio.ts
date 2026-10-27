/**
 * UnityLevelStudio — designs and builds full, playable Unity levels from a prompt.
 *
 *   prompt ─▶ level plan (3D model role: Gemini when configured, else Settings)
 *          ─▶ Blender models (unity/blender/build_level_assets.py, when Blender is installed)
 *          ─▶ Unity batch mode: AgentLevelBuilder.cs builds the scene — sculpted
 *             terrain, painted layers, water, sky, fog, ACES/bloom post, the
 *             assets, collectibles, enemies, exit, player and HUD — renders
 *             preview images, and optionally builds a Windows or WebGL player.
 *
 * The plan is the contract between the three: AbLevelPlan.cs mirrors
 * LevelPlan here. Each asset is a list of parts (box / sphere / rock /
 * cylinder / cone / torus with a transform, a material slot and a noise
 * amount). Blender models them with bevels, subdivision and displacement;
 * without Blender, AbMeshKit.cs builds the same parts in Unity.
 *
 * The Unity project lives beside this repo (UNITY_LEVEL_PROJECT, default
 * ../AgentBuilderLevels) and is created from the editor's URP template on
 * first use. Each level becomes a scene (Assets/Scenes/AB_<name>.unity), in
 * build order, so successive prompts make a multi-level game.
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

import { ModelRouter } from "../tools/ModelRouter.js";
import { BlenderStudio } from "./BlenderStudio.js";
import { Logger } from "../utils/Logger.js";

// ---------------------------------------------------------------- the plan

export type Vec3 = [number, number, number];
export type PartShape = "box" | "sphere" | "rock" | "cylinder" | "cone" | "torus";

export interface AssetPart {
  shape: PartShape;
  pos: Vec3;
  rot: Vec3;
  scale: Vec3;
  /** 0 primary, 1 secondary, 2 glow */
  slot: 0 | 1 | 2;
  noise: number;
  taper: number;
  segments: number;
}

export interface LevelAsset {
  id: string;
  name: string;
  kind: string;
  primary: string;
  secondary: string;
  glow: string;
  emissive: boolean;
  roughness: number;
  metallic: number;
  collider: boolean;
  parts: AssetPart[];
}

export interface LevelPlan {
  name: string;
  title: string;
  story: string;
  biome: Biome;
  timeOfDay: "dawn" | "noon" | "sunset" | "night";
  fogDensity: number;
  palette: { ground: string; grass: string; rock: string; sand: string; sky: string; fog: string; water: string };
  terrain: { size: number; height: number; roughness: number; mountains: number; valley: number; water: boolean; waterLevel: number; seed: number };
  player: { speed: number; jumpHeight: number; color: string };
  objective: { pickupAssetId: string; goalAssetId: string; pickupLabel: string; goalLabel: string; count: number };
  enemies: { assetId: string; count: number; speed: number; radius: number };
  assets: LevelAsset[];
  scatter: Array<{ assetId: string; count: number; minHeight: number; maxHeight: number; maxSlope: number; minScale: number; maxScale: number; clustered: boolean }>;
  landmarks: Array<{ assetId: string; x: number; z: number; scale: number; yaw: number }>;
  /** Who designed it: the model, or these rules because the model did not answer usably. */
  plannedBy: "model" | "rules";
}

export const BIOMES = ["forest", "desert", "snow", "volcanic", "alien", "ruins", "coast", "swamp"] as const;
export type Biome = (typeof BIOMES)[number];

// ---------------------------------------------------------------- asset recipes

const P = (shape: PartShape, pos: Vec3, scale: Vec3, slot: 0 | 1 | 2 = 0, extra: Partial<AssetPart> = {}): AssetPart => ({
  shape, pos, rot: [0, 0, 0], scale, slot, noise: 0, taper: 1, segments: 0, ...extra
});

const ring = (count: number, radius: number, y: number, make: (x: number, z: number, yaw: number) => AssetPart): AssetPart[] =>
  Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return make(Math.cos(a) * radius, Math.sin(a) * radius, (-a * 180) / Math.PI);
  });

/** Parts for each kind the planner can ask for. Unity coordinates, metres, origin at the base. */
export const RECIPES: Record<string, () => AssetPart[]> = {
  tree: () => [
    P("cylinder", [0, 1.4, 0], [0.5, 2.8, 0.5], 1, { taper: 0.6, noise: 0.08 }),
    P("cylinder", [0.45, 2.3, 0], [0.18, 1.2, 0.18], 1, { rot: [0, 0, -40], taper: 0.5 }),
    P("sphere", [0, 3.8, 0], [3.2, 2.5, 3.2], 0, { noise: 0.35 }),
    P("sphere", [1.0, 3.2, 0.5], [2.1, 1.8, 2.1], 0, { noise: 0.3 }),
    P("sphere", [-0.9, 3.3, -0.6], [2.2, 1.9, 2.2], 0, { noise: 0.3 })
  ],
  pine: () => [
    P("cylinder", [0, 1, 0], [0.38, 2, 0.38], 1, { taper: 0.7 }),
    P("cone", [0, 2.4, 0], [2.8, 2.3, 2.8], 0, { noise: 0.1, segments: 10 }),
    P("cone", [0, 3.6, 0], [2.1, 2, 2.1], 0, { noise: 0.1, segments: 10 }),
    P("cone", [0, 4.7, 0], [1.4, 1.7, 1.4], 0, { noise: 0.1, segments: 10 })
  ],
  palm: () => [
    // Unity's +Z rotation leans the top towards -X; the trunk leans and steps towards +X, so its angles are negative.
    P("cylinder", [0.04, 1, 0], [0.38, 2.1, 0.38], 1, { rot: [0, 0, -4], taper: 0.9 }),
    P("cylinder", [0.2, 2.85, 0], [0.32, 2.1, 0.32], 1, { rot: [0, 0, -9], taper: 0.85 }),
    ...[0, 60, 120].map((yaw) => P("sphere", [0.4, 3.95, 0], [3.4, 0.22, 0.9], 0, { rot: [0, yaw, -12], noise: 0.15 })),
    P("sphere", [0.45, 3.7, 0.25], [0.35, 0.35, 0.35], 1),
    P("sphere", [0.2, 3.7, -0.25], [0.35, 0.35, 0.35], 1)
  ],
  dead_tree: () => [
    P("cylinder", [0, 1.6, 0], [0.55, 3.2, 0.55], 0, { taper: 0.4, noise: 0.25 }),
    P("cylinder", [0.5, 2.6, 0], [0.16, 1.6, 0.16], 0, { rot: [0, 0, -50], taper: 0.3, noise: 0.2 }),
    P("cylinder", [-0.4, 2.2, 0.2], [0.14, 1.3, 0.14], 0, { rot: [20, 0, 45], taper: 0.3, noise: 0.2 })
  ],
  bush: () => [
    P("sphere", [0, 0.5, 0], [1.6, 1.1, 1.6], 0, { noise: 0.4 }),
    P("sphere", [0.6, 0.4, 0.3], [1.1, 0.8, 1.1], 0, { noise: 0.4 }),
    P("sphere", [-0.5, 0.35, -0.3], [1.0, 0.7, 1.0], 0, { noise: 0.4 })
  ],
  rock: () => [P("rock", [0, 0.45, 0], [2, 1.4, 1.7], 0, { noise: 0.4 })],
  boulder: () => [
    P("rock", [0, 1, 0], [3.6, 2.6, 3.1], 0, { noise: 0.45 }),
    P("rock", [1.7, 0.45, 0.9], [1.4, 1, 1.2], 0, { noise: 0.4 })
  ],
  crystal: () => [
    P("cylinder", [0, 0.7, 0], [0.5, 1.4, 0.5], 2, { segments: 6 }),
    P("cone", [0, 1.65, 0], [0.5, 0.5, 0.5], 2, { segments: 6 }),
    P("cylinder", [0.3, 0.45, 0.1], [0.3, 0.9, 0.3], 2, { segments: 6, rot: [0, 0, -22] }),
    P("cone", [0.52, 1.05, 0.1], [0.3, 0.32, 0.3], 2, { segments: 6, rot: [0, 0, -22] }),
    P("rock", [0, 0.1, 0], [1.1, 0.35, 1.0], 0, { noise: 0.3 })
  ],
  ice_spike: () => [
    P("cone", [0, 1.6, 0], [1.1, 3.2, 1.1], 0, { segments: 7, noise: 0.05 }),
    P("cone", [0.7, 0.9, 0.2], [0.6, 1.8, 0.6], 0, { segments: 7, rot: [0, 0, -18] })
  ],
  lava_rock: () => [
    P("rock", [0, 0.7, 0], [2.4, 1.6, 2.1], 0, { noise: 0.45 }),
    P("rock", [0.2, 1.25, 0.1], [1.2, 0.5, 1.0], 2, { noise: 0.3 })
  ],
  mushroom: () => [
    P("cylinder", [0, 0.8, 0], [0.5, 1.6, 0.5], 1, { taper: 0.8 }),
    P("sphere", [0, 1.7, 0], [2.3, 1.0, 2.3], 0, { noise: 0.08 }),
    P("sphere", [0.5, 2.05, 0.4], [0.3, 0.15, 0.3], 2),
    P("sphere", [-0.6, 2.0, -0.2], [0.28, 0.14, 0.28], 2)
  ],
  cactus: () => [
    P("cylinder", [0, 1.5, 0], [0.65, 3, 0.65], 0, { segments: 12 }),
    P("sphere", [0, 3.0, 0], [0.65, 0.5, 0.65], 0),
    P("cylinder", [0.55, 1.6, 0], [0.4, 1.2, 0.4], 0, { segments: 12, rot: [0, 0, -70] }),
    P("cylinder", [0.85, 2.2, 0], [0.38, 1.0, 0.38], 0, { segments: 12 }),
    P("cylinder", [-0.5, 2.0, 0], [0.36, 0.9, 0.36], 0, { segments: 12, rot: [0, 0, 70] }),
    P("cylinder", [-0.78, 2.45, 0], [0.34, 0.8, 0.34], 0, { segments: 12 })
  ],
  house: () => [
    P("box", [0, 1.5, 0], [4, 3, 3.4], 0),
    // A gable: Unity's +X rotation tips a panel's +Z edge down, so the back
    // panel turns -35° and the front +35° to meet at the ridge (the other way is a V).
    P("box", [0, 3.7, -0.9], [4.5, 0.22, 2.4], 1, { rot: [-35, 0, 0] }),
    P("box", [0, 3.7, 0.9], [4.5, 0.22, 2.4], 1, { rot: [35, 0, 0] }),
    P("box", [0, 0.95, 1.72], [0.95, 1.9, 0.1], 1),
    P("box", [-1.25, 1.8, 1.72], [0.75, 0.75, 0.08], 2),
    P("box", [1.25, 1.8, 1.72], [0.75, 0.75, 0.08], 2),
    P("box", [1.3, 4.2, -0.4], [0.5, 1.4, 0.5], 1),
    P("box", [0, 0.12, 0], [4.4, 0.25, 3.8], 1)
  ],
  tower: () => [
    P("cylinder", [0, 4, 0], [3, 8, 3], 0, { segments: 24 }),
    P("cylinder", [0, 8.3, 0], [3.7, 0.6, 3.7], 0, { segments: 24 }),
    ...ring(8, 1.65, 8.9, (x, z, yaw) => P("box", [x, 8.9, z], [0.55, 0.6, 0.55], 0, { rot: [0, yaw, 0] })),
    P("cone", [0, 10.4, 0], [3.4, 2.6, 3.4], 1, { segments: 24 }),
    P("box", [0, 6, 1.48], [0.5, 0.9, 0.12], 2),
    P("box", [0, 3, 1.48], [0.5, 0.9, 0.12], 2),
    P("box", [0, 1.1, 1.5], [1.0, 2.0, 0.15], 1)
  ],
  pillar: () => [
    P("box", [0, 0.2, 0], [1.4, 0.4, 1.4], 0),
    P("cylinder", [0, 2.4, 0], [1, 4, 1], 0, { segments: 12, noise: 0.04 }),
    P("box", [0, 4.55, 0], [1.3, 0.35, 1.3], 0)
  ],
  arch: () => [
    P("box", [-1.8, 0.2, 0], [1.3, 0.4, 1.3], 0),
    P("cylinder", [-1.8, 2.2, 0], [0.9, 3.6, 0.9], 0, { segments: 12, noise: 0.04 }),
    P("box", [1.8, 0.2, 0], [1.3, 0.4, 1.3], 0),
    P("cylinder", [1.8, 2.2, 0], [0.9, 3.6, 0.9], 0, { segments: 12, noise: 0.04 }),
    P("box", [0, 4.3, 0], [5.0, 0.7, 1.2], 0)
  ],
  statue: () => [
    P("box", [0, 0.6, 0], [1.8, 1.2, 1.8], 1),
    P("cylinder", [0, 2.2, 0], [0.9, 2.0, 0.7], 0, { taper: 0.75 }),
    P("sphere", [0, 3.55, 0], [0.75, 0.85, 0.75], 0),
    P("cylinder", [0.62, 2.5, 0], [0.25, 1.4, 0.25], 0, { rot: [0, 0, 25] }),
    P("cylinder", [-0.62, 2.5, 0], [0.25, 1.4, 0.25], 0, { rot: [0, 0, -25] })
  ],
  crate: () => [
    P("box", [0, 0.5, 0], [1, 1, 1], 0),
    P("box", [0, 0.5, 0], [1.04, 0.14, 1.04], 1),
    P("box", [0, 0.5, 0], [0.14, 1.04, 1.04], 1)
  ],
  chest: () => [
    P("box", [0, 0.35, 0], [1.2, 0.7, 0.8], 0),
    P("cylinder", [0, 0.72, 0], [0.8, 1.2, 0.8], 0, { rot: [0, 0, 90], segments: 16 }),
    P("box", [-0.42, 0.55, 0], [0.12, 1.0, 0.86], 1),
    P("box", [0.42, 0.55, 0], [0.12, 1.0, 0.86], 1),
    P("box", [0, 0.55, 0.42], [0.18, 0.22, 0.06], 2)
  ],
  lamp: () => [
    P("cylinder", [0, 1.5, 0], [0.16, 3, 0.16], 1, { segments: 12 }),
    P("sphere", [0, 3.15, 0], [0.55, 0.55, 0.55], 2),
    P("cone", [0, 3.55, 0], [0.8, 0.4, 0.8], 1, { segments: 12 }),
    P("cylinder", [0, 0.1, 0], [0.5, 0.2, 0.5], 1, { segments: 12 })
  ],
  fence: () => [
    P("box", [-1.2, 0.6, 0], [0.16, 1.2, 0.16], 0),
    P("box", [0, 0.6, 0], [0.16, 1.2, 0.16], 0),
    P("box", [1.2, 0.6, 0], [0.16, 1.2, 0.16], 0),
    P("box", [0, 0.85, 0], [2.6, 0.12, 0.08], 0),
    P("box", [0, 0.45, 0], [2.6, 0.12, 0.08], 0)
  ],
  campfire: () => [
    ...ring(7, 0.75, 0.15, (x, z) => P("rock", [x, 0.15, z], [0.4, 0.3, 0.35], 0, { noise: 0.3 })),
    P("cylinder", [0, 0.2, 0], [0.2, 1.2, 0.2], 1, { rot: [0, 30, 75] }),
    P("cylinder", [0, 0.2, 0], [0.2, 1.2, 0.2], 1, { rot: [0, -40, 75] }),
    P("cone", [0, 0.6, 0], [0.6, 0.9, 0.6], 2, { noise: 0.2 })
  ],
  portal: () => [
    P("torus", [0, 2.4, 0], [4.2, 4.2, 4.2], 2, { rot: [90, 0, 0] }),
    P("box", [0, 0.25, 0], [4.4, 0.5, 1.6], 0),
    P("rock", [-2.1, 0.6, 0], [1.0, 1.4, 1.0], 1, { noise: 0.3 }),
    P("rock", [2.1, 0.6, 0], [1.0, 1.4, 1.0], 1, { noise: 0.3 })
  ],
  drone: () => [
    P("sphere", [0, 0, 0], [1.2, 1.2, 1.2], 0),
    P("sphere", [0, 0, 0.55], [0.42, 0.42, 0.22], 2),
    P("torus", [0, 0, 0], [1.9, 1.9, 1.9], 1),
    P("box", [0, 0.75, 0], [0.12, 0.5, 0.12], 1)
  ],
  slime: () => [
    P("sphere", [0, -0.2, 0], [1.6, 1.1, 1.6], 0, { noise: 0.1 }),
    P("sphere", [0.3, 0.15, 0.62], [0.25, 0.3, 0.12], 2),
    P("sphere", [-0.3, 0.15, 0.62], [0.25, 0.3, 0.12], 2)
  ],
  golem: () => [
    P("rock", [0, 0.2, 0], [1.5, 1.6, 1.1], 0, { noise: 0.35 }),
    P("rock", [0, 1.2, 0.1], [0.9, 0.8, 0.8], 0, { noise: 0.3 }),
    P("rock", [0.95, 0.3, 0], [0.55, 1.1, 0.55], 0, { noise: 0.3 }),
    P("rock", [-0.95, 0.3, 0], [0.55, 1.1, 0.55], 0, { noise: 0.3 }),
    P("box", [0, 1.25, 0.5], [0.5, 0.12, 0.1], 2)
  ]
};

const ENEMY_KINDS = ["drone", "slime", "golem"];

// ---------------------------------------------------------------- biome presets

type Preset = Omit<LevelPlan, "name" | "title" | "story" | "plannedBy" | "assets"> & {
  kinds: Array<{ kind: string; primary: string; secondary: string; glow?: string; emissive?: boolean; roughness?: number; metallic?: number }>;
};

const scatter = (assetId: string, count: number, clustered = false, minHeight = 0, maxHeight = 0.7, maxSlope = 32) =>
  ({ assetId, count, minHeight, maxHeight, maxSlope, minScale: 0.75, maxScale: 1.35, clustered });

const PRESETS: Record<Biome, Preset> = {
  forest: {
    biome: "forest", timeOfDay: "noon", fogDensity: 0.006,
    palette: { ground: "#6B5A42", grass: "#4F7F35", rock: "#7D7A74", sand: "#C9B68C", sky: "#7FB8F0", fog: "#B9CCD8", water: "#2C6E8A" },
    terrain: { size: 220, height: 48, roughness: 0.5, mountains: 0.7, valley: 0.4, water: true, waterLevel: 0.1, seed: 7 },
    player: { speed: 6, jumpHeight: 1.6, color: "#E9E2CF" },
    objective: { pickupAssetId: "crystal", goalAssetId: "portal", pickupLabel: "spirit crystals", goalLabel: "the old portal", count: 6 },
    enemies: { assetId: "drone", count: 3, speed: 3, radius: 7 },
    kinds: [
      { kind: "tree", primary: "#3F7A2E", secondary: "#5A3E2B" }, { kind: "pine", primary: "#2E5E33", secondary: "#4E3726" },
      { kind: "bush", primary: "#4A8236", secondary: "#3A2A1E" }, { kind: "rock", primary: "#8A867E", secondary: "#5E5A55" },
      { kind: "tower", primary: "#A49A88", secondary: "#6E3B2E", glow: "#FFC870" }, { kind: "house", primary: "#C9B28E", secondary: "#7A4632", glow: "#FFCC77" },
      { kind: "crystal", primary: "#6E6A66", secondary: "#444", glow: "#4FE3FF", emissive: true }, { kind: "portal", primary: "#8B857A", secondary: "#5C574F", glow: "#7CF2FF", emissive: true },
      { kind: "drone", primary: "#3A3F47", secondary: "#9AA3AD", glow: "#FF4D4D", emissive: true, metallic: 0.7, roughness: 0.35 }
    ],
    scatter: [scatter("tree", 130, true, 0, 0.55), scatter("pine", 70, true, 0.2, 0.8, 35), scatter("bush", 120), scatter("rock", 50, false, 0, 0.9, 45)],
    landmarks: [{ assetId: "tower", x: 0.28, z: 0.7, scale: 1.2, yaw: 30 }, { assetId: "house", x: 0.62, z: 0.36, scale: 1, yaw: 200 }, { assetId: "house", x: 0.67, z: 0.4, scale: 1, yaw: 160 }]
  },
  desert: {
    biome: "desert", timeOfDay: "sunset", fogDensity: 0.004,
    palette: { ground: "#B07A4A", grass: "#D4A86A", rock: "#A0613C", sand: "#E3C48E", sky: "#F2B27A", fog: "#E9C39A", water: "#3A8FA0" },
    terrain: { size: 240, height: 42, roughness: 0.35, mountains: 0.8, valley: 0.2, water: false, waterLevel: 0.05, seed: 11 },
    player: { speed: 6.5, jumpHeight: 1.6, color: "#F1E6D2" },
    objective: { pickupAssetId: "chest", goalAssetId: "portal", pickupLabel: "lost relics", goalLabel: "the sun gate", count: 6 },
    enemies: { assetId: "slime", count: 4, speed: 3.2, radius: 8 },
    kinds: [
      { kind: "cactus", primary: "#5E8A44", secondary: "#3E5A2C" }, { kind: "rock", primary: "#A86A44", secondary: "#7A4A30" },
      { kind: "boulder", primary: "#9E5E3A", secondary: "#7A4A30" }, { kind: "dead_tree", primary: "#6E5640", secondary: "#4A3A2A" },
      { kind: "pillar", primary: "#D9C08E", secondary: "#A88F66" }, { kind: "arch", primary: "#D2B482", secondary: "#A88F66" },
      { kind: "chest", primary: "#7A4E2A", secondary: "#C9A43A", glow: "#FFD45E", emissive: true, metallic: 0.4 },
      { kind: "portal", primary: "#CDB386", secondary: "#9A7F5A", glow: "#FFB347", emissive: true },
      { kind: "slime", primary: "#C77B3A", secondary: "#000", glow: "#FFF1A8", emissive: true, roughness: 0.2 }
    ],
    scatter: [scatter("cactus", 80), scatter("rock", 70, false, 0, 0.9, 45), scatter("boulder", 20, true, 0, 0.9, 45), scatter("dead_tree", 15), scatter("pillar", 14, true)],
    landmarks: [{ assetId: "arch", x: 0.4, z: 0.62, scale: 1.6, yaw: 15 }, { assetId: "pillar", x: 0.6, z: 0.3, scale: 1.4, yaw: 0 }, { assetId: "pillar", x: 0.64, z: 0.33, scale: 1.1, yaw: 40 }]
  },
  snow: {
    biome: "snow", timeOfDay: "dawn", fogDensity: 0.01,
    palette: { ground: "#C9D2DC", grass: "#E8EEF4", rock: "#6F7883", sand: "#DCE3EA", sky: "#A9C4E8", fog: "#D7E2EE", water: "#3D6F96" },
    terrain: { size: 220, height: 55, roughness: 0.6, mountains: 0.9, valley: 0.35, water: true, waterLevel: 0.08, seed: 23 },
    player: { speed: 5.5, jumpHeight: 1.5, color: "#C2403A" },
    objective: { pickupAssetId: "crystal", goalAssetId: "portal", pickupLabel: "frost shards", goalLabel: "the frozen gate", count: 6 },
    enemies: { assetId: "golem", count: 3, speed: 2.6, radius: 6 },
    kinds: [
      { kind: "pine", primary: "#2F5A45", secondary: "#4A3828" }, { kind: "rock", primary: "#77808A", secondary: "#565E66" },
      { kind: "ice_spike", primary: "#BFE6FF", secondary: "#8FC8F0", roughness: 0.1 }, { kind: "tower", primary: "#8E949C", secondary: "#3E4A5A", glow: "#FFD27A" },
      { kind: "house", primary: "#8A6A4E", secondary: "#E6ECF2", glow: "#FFCC77" },
      { kind: "crystal", primary: "#77808A", secondary: "#555", glow: "#9FE8FF", emissive: true }, { kind: "portal", primary: "#8E949C", secondary: "#5E6670", glow: "#9FE8FF", emissive: true },
      { kind: "golem", primary: "#9AA6B4", secondary: "#667", glow: "#6FD6FF", emissive: true }
    ],
    scatter: [scatter("pine", 160, true, 0, 0.75, 35), scatter("rock", 60, false, 0, 1, 50), scatter("ice_spike", 30, true, 0, 0.6)],
    landmarks: [{ assetId: "tower", x: 0.3, z: 0.65, scale: 1.2, yaw: 0 }, { assetId: "house", x: 0.6, z: 0.4, scale: 1, yaw: 190 }]
  },
  volcanic: {
    biome: "volcanic", timeOfDay: "night", fogDensity: 0.012,
    palette: { ground: "#3A2E2A", grass: "#4A3A33", rock: "#2B2523", sand: "#5A3F33", sky: "#5A2A2A", fog: "#5E2E22", water: "#FF5A1F" },
    terrain: { size: 220, height: 50, roughness: 0.7, mountains: 0.9, valley: 0.45, water: true, waterLevel: 0.12, seed: 31 },
    player: { speed: 6, jumpHeight: 1.7, color: "#D8D2C4" },
    objective: { pickupAssetId: "crystal", goalAssetId: "portal", pickupLabel: "ember cores", goalLabel: "the obsidian gate", count: 6 },
    enemies: { assetId: "golem", count: 4, speed: 3, radius: 7 },
    kinds: [
      { kind: "lava_rock", primary: "#2A2321", secondary: "#000", glow: "#FF6A1F", emissive: true }, { kind: "boulder", primary: "#332B28", secondary: "#221C1A" },
      { kind: "dead_tree", primary: "#2E2724", secondary: "#1E1A18" }, { kind: "pillar", primary: "#3A3330", secondary: "#2A2422" },
      { kind: "crystal", primary: "#2A2321", secondary: "#000", glow: "#FF8A2A", emissive: true }, { kind: "portal", primary: "#2E2826", secondary: "#1A1615", glow: "#FF3D1F", emissive: true },
      { kind: "golem", primary: "#3A302C", secondary: "#000", glow: "#FF7A2A", emissive: true }
    ],
    scatter: [scatter("lava_rock", 70, false, 0, 1, 50), scatter("boulder", 30, true, 0, 1, 50), scatter("dead_tree", 35), scatter("pillar", 10, true)],
    landmarks: [{ assetId: "pillar", x: 0.35, z: 0.65, scale: 2, yaw: 10 }, { assetId: "pillar", x: 0.4, z: 0.68, scale: 1.6, yaw: 50 }]
  },
  alien: {
    biome: "alien", timeOfDay: "night", fogDensity: 0.01,
    palette: { ground: "#3C2E58", grass: "#5A3E8A", rock: "#3A4458", sand: "#7A6AA0", sky: "#3A2A6A", fog: "#4A3A7A", water: "#1FD8C4" },
    terrain: { size: 220, height: 46, roughness: 0.55, mountains: 0.75, valley: 0.4, water: true, waterLevel: 0.11, seed: 47 },
    player: { speed: 6.5, jumpHeight: 2.2, color: "#E6E8F0" },
    objective: { pickupAssetId: "crystal", goalAssetId: "portal", pickupLabel: "star seeds", goalLabel: "the beacon ring", count: 7 },
    enemies: { assetId: "drone", count: 4, speed: 3.4, radius: 8 },
    kinds: [
      { kind: "mushroom", primary: "#7A3AC8", secondary: "#D8C8F0", glow: "#5CFFE0", emissive: true }, { kind: "crystal", primary: "#3A4458", secondary: "#222", glow: "#FF5CF0", emissive: true },
      { kind: "rock", primary: "#46506A", secondary: "#333" }, { kind: "boulder", primary: "#3E4860", secondary: "#2A3040" },
      { kind: "portal", primary: "#3E4860", secondary: "#2A3040", glow: "#5CFFE0", emissive: true },
      { kind: "drone", primary: "#C8CCD8", secondary: "#5A6070", glow: "#5CFFE0", emissive: true, metallic: 0.8, roughness: 0.25 }
    ],
    scatter: [scatter("mushroom", 110, true), scatter("crystal", 40, true, 0, 0.9, 40), scatter("rock", 50, false, 0, 1, 50), scatter("boulder", 15, true, 0, 1, 50)],
    landmarks: [{ assetId: "boulder", x: 0.35, z: 0.66, scale: 2.4, yaw: 0 }]
  },
  ruins: {
    biome: "ruins", timeOfDay: "sunset", fogDensity: 0.008,
    palette: { ground: "#6E5E48", grass: "#6F8040", rock: "#8A8070", sand: "#BFA67A", sky: "#E8A878", fog: "#D8B898", water: "#3A7A80" },
    terrain: { size: 220, height: 44, roughness: 0.45, mountains: 0.7, valley: 0.35, water: true, waterLevel: 0.09, seed: 53 },
    player: { speed: 6, jumpHeight: 1.6, color: "#E6DCC6" },
    objective: { pickupAssetId: "chest", goalAssetId: "portal", pickupLabel: "temple keys", goalLabel: "the sealed gate", count: 6 },
    enemies: { assetId: "golem", count: 3, speed: 2.8, radius: 7 },
    kinds: [
      { kind: "pillar", primary: "#CDBF9E", secondary: "#9A8D70" }, { kind: "arch", primary: "#C8B894", secondary: "#9A8D70" },
      { kind: "statue", primary: "#BDB4A0", secondary: "#8A8070" }, { kind: "tree", primary: "#557A30", secondary: "#5A402C" },
      { kind: "bush", primary: "#5E7A34", secondary: "#3A2A1E" }, { kind: "rock", primary: "#8C8270", secondary: "#5E5848" },
      { kind: "chest", primary: "#6A4426", secondary: "#C9A43A", glow: "#FFD45E", emissive: true, metallic: 0.4 },
      { kind: "portal", primary: "#C8B894", secondary: "#9A8D70", glow: "#FFC85E", emissive: true },
      { kind: "golem", primary: "#9A907C", secondary: "#555", glow: "#7CFFB0", emissive: true }
    ],
    scatter: [scatter("pillar", 40, true), scatter("arch", 8, true), scatter("tree", 60, true, 0, 0.6), scatter("bush", 90), scatter("rock", 50, false, 0, 0.9, 45)],
    landmarks: [{ assetId: "statue", x: 0.42, z: 0.6, scale: 2.2, yaw: 180 }, { assetId: "arch", x: 0.58, z: 0.42, scale: 1.8, yaw: 30 }]
  },
  coast: {
    biome: "coast", timeOfDay: "noon", fogDensity: 0.004,
    palette: { ground: "#8A7650", grass: "#6FA040", rock: "#8C8478", sand: "#EAD6A0", sky: "#78C0F8", fog: "#C8E0F0", water: "#1E8AB0" },
    terrain: { size: 220, height: 40, roughness: 0.4, mountains: 0.6, valley: 0.55, water: true, waterLevel: 0.16, seed: 61 },
    player: { speed: 6.5, jumpHeight: 1.6, color: "#F2EEE4" },
    objective: { pickupAssetId: "chest", goalAssetId: "portal", pickupLabel: "pirate coins", goalLabel: "the lighthouse gate", count: 6 },
    enemies: { assetId: "slime", count: 3, speed: 3, radius: 7 },
    kinds: [
      { kind: "palm", primary: "#4E8A34", secondary: "#7A5A3A" }, { kind: "rock", primary: "#908878", secondary: "#666" },
      { kind: "crate", primary: "#9A7046", secondary: "#5A3E26" }, { kind: "lamp", primary: "#333", secondary: "#2A2A2A", glow: "#FFD27A", emissive: true },
      { kind: "house", primary: "#E8E0CC", secondary: "#3A6E9A", glow: "#FFCC77" }, { kind: "tower", primary: "#F0ECE2", secondary: "#C0392B", glow: "#FFF2A8", emissive: true },
      { kind: "chest", primary: "#6A4426", secondary: "#C9A43A", glow: "#FFD45E", emissive: true, metallic: 0.4 },
      { kind: "portal", primary: "#8C8478", secondary: "#666", glow: "#5CE8FF", emissive: true },
      { kind: "slime", primary: "#3AA8C8", secondary: "#000", glow: "#E8FFFF", emissive: true, roughness: 0.15 }
    ],
    scatter: [scatter("palm", 70, true, 0, 0.5), scatter("rock", 50, false, 0, 0.9, 45), scatter("crate", 14, true), scatter("lamp", 10, true)],
    landmarks: [{ assetId: "tower", x: 0.3, z: 0.3, scale: 1.3, yaw: 0 }, { assetId: "house", x: 0.6, z: 0.62, scale: 1, yaw: 200 }, { assetId: "house", x: 0.65, z: 0.58, scale: 1, yaw: 170 }]
  },
  swamp: {
    biome: "swamp", timeOfDay: "sunset", fogDensity: 0.02,
    palette: { ground: "#3E3A28", grass: "#4A5A2A", rock: "#4E5048", sand: "#5E5636", sky: "#8A8A6A", fog: "#6A7058", water: "#2E3E28" },
    terrain: { size: 200, height: 34, roughness: 0.4, mountains: 0.65, valley: 0.6, water: true, waterLevel: 0.18, seed: 71 },
    player: { speed: 5.5, jumpHeight: 1.6, color: "#D8D0B8" },
    objective: { pickupAssetId: "mushroom", goalAssetId: "portal", pickupLabel: "glowcaps", goalLabel: "the witch's circle", count: 6 },
    enemies: { assetId: "slime", count: 4, speed: 2.8, radius: 6 },
    kinds: [
      { kind: "dead_tree", primary: "#3A3428", secondary: "#2A2418" }, { kind: "tree", primary: "#3E5A28", secondary: "#3A2E20" },
      { kind: "mushroom", primary: "#8A5A2A", secondary: "#D8CCA8", glow: "#B8FF5C", emissive: true }, { kind: "bush", primary: "#3E5226", secondary: "#2A2418" },
      { kind: "rock", primary: "#55574E", secondary: "#3A3C34" }, { kind: "campfire", primary: "#55574E", secondary: "#4A3020", glow: "#FF8A2A", emissive: true },
      { kind: "portal", primary: "#4E5048", secondary: "#3A3C34", glow: "#B8FF5C", emissive: true },
      { kind: "slime", primary: "#5A8A2A", secondary: "#000", glow: "#F0FFB0", emissive: true, roughness: 0.2 }
    ],
    scatter: [scatter("dead_tree", 70, true), scatter("tree", 40, true, 0, 0.6), scatter("mushroom", 50, true), scatter("bush", 90), scatter("rock", 30)],
    landmarks: [{ assetId: "campfire", x: 0.55, z: 0.45, scale: 1.2, yaw: 0 }]
  }
};

const BIOME_WORDS: Record<Biome, RegExp> = {
  forest: /\b(forest\w*|wood(s|land)?|jungle\w*|grove\w*|elf|elven|meadow\w*)\b/i,
  desert: /\b(desert\w*|dunes?|sand\w*|egypt\w*|pharaoh\w*|canyons?|wasteland\w*|western|cowboys?)\b/i,
  snow: /\b(snow\w*|ice|icy|frozen|arctic|winter\w*|glacier\w*|tundra|frost\w*)\b/i,
  volcanic: /\b(volcan\w*|lava|magma|fire|inferno|hell|ember|obsidian)\b/i,
  alien: /\b(aliens?|space|planets?|sci-?fi|cosmic|galax\w*|neon|cyber\w*|stars?)\b/i,
  ruins: /\b(ruin\w*|temples?|ancient|aztec|mayan?|greek|roman|tombs?|lost city)\b/i,
  coast: /\b(beach\w*|coast\w*|islands?|pirates?|tropical|ocean\w*|sea|harbou?rs?|lighthouses?)\b/i,
  swamp: /\b(swamp\w*|marsh\w*|bogs?|bayou|witch\w*|haunted|spooky|horror)\b/i
};

export const detectBiome = (prompt: string): Biome =>
  (Object.keys(BIOME_WORDS) as Biome[]).find((b) => BIOME_WORDS[b].test(prompt)) ?? "forest";

// ---------------------------------------------------------------- sanitising

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (value: unknown, fallback: string): string => (typeof value === "string" && HEX.test(value.trim()) ? value.trim() : fallback);
const num = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const text = (value: unknown, fallback: string, max = 400): string =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
export const slug = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "level";
const vec = (value: unknown, fallback: Vec3, min: number, max: number): Vec3 =>
  Array.isArray(value) && value.length >= 3 ? [num(value[0], fallback[0], min, max), num(value[1], fallback[1], min, max), num(value[2], fallback[2], min, max)] : fallback;
const SHAPES: PartShape[] = ["box", "sphere", "rock", "cylinder", "cone", "torus"];

const cleanParts = (parts: unknown): AssetPart[] =>
  (Array.isArray(parts) ? parts : []).slice(0, 24).flatMap((raw: any) => {
    if (!raw || !SHAPES.includes(raw.shape)) return [];
    return [{
      shape: raw.shape as PartShape,
      pos: vec(raw.pos, [0, 0, 0], -20, 40),
      rot: vec(raw.rot, [0, 0, 0], -360, 360),
      scale: vec(raw.scale, [1, 1, 1], 0.02, 40),
      slot: (num(raw.slot, 0, 0, 2) | 0) as 0 | 1 | 2,
      noise: num(raw.noise, 0, 0, 1),
      taper: num(raw.taper, 1, 0, 3),
      segments: num(raw.segments, 0, 0, 64) | 0
    }];
  });

const assetFrom = (raw: any, fallbackKind: string): LevelAsset => {
  const kind = typeof raw?.kind === "string" && RECIPES[raw.kind] ? raw.kind : fallbackKind;
  const custom = cleanParts(raw?.parts);
  return {
    id: slug(text(raw?.id, kind)),
    name: text(raw?.name, kind.replace(/_/g, " "), 60),
    kind,
    primary: hex(raw?.primary, "#808080"),
    secondary: hex(raw?.secondary, "#404040"),
    glow: hex(raw?.glow, "#4FE3FF"),
    emissive: raw?.emissive === true,
    roughness: num(raw?.roughness, 0.8, 0, 1),
    metallic: num(raw?.metallic, 0, 0, 1),
    collider: raw?.collider !== false,
    // The model may design its own asset from parts; otherwise the recipe.
    parts: custom.length >= 1 ? custom : (RECIPES[kind] ?? RECIPES.rock)()
  };
};

/** Turns whatever the model sent (or nothing) into a plan the Unity builder can always build. */
export const sanitizePlan = (raw: any, prompt: string, plannedBy: LevelPlan["plannedBy"]): LevelPlan => {
  const biome: Biome = BIOMES.includes(raw?.biome) ? raw.biome : detectBiome(prompt);
  const preset = PRESETS[biome];
  const title = text(raw?.title, prompt.replace(/\s+/g, " ").slice(0, 48) || `The ${biome} level`, 60);
  const times = ["dawn", "noon", "sunset", "night"] as const;

  const assets: LevelAsset[] = [];
  const add = (asset: LevelAsset) => {
    if (!assets.some((a) => a.id === asset.id)) assets.push(asset);
  };
  for (const a of Array.isArray(raw?.assets) ? raw.assets.slice(0, 16) : []) add(assetFrom(a, "rock"));
  if (assets.length === 0) for (const k of preset.kinds) add(assetFrom({ ...k, id: k.kind }, k.kind));

  const ensure = (id: unknown, kind: string, fallbackColors: Partial<LevelAsset>): string => {
    const wanted = typeof id === "string" ? slug(id) : "";
    if (wanted && assets.some((a) => a.id === wanted)) return wanted;
    const presetKind = preset.kinds.find((k) => k.kind === kind);
    const asset = assetFrom({ ...fallbackColors, ...presetKind, id: kind }, kind);
    add(asset);
    return asset.id;
  };
  const o = raw?.objective ?? {};
  const e = raw?.enemies ?? {};
  const pickupAssetId = ensure(o.pickupAssetId, preset.objective.pickupAssetId, { emissive: true });
  const goalAssetId = ensure(o.goalAssetId, "portal", { emissive: true });
  const enemyKind = ENEMY_KINDS.includes(e.kind) ? e.kind : preset.enemies.assetId;
  const enemyAssetId = ensure(e.assetId, enemyKind, { emissive: true });

  const known = new Set(assets.map((a) => a.id));
  const rules = (Array.isArray(raw?.scatter) && raw.scatter.length ? raw.scatter : preset.scatter)
    .slice(0, 12)
    .map((s: any) => ({
      assetId: slug(text(s?.assetId, "")),
      count: num(s?.count, 40, 0, 400) | 0,
      minHeight: num(s?.minHeight, 0, 0, 1),
      maxHeight: num(s?.maxHeight, 0.8, 0, 1),
      maxSlope: num(s?.maxSlope, 32, 5, 60),
      minScale: num(s?.minScale, 0.75, 0.1, 6),
      maxScale: num(s?.maxScale, 1.35, 0.1, 8),
      clustered: s?.clustered === true
    }))
    .filter((s: { assetId: string }) => known.has(s.assetId));
  const landmarks = (Array.isArray(raw?.landmarks) && raw.landmarks.length ? raw.landmarks : preset.landmarks)
    .slice(0, 10)
    .map((l: any) => ({ assetId: slug(text(l?.assetId, "")), x: num(l?.x, 0.5, 0.1, 0.9), z: num(l?.z, 0.5, 0.1, 0.9), scale: num(l?.scale, 1, 0.3, 6), yaw: num(l?.yaw, 0, -360, 360) }))
    .filter((l: { assetId: string }) => known.has(l.assetId));

  const t = raw?.terrain ?? {};
  const pal = raw?.palette ?? {};
  return {
    name: slug(text(raw?.name, title)),
    title,
    story: text(raw?.story, `Explore the ${biome}, gather every one of the ${o.pickupLabel ?? preset.objective.pickupLabel}, and escape through ${o.goalLabel ?? preset.objective.goalLabel}.`, 600),
    biome,
    timeOfDay: times.includes(raw?.timeOfDay) ? raw.timeOfDay : preset.timeOfDay,
    fogDensity: num(raw?.fogDensity, preset.fogDensity, 0, 0.04),
    palette: {
      ground: hex(pal.ground, preset.palette.ground), grass: hex(pal.grass, preset.palette.grass), rock: hex(pal.rock, preset.palette.rock),
      sand: hex(pal.sand, preset.palette.sand), sky: hex(pal.sky, preset.palette.sky), fog: hex(pal.fog, preset.palette.fog), water: hex(pal.water, preset.palette.water)
    },
    terrain: {
      size: num(t.size, preset.terrain.size, 120, 400),
      height: num(t.height, preset.terrain.height, 15, 90),
      roughness: num(t.roughness, preset.terrain.roughness, 0, 1),
      mountains: num(t.mountains, preset.terrain.mountains, 0, 1),
      valley: num(t.valley, preset.terrain.valley, 0, 1),
      water: typeof t.water === "boolean" ? t.water : preset.terrain.water,
      waterLevel: num(t.waterLevel, preset.terrain.waterLevel, 0.02, 0.3),
      seed: num(t.seed, Math.floor(Math.random() * 100000), 1, 1e6) | 0
    },
    player: { speed: num(raw?.player?.speed, preset.player.speed, 3, 12), jumpHeight: num(raw?.player?.jumpHeight, preset.player.jumpHeight, 0.8, 3.5), color: hex(raw?.player?.color, preset.player.color) },
    objective: {
      pickupAssetId,
      goalAssetId,
      pickupLabel: text(o.pickupLabel, preset.objective.pickupLabel, 40),
      goalLabel: text(o.goalLabel, preset.objective.goalLabel, 40),
      count: num(o.count, preset.objective.count, 1, 20) | 0
    },
    enemies: { assetId: enemyAssetId, count: num(e.count, preset.enemies.count, 0, 12) | 0, speed: num(e.speed, preset.enemies.speed, 1, 8), radius: num(e.radius, preset.enemies.radius, 2, 16) },
    assets,
    scatter: rules,
    landmarks,
    plannedBy
  };
};

// ---------------------------------------------------------------- planning

const planPrompt = (prompt: string, biome: Biome, levelNumber: number): string => `You are a senior level designer and environment artist building a Unity level.
Design one complete, playable 3D exploration level for this request:
"${prompt.slice(0, 1500)}"
${levelNumber > 1 ? `This is level ${levelNumber} of the game: make it harder and different from earlier levels.` : ""}

The level is an open valley ringed by mountains. The player collects pickups, then reaches the exit while enemies patrol.
Everything is built from these asset kinds (each has a ready-made 3D recipe):
${Object.keys(RECIPES).join(", ")}
Enemy kinds: ${ENEMY_KINDS.join(", ")}. Biomes: ${BIOMES.join(", ")} (closest match: ${biome}).

You may also invent a custom asset by giving "parts": up to 24 primitives, each
{"shape":"box|sphere|rock|cylinder|cone|torus","pos":[x,y,z],"rot":[x,y,z],"scale":[x,y,z],"slot":0|1|2,"noise":0..1,"taper":0..3}
in metres, Y up, origin at the asset's base; slot 0 = primary colour, 1 = secondary, 2 = glowing.

Answer with JSON only, in exactly this shape (values are placeholders to replace, not suggestions):
{
  "name": "<short_snake_case_id>",
  "title": "<level title>",
  "story": "<2-3 sentence intro the player reads>",
  "biome": "<one biome>",
  "timeOfDay": "dawn|noon|sunset|night",
  "fogDensity": <0..0.03>,
  "palette": {"ground":"#rrggbb","grass":"#rrggbb","rock":"#rrggbb","sand":"#rrggbb","sky":"#rrggbb","fog":"#rrggbb","water":"#rrggbb"},
  "terrain": {"size":<150..300>,"height":<25..70>,"roughness":<0..1>,"mountains":<0..1>,"valley":<0..1>,"water":<true|false>,"waterLevel":<0.05..0.2>},
  "player": {"speed":<4..9>,"jumpHeight":<1..2.5>,"color":"#rrggbb"},
  "assets": [{"id":"<id>","kind":"<kind or custom>","name":"<name>","primary":"#rrggbb","secondary":"#rrggbb","glow":"#rrggbb","emissive":<bool>,"roughness":<0..1>,"metallic":<0..1>}],
  "objective": {"pickupAssetId":"<asset id>","goalAssetId":"<asset id>","pickupLabel":"<plural noun>","goalLabel":"<the exit's name>","count":<4..12>},
  "enemies": {"assetId":"<asset id>","kind":"<enemy kind>","count":<0..8>,"speed":<2..6>,"radius":<4..12>},
  "scatter": [{"assetId":"<asset id>","count":<10..200>,"minHeight":<0..1>,"maxHeight":<0..1>,"maxSlope":<10..50>,"minScale":<0.5..1.5>,"maxScale":<0.8..2.5>,"clustered":<bool>}],
  "landmarks": [{"assetId":"<asset id>","x":<0.1..0.9>,"z":<0.1..0.9>,"scale":<0.5..3>,"yaw":<0..360>}]
}
Use 6-12 assets, 3-6 scatter rules (vegetation and rocks by the hundred make it look rich), 2-5 landmarks, and colours that suit the mood.
JSON only:`;

export const planLevel = async (prompt: string, levelNumber = 1): Promise<LevelPlan> => {
  const biome = detectBiome(prompt);
  try {
    const response = await ModelRouter.generateForRole("3d", planPrompt(prompt, biome, levelNumber));
    const json = /\{[\s\S]*\}/.exec(response)?.[0];
    if (json) return sanitizePlan(JSON.parse(json), prompt, "model");
    Logger.warn("UnityLevelStudio: the 3D model's answer had no JSON; planning from the biome rules");
  } catch (error) {
    Logger.warn("UnityLevelStudio: level planning by model failed; planning from the biome rules", { error: (error as Error)?.message });
  }
  return sanitizePlan({}, prompt, "rules");
};

// ---------------------------------------------------------------- Unity & project

const KIT_DIR = () => path.resolve("unity", "AgentBuilderKit");
const BLENDER_SCRIPT = () => path.resolve("unity", "blender", "build_level_assets.py");
export const levelProjectPath = (): string => process.env.UNITY_LEVEL_PROJECT?.trim() || path.resolve("..", "AgentBuilderLevels");

export interface UnityEditorInfo {
  installed: boolean;
  exe: string | null;
  version: string | null;
  webgl: boolean;
  template: string | null;
}

const versionKey = (v: string) => v.split(/[.a-z]+/i).map((n) => n.padStart(5, "0")).join(".");

/** The Unity editor to drive: UNITY_EXE_PATH, else the newest Hub editor with WebGL support, else the newest. */
export const detectUnity = (): UnityEditorInfo => {
  const describe = (exe: string): UnityEditorInfo => {
    const editorDir = path.dirname(exe);
    const templates = path.join(editorDir, "Data", "Resources", "PackageManager", "ProjectTemplates");
    let template: string | null = null;
    try {
      // The URP "3D (cross-platform)" template: post-processing and SSAO set up.
      const tgz = fs.readdirSync(templates).filter((f) => /^com\.unity\.template\.3d-cross-platform.*\.tgz$/.test(f)).sort().pop();
      if (tgz) template = path.join(templates, tgz);
    } catch {}
    return {
      installed: true,
      exe,
      version: path.basename(path.dirname(editorDir)),
      webgl: fs.existsSync(path.join(editorDir, "Data", "PlaybackEngines", "WebGLSupport")),
      template
    };
  };
  const explicit = process.env.UNITY_EXE_PATH?.trim();
  if (explicit && fs.existsSync(explicit)) return describe(explicit);
  const hub = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Unity", "Hub", "Editor");
  try {
    const editors = fs.readdirSync(hub)
      .map((v) => path.join(hub, v, "Editor", "Unity.exe"))
      .filter((exe) => fs.existsSync(exe))
      .map(describe)
      .sort((a, b) => versionKey(b.version ?? "").localeCompare(versionKey(a.version ?? "")));
    const pick = editors.find((e) => e.webgl && e.template) ?? editors.find((e) => e.template) ?? editors[0];
    if (pick) return pick;
  } catch {}
  return { installed: false, exe: null, version: null, webgl: false, template: null };
};

/** Unity holds Temp/UnityLockfile open while the project is open in the Editor. */
const projectOpenInEditor = (project: string): boolean => {
  const lock = path.join(project, "Temp", "UnityLockfile");
  if (!fs.existsSync(lock)) return false;
  try {
    // An editor holding the lock makes this fail; a stale lock from a crash does not.
    const fd = fs.openSync(lock, "r+");
    fs.closeSync(fd);
    return false;
  } catch {
    return true;
  }
};

const copyDir = (from: string, to: string) => {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
};

interface RunResult { code: number | null; output: string; timedOut: boolean }

const runProcess = (exe: string, args: string[], timeoutMs: number, onLine?: (line: string) => void): Promise<RunResult> =>
  new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true });
    let output = "";
    let pending = "";
    const take = (chunk: Buffer) => {
      const s = chunk.toString();
      output = (output + s).slice(-200_000);
      pending += s;
      let nl = pending.indexOf("\n");
      while (nl >= 0) {
        onLine?.(pending.slice(0, nl).trimEnd());
        pending = pending.slice(nl + 1);
        nl = pending.indexOf("\n");
      }
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, output: output + `\n${error.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output, timedOut });
    });
  });

/** Follows a Unity log file while the editor writes it (batch mode prints little to stdout). */
const tailFile = (file: string, onLine: (line: string) => void): (() => void) => {
  let offset = 0;
  let pending = "";
  const timer = setInterval(() => {
    try {
      const size = fs.statSync(file).size;
      if (size < offset) offset = 0;
      if (size === offset) return;
      const fd = fs.openSync(file, "r");
      const buf = Buffer.alloc(size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      fs.closeSync(fd);
      offset = size;
      pending += buf.toString("utf8");
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      lines.forEach(onLine);
    } catch {}
  }, 1000);
  return () => clearInterval(timer);
};

// ---------------------------------------------------------------- jobs

export type UnityTarget = "none" | "windows" | "webgl";

export interface UnityLevelJob {
  id: string;
  prompt: string;
  target: UnityTarget;
  status: "planning" | "creating-project" | "blender" | "unity" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  plan?: LevelPlan;
  project: string;
  scene?: string;
  previews: string[];
  player?: string;
  blender: "built" | "skipped" | "failed";
  steps: string[];
  error?: string;
}

const JOBS_FILE = () => path.resolve("data", "unity-levels", "jobs.json");
const jobs = new Map<string, UnityLevelJob>();
let loaded = false;

const loadJobs = () => {
  if (loaded) return;
  loaded = true;
  try {
    for (const job of JSON.parse(fs.readFileSync(JOBS_FILE(), "utf8")) as UnityLevelJob[]) {
      // A job still "running" in the file was cut off by a restart.
      if (!["done", "failed"].includes(job.status)) Object.assign(job, { status: "failed", error: "Agent Builder restarted while this level was building." });
      jobs.set(job.id, job);
    }
  } catch {}
};

const saveJobs = () => {
  try {
    fs.mkdirSync(path.dirname(JOBS_FILE()), { recursive: true });
    const recent = [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 50);
    fs.writeFileSync(JOBS_FILE(), JSON.stringify(recent, null, 2), "utf8");
  } catch (error) {
    Logger.warn("UnityLevelStudio: could not save jobs", { error: (error as Error)?.message });
  }
};

/** One Unity at a time: two batch-mode editors cannot open the same project. */
let queue: Promise<unknown> = Promise.resolve();

export const UnityLevelStudio = {
  detectUnity,
  planLevel,
  sanitizePlan,
  levelProjectPath,
  recipes: () => Object.keys(RECIPES),

  status() {
    const unity = detectUnity();
    const blender = BlenderStudio.detectBlender();
    const project = levelProjectPath();
    return {
      unity,
      blender,
      project,
      projectExists: fs.existsSync(path.join(project, "ProjectSettings")),
      projectOpenInEditor: projectOpenInEditor(project),
      kitPresent: fs.existsSync(KIT_DIR())
    };
  },

  listJobs(): UnityLevelJob[] {
    loadJobs();
    return [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  },

  getJob(id: string): UnityLevelJob | undefined {
    loadJobs();
    return jobs.get(id);
  },

  /** Starts a level build in the background and returns its job at once. */
  start(prompt: string, options: { target?: UnityTarget; plan?: unknown; onDone?: (job: UnityLevelJob) => void } = {}): UnityLevelJob {
    loadJobs();
    const job: UnityLevelJob = {
      id: `lvl_${Date.now().toString(36)}`,
      prompt,
      target: options.target ?? "none",
      status: "planning",
      startedAt: new Date().toISOString(),
      project: levelProjectPath(),
      previews: [],
      blender: "skipped",
      steps: []
    };
    jobs.set(job.id, job);
    saveJobs();
    queue = queue.then(() => UnityLevelStudio.run(job, options.plan)).finally(() => options.onDone?.(job));
    return job;
  },

  async run(job: UnityLevelJob, givenPlan?: unknown): Promise<void> {
    const step = (message: string) => {
      job.steps.push(`${new Date().toISOString().slice(11, 19)} ${message}`);
      if (job.steps.length > 200) job.steps.splice(0, job.steps.length - 200);
      Logger.log(`[unity-level ${job.id}] ${message}`);
      saveJobs();
    };
    const fail = (message: string) => {
      job.status = "failed";
      job.error = message;
      job.finishedAt = new Date().toISOString();
      step(`Failed: ${message}`);
    };

    try {
      const unity = detectUnity();
      if (!unity.installed || !unity.exe) return fail("No Unity editor found. Install one with Unity Hub, or set UNITY_EXE_PATH.");
      if (job.target === "webgl" && !unity.webgl) return fail(`Unity ${unity.version} has no WebGL module; add it in Unity Hub or build for windows.`);
      const project = job.project;
      if (projectOpenInEditor(project)) return fail(`${project} is open in the Unity Editor. Close it (or use Agent Builder > Rebuild Level From Plan inside the Editor).`);

      // 1. Plan
      step("Designing the level…");
      const existingLevels = fs.existsSync(path.join(project, "Assets", "Scenes"))
        ? fs.readdirSync(path.join(project, "Assets", "Scenes")).filter((f) => /^AB_.*\.unity$/.test(f)).length
        : 0;
      const plan = givenPlan
        ? sanitizePlan(givenPlan, job.prompt, (givenPlan as { plannedBy?: string }).plannedBy === "rules" ? "rules" : "model")
        : await planLevel(job.prompt, existingLevels + 1);
      job.plan = plan;
      step(`Planned "${plan.title}" (${plan.biome}, ${plan.timeOfDay}) by ${plan.plannedBy === "model" ? "the 3D model" : givenPlan ? "the biome rules" : "the biome rules (the model did not answer usably)"}: ${plan.assets.length} assets, ${plan.scatter.reduce((n, s) => n + s.count, 0)} props, ${plan.objective.count} ${plan.objective.pickupLabel}.`);

      // 2. Project
      if (!fs.existsSync(path.join(project, "ProjectSettings"))) {
        job.status = "creating-project";
        step(`Creating Unity project ${project} from ${unity.template ? path.basename(unity.template) : "the default template"} (first time only, several minutes)…`);
        fs.mkdirSync(path.dirname(project), { recursive: true });
        const createLog = path.join(path.dirname(project), `${path.basename(project)}-create.log`);
        const args = ["-batchmode", "-quit", "-createProject", project, "-logFile", createLog];
        if (unity.template) args.push("-cloneFromTemplate", unity.template);
        const created = await runProcess(unity.exe, args, 30 * 60_000);
        if (!fs.existsSync(path.join(project, "ProjectSettings"))) {
          return fail(`Unity could not create the project (exit ${created.code}${created.timedOut ? ", timed out" : ""}). See ${createLog}.`);
        }
      }
      const kitTarget = path.join(project, "Assets", "AgentBuilder", "Kit");
      copyDir(KIT_DIR(), kitTarget);
      const levelDir = path.join(project, "Assets", "AgentBuilder", "Levels", plan.name);
      fs.mkdirSync(levelDir, { recursive: true });
      const planFile = path.join(levelDir, "level.json");
      fs.writeFileSync(planFile, JSON.stringify(plan, null, 2), "utf8");
      const outDir = path.join(project, "Builds", plan.name);
      fs.mkdirSync(outDir, { recursive: true });

      // 3. Blender
      const blender = BlenderStudio.detectBlender();
      if (blender.installed && blender.path) {
        job.status = "blender";
        step(`Modelling ${plan.assets.length} assets in Blender…`);
        const sheet = path.join(outDir, "blender-assets.png");
        const result = await runProcess(
          blender.path,
          ["-b", "--factory-startup", "-P", BLENDER_SCRIPT(), "--", planFile, path.join(levelDir, "Models"), sheet],
          15 * 60_000,
          (line) => { if (line.startsWith("[blender]")) step(line.replace("[blender] ", "Blender: ")); }
        );
        job.blender = result.code === 0 && /\[blender\] DONE/.test(result.output) ? "built" : "failed";
        if (job.blender === "failed") step(`Blender did not finish (exit ${result.code}); Unity will build the assets itself. ${result.output.slice(-400)}`);
        if (fs.existsSync(sheet)) job.previews.push(sheet);
      } else {
        step("Blender is not installed: Unity builds the assets from the same parts (set BLENDER_PATH or install Blender for bevelled, sculpted models).");
      }

      // 4. Unity
      job.status = "unity";
      step(`Building the scene in Unity ${unity.version}${job.target !== "none" ? ` and a ${job.target} player` : ""}…`);
      const log = path.join(outDir, "unity-build.log");
      try { fs.rmSync(log, { force: true }); } catch {}
      const compileErrors: string[] = [];
      const stopTail = tailFile(log, (line) => {
        if (line.includes("[AgentLevelBuilder]")) {
          const msg = line.slice(line.indexOf("[AgentLevelBuilder]") + 20).trim();
          if (msg.startsWith("PREVIEW ")) job.previews.push(msg.slice(8).trim());
          else if (msg.startsWith("PLAYER ")) job.player = msg.slice(7).trim();
          else if (msg.startsWith("DONE ")) job.scene = msg.slice(5).trim();
          step(`Unity: ${msg}`);
        } else if (/error CS\d+/.test(line) && compileErrors.length < 10) {
          compileErrors.push(line.trim());
        }
      });
      // No -nographics: the builder renders preview images, which needs the GPU.
      const result = await runProcess(
        unity.exe,
        [
          "-batchmode", "-quit", "-projectPath", project,
          "-executeMethod", "AgentBuilder.Levels.EditorTools.AgentLevelBuilder.BuildFromCommandLine",
          "-abPlan", planFile, "-abTarget", job.target,
          "-logFile", log
        ],
        60 * 60_000
      );
      await new Promise((r) => setTimeout(r, 1200));
      stopTail();

      if (result.code !== 0 || !job.scene) {
        const logText = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : result.output;
        const failure = /\[AgentLevelBuilder\] FAILED: ([^\n]+)/.exec(logText)?.[1];
        const errors = compileErrors.length ? compileErrors : (logText.match(/^.*error CS\d+.*$/gm) ?? []).slice(0, 10);
        return fail(
          errors.length
            ? `The level kit did not compile in Unity:\n${errors.join("\n")}`
            : failure
              ? `Unity: ${failure}`
              : `Unity exited ${result.code}${result.timedOut ? " (timed out)" : ""}. See ${log}.`
        );
      }

      job.status = "done";
      job.finishedAt = new Date().toISOString();
      step(`Level ready: ${job.scene}. Open ${project} in Unity ${unity.version} and press Play${job.player ? `, or run ${job.player}` : ""}.`);
    } catch (error) {
      fail((error as Error)?.message ?? String(error));
    }
  }
};
