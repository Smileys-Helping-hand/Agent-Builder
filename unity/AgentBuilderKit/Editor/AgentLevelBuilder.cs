// Agent Builder level kit: turns a level plan (level.json, written by Agent
// Builder) into a playable Unity scene — sculpted terrain with painted layers,
// water, sky, sun, fog and post-processing, the plan's assets (Blender FBX
// models when Agent Builder had Blender build them, otherwise meshes from
// AbMeshKit), scattered props, collectibles, patrolling enemies, the exit, the
// player and the HUD. Then it saves the scene, adds it to Build Settings,
// renders preview images, and can build a Windows or WebGL player.
//
// Batch mode (what Agent Builder runs):
//   Unity.exe -batchmode -quit -projectPath <proj> -executeMethod AgentBuilder.Levels.EditorTools.AgentLevelBuilder.BuildFromCommandLine
//             -abPlan <abs path to level.json> [-abTarget none|windows|webgl]
// In the editor: menu Agent Builder > Rebuild Level From Plan...
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;
using Random = System.Random;

namespace AgentBuilder.Levels.EditorTools
{
    public static class AgentLevelBuilder
    {
        const string LevelsRoot = "Assets/AgentBuilder/Levels";
        const string Tag = "[AgentLevelBuilder]";

        [MenuItem("Agent Builder/Rebuild Level From Plan...")]
        static void Menu()
        {
            var path = EditorUtility.OpenFilePanel("Level plan", LevelsRoot, "json");
            if (!string.IsNullOrEmpty(path)) Build(path, "none");
        }

        public static void BuildFromCommandLine()
        {
            try
            {
                var plan = Arg("-abPlan");
                if (string.IsNullOrEmpty(plan)) throw new ArgumentException("Pass -abPlan <path to level.json>.");
                Build(plan, Arg("-abTarget") ?? "none");
                EditorApplication.Exit(0);
            }
            catch (Exception e)
            {
                Debug.LogError($"{Tag} FAILED: {e}");
                EditorApplication.Exit(1);
            }
        }

        static string Arg(string name)
        {
            var args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++) if (args[i] == name) return args[i + 1];
            return null;
        }

        static bool Urp => GraphicsSettings.currentRenderPipeline is UniversalRenderPipelineAsset;

        // ------------------------------------------------------------------ build

        public static void Build(string planPath, string target)
        {
            var plan = JsonUtility.FromJson<AbLevelPlan>(File.ReadAllText(planPath));
            if (plan == null || string.IsNullOrEmpty(plan.name)) throw new Exception("The level plan has no name.");
            var safe = Safe(plan.name);
            var folder = $"{LevelsRoot}/{safe}";
            var gen = $"{folder}/Generated";
            foreach (var sub in new[] { "Materials", "Meshes", "Textures", "Prefabs", "Terrain" }) Ensure($"{gen}/{sub}");
            Log($"Building level '{plan.title}' ({plan.biome}, {plan.timeOfDay}) — URP: {Urp}");

            var rng = new Random(plan.terrain.seed);
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var grain = GrainTextures(gen);
            var terrain = BuildTerrain(plan, gen, rng);
            float S = plan.terrain.size, H = plan.terrain.height;
            float waterY = plan.terrain.water ? plan.terrain.waterLevel * H : -1000f;
            if (plan.terrain.water) BuildWater(plan, gen, S, waterY);

            var sun = BuildLighting(plan, gen);
            var prefabs = BuildAssets(plan, gen, folder, grain);

            // Where things go: the player starts near the middle, the exit is
            // far from it, and nothing is placed on cliffs or under water.
            var placer = new Placer(terrain, waterY, rng);
            var spawn = placer.Near(new Vector3(S * 0.5f, 0f, S * 0.5f), 0f, 8f, 18f) ?? new Vector3(S * 0.5f, 0f, S * 0.5f);
            placer.Reserve(spawn, 10f);
            var goalPos = placer.Far(spawn, S * 0.32f, 22f) ?? spawn + new Vector3(S * 0.3f, 0f, 0f);
            placer.Reserve(goalPos, 10f);

            var env = new GameObject("Environment").transform;
            var director = new GameObject("Level Director").AddComponent<AbLevelDirector>();
            director.levelTitle = plan.title;
            director.story = plan.story;
            director.pickupLabel = plan.objective.pickupLabel;
            director.goalLabel = plan.objective.goalLabel;
            director.killHeight = plan.terrain.water ? waterY - 1.2f : -40f;

            director.goal = PlaceGoal(plan, prefabs, goalPos);
            int placedPickups = PlacePickups(plan, prefabs, placer, spawn, goalPos);
            director.required = placedPickups;
            PlaceLandmarks(plan, prefabs, terrain, env);
            int scattered = Scatter(plan, prefabs, placer, env);
            PlaceEnemies(plan, prefabs, placer, spawn);
            var player = BuildPlayer(plan, gen, grain, spawn);

            DynamicGI.UpdateEnvironment();
            var scenePath = $"Assets/Scenes/AB_{safe}.unity";
            Ensure("Assets/Scenes");
            EditorSceneManager.SaveScene(scene, scenePath);
            AddToBuildSettings(scenePath);
            Log($"Saved {scenePath}: {placedPickups} {plan.objective.pickupLabel}, {scattered} scattered props, {plan.assets.Length} asset types");

            var outDir = Path.GetFullPath(Path.Combine("Builds", safe));
            Directory.CreateDirectory(outDir);
            RenderPreview(player.GetComponent<AbPlayer>(), spawn, goalPos, S, H, Path.Combine(outDir, "preview-player.png"), false);
            RenderPreview(null, spawn, goalPos, S, H, Path.Combine(outDir, "preview-overview.png"), true);

            if (target == "windows" || target == "webgl") BuildPlayer(target, safe, outDir);
            Log($"DONE {scenePath}");
        }

        // ------------------------------------------------------------------ terrain

        static float Fbm(float x, float y, int octaves, float rough, float ox, float oy)
        {
            float sum = 0f, amp = 1f, freq = 1f, norm = 0f;
            for (int i = 0; i < octaves; i++)
            {
                sum += Mathf.PerlinNoise(x * freq + ox, y * freq + oy) * amp;
                norm += amp;
                amp *= Mathf.Lerp(0.35f, 0.62f, rough);
                freq *= 2.03f;
            }
            return sum / norm;
        }

        static Terrain BuildTerrain(AbLevelPlan plan, string gen, Random rng)
        {
            const int res = 513;
            var t = plan.terrain;
            // The asset is created first: splat maps set on a TerrainData that is
            // only saved afterwards are not stored with it, and the terrain loads all grass.
            var data = new TerrainData();
            AssetDatabase.CreateAsset(data, $"{gen}/Terrain/TerrainData.asset");
            data.heightmapResolution = res;
            data.alphamapResolution = 512;
            data.baseMapResolution = 1024;
            data.size = new Vector3(t.size, t.height, t.size);
            float ox = (float)rng.NextDouble() * 1000f, oy = (float)rng.NextDouble() * 1000f;
            float water = t.water ? t.waterLevel : 0f;

            var h = new float[res, res];
            for (int z = 0; z < res; z++)
                for (int x = 0; x < res; x++)
                {
                    float u = x / (res - 1f), v = z / (res - 1f);
                    // 0 centre .. ~1.4 corners, wobbled so the valley edge is not a circle.
                    float d = Vector2.Distance(new Vector2(u, v), new Vector2(0.5f, 0.5f)) * 2f + (Fbm(u * 2.2f, v * 2.2f, 3, 0.5f, ox + 90f, oy + 90f) - 0.5f) * 0.45f;
                    // Rolling ground, sharpened into ridges by the roughness.
                    float baseN = Fbm(u * 4f, v * 4f, 6, t.roughness, ox, oy);
                    float ridge = 1f - Mathf.Abs(Fbm(u * 3f, v * 3f, 5, t.roughness, ox + 50f, oy + 50f) * 2f - 1f);
                    float ground = Mathf.Lerp(baseN, ridge * ridge, 0.35f) * 0.32f + water + 0.04f;
                    // A rim of mountains closes the level in, so the player
                    // cannot walk off the edge of the world.
                    // Peaks and saddles along it (ridge noise), rising over a wide band
                    // so it reads as mountains, not a crater wall.
                    float peaks = Fbm(u * 5f, v * 5f, 5, 0.55f, ox + 200f, oy + 200f);
                    float rim = Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(0.55f, 1.2f, d)) * (0.35f + t.mountains * 0.6f) * (0.35f + ridge * 0.55f + peaks * 0.6f);
                    // A winding valley (with water, a river or lake) through the play area.
                    float wind = Mathf.Sin(u * 6.2f + Fbm(u * 2f, v * 2f, 3, 0.5f, ox, oy) * 4f) * 0.08f;
                    float valley = Mathf.Exp(-Mathf.Pow((v - 0.5f - wind) * 7f, 2f)) * t.valley * 0.22f;
                    // The spawn plateau stays walkable.
                    float flat = Mathf.SmoothStep(1f, 0f, Mathf.InverseLerp(0.0f, 0.18f, d));
                    float height = Mathf.Max(ground + rim - valley * (1f - flat), 0f);
                    height = Mathf.Lerp(height, water + 0.08f, flat * 0.6f);
                    h[z, x] = Mathf.Clamp01(height);
                }
            data.SetHeights(0, 0, h);

            // Four painted layers: grass, earth, rock on steep ground, sand at the water line.
            var layers = new[]
            {
                Layer(gen, "grass", plan.palette.grass, 0.09f, 6f),
                Layer(gen, "ground", plan.palette.ground, 0.14f, 8f),
                Layer(gen, "rock", plan.palette.rock, 0.2f, 10f),
                Layer(gen, "sand", plan.palette.sand, 0.07f, 6f)
            };
            data.terrainLayers = layers;
            int ar = data.alphamapResolution;
            var maps = new float[ar, ar, 4];
            for (int z = 0; z < ar; z++)
                for (int x = 0; x < ar; x++)
                {
                    float u = x / (ar - 1f), v = z / (ar - 1f);
                    float height01 = data.GetInterpolatedHeight(u, v) / t.height;
                    float steep = data.GetSteepness(u, v);
                    float n = Fbm(u * 18f, v * 18f, 3, 0.5f, ox + 9f, oy + 9f);
                    float rock = Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(24f, 38f, steep + n * 8f));
                    float sand = t.water ? Mathf.SmoothStep(1f, 0f, Mathf.InverseLerp(water + 0.01f, water + 0.035f, height01)) : 0f;
                    float high = Mathf.InverseLerp(0.45f, 0.8f, height01);
                    float earth = Mathf.Clamp01(n * 1.3f - 0.45f + high * 0.6f);
                    float grass = Mathf.Max(0f, 1f - rock - sand) * (1f - earth);
                    float ground = Mathf.Max(0f, 1f - rock - sand) * earth;
                    float sum = grass + ground + rock + sand + 1e-5f;
                    maps[z, x, 0] = grass / sum;
                    maps[z, x, 1] = ground / sum;
                    maps[z, x, 2] = rock / sum;
                    maps[z, x, 3] = sand / sum;
                }
            data.SetAlphamaps(0, 0, maps);
            EditorUtility.SetDirty(data);
            AssetDatabase.SaveAssets();
            var go = Terrain.CreateTerrainGameObject(data);
            go.name = "Terrain";
            var terrain = go.GetComponent<Terrain>();
            var shader = Urp ? Shader.Find("Universal Render Pipeline/Terrain/Lit") : Shader.Find("Nature/Terrain/Standard");
            if (shader != null)
            {
                var mat = new Material(shader);
                AssetDatabase.CreateAsset(mat, $"{gen}/Materials/Terrain.mat");
                terrain.materialTemplate = mat;
            }
            terrain.heightmapPixelError = 3f;
            terrain.basemapDistance = 400f;
            terrain.drawInstanced = true;
            return terrain;
        }

        static TerrainLayer Layer(string gen, string name, string hex, float variation, float tile)
        {
            var color = Hex(hex, Color.gray);
            var albedo = NoiseTexture($"{gen}/Textures/terrain_{name}.png", 512, (u, v) =>
            {
                float n = Fbm(u * 8f, v * 8f, 5, 0.55f, name.Length * 13f, 3f);
                float speck = Mathf.PerlinNoise(u * 90f + name.Length, v * 90f) > 0.72f ? 0.06f : 0f;
                float k = 1f + (n - 0.5f) * variation * 4f - speck;
                return new Color(color.r * k, color.g * k, color.b * k, 1f);
            }, false);
            var normal = NormalTexture($"{gen}/Textures/terrain_{name}_n.png", 512, (u, v) => Fbm(u * 10f, v * 10f, 5, 0.6f, name.Length * 7f, 1f), 3f);
            var layer = new TerrainLayer { diffuseTexture = albedo, normalMapTexture = normal, tileSize = new Vector2(tile, tile), smoothness = name == "sand" ? 0.15f : 0.05f };
            AssetDatabase.CreateAsset(layer, $"{gen}/Terrain/{name}.terrainlayer");
            return layer;
        }

        static void BuildWater(AbLevelPlan plan, string gen, float S, float y)
        {
            var water = GameObject.CreatePrimitive(PrimitiveType.Plane);
            water.name = "Water";
            UnityEngine.Object.DestroyImmediate(water.GetComponent<Collider>()); // the player falls in and respawns
            water.transform.position = new Vector3(S * 0.5f, y, S * 0.5f);
            water.transform.localScale = new Vector3(S / 10f, 1f, S / 10f);
            var mat = Lit($"{gen}/Materials/Water.mat", Hex(plan.palette.water, new Color(0.15f, 0.4f, 0.55f)), 0.94f, 0f, null, null);
            water.GetComponent<MeshRenderer>().sharedMaterial = mat;
        }

        // ------------------------------------------------------------------ light, sky, post

        static Light BuildLighting(AbLevelPlan plan, string gen)
        {
            Vector2 angles; Color sunColor; float intensity; Color skyTint; float exposure;
            switch (plan.timeOfDay)
            {
                case "dawn": angles = new Vector2(14f, -40f); sunColor = new Color(1f, 0.8f, 0.64f); intensity = 1.5f; skyTint = new Color(0.5f, 0.5f, 0.5f); exposure = 1.3f; break;
                case "sunset": angles = new Vector2(9f, 205f); sunColor = new Color(1f, 0.62f, 0.38f); intensity = 1.5f; skyTint = new Color(0.52f, 0.5f, 0.48f); exposure = 1.2f; break;
                case "night": angles = new Vector2(38f, 140f); sunColor = new Color(0.55f, 0.65f, 1f); intensity = 0.35f; skyTint = new Color(0.15f, 0.2f, 0.4f); exposure = 0.25f; break;
                default: angles = new Vector2(50f, 35f); sunColor = new Color(1f, 0.96f, 0.88f); intensity = 1.9f; skyTint = Color.Lerp(new Color(0.5f, 0.5f, 0.5f), Hex(plan.palette.sky, new Color(0.5f, 0.7f, 1f)), 0.3f); exposure = 1.25f; break;
            }

            var sunGo = new GameObject("Sun");
            var sun = sunGo.AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.color = sunColor;
            sun.intensity = intensity;
            sun.shadows = LightShadows.Soft;
            sun.shadowStrength = 0.9f;
            sunGo.transform.rotation = Quaternion.Euler(angles.x, angles.y, 0f);

            // _SkyTint shifts the scattering wavelengths rather than colouring the
            // sky: a blue tint gives a yellow-green sky. Keep it near grey (0.5)
            // and let the sun's height give dawn and sunset their colour.
            var sky = new Material(Shader.Find("Skybox/Procedural"));
            sky.SetColor("_SkyTint", skyTint);
            sky.SetColor("_GroundColor", Hex(plan.palette.fog, Color.gray) * 0.6f);
            sky.SetFloat("_AtmosphereThickness", plan.timeOfDay == "sunset" || plan.timeOfDay == "dawn" ? 1.25f : 1.0f);
            sky.SetFloat("_Exposure", exposure);
            sky.SetFloat("_SunSize", 0.045f);
            AssetDatabase.CreateAsset(sky, $"{gen}/Materials/Sky.mat");
            RenderSettings.skybox = sky;
            RenderSettings.sun = sun;

            // Explicit gradient ambient: a skybox-derived ambient needs a
            // lighting bake, and without one the player build renders flat black shadows.
            var fog = Hex(plan.palette.fog, Color.gray);
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = Color.Lerp(skyTint, Color.white, 0.25f) * (plan.timeOfDay == "night" ? 0.35f : 0.9f);
            RenderSettings.ambientEquatorColor = Color.Lerp(fog, sunColor, 0.3f) * (plan.timeOfDay == "night" ? 0.25f : 0.7f);
            RenderSettings.ambientGroundColor = Hex(plan.palette.ground, Color.gray) * 0.35f;
            // The ambient probe is what lit materials actually sample. In batch mode
            // nothing recomputes it from the colours above, and a black probe
            // leaves every shaded side showing only its sky reflection (brown,
            // glossy foliage) — so it is written out directly.
            var probeSH = new SphericalHarmonicsL2();
            probeSH.AddAmbientLight(RenderSettings.ambientEquatorColor);
            probeSH.AddDirectionalLight(Vector3.up, (RenderSettings.ambientSkyColor - RenderSettings.ambientEquatorColor) * 0.9f, 1f);
            probeSH.AddDirectionalLight(Vector3.down, (RenderSettings.ambientGroundColor - RenderSettings.ambientEquatorColor) * 0.5f, 1f);
            RenderSettings.ambientProbe = probeSH;
            RenderSettings.fog = plan.fogDensity > 0f;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogColor = plan.timeOfDay == "night" ? fog * 0.25f : fog;
            RenderSettings.fogDensity = Mathf.Clamp(plan.fogDensity, 0f, 0.05f);

            // One realtime reflection probe so metal and water reflect the sky.
            var probeGo = new GameObject("Sky Reflections");
            var probe = probeGo.AddComponent<ReflectionProbe>();
            probe.mode = ReflectionProbeMode.Realtime;
            probe.refreshMode = ReflectionProbeRefreshMode.OnAwake;
            probe.size = new Vector3(plan.terrain.size, plan.terrain.height * 2f, plan.terrain.size);
            probeGo.transform.position = new Vector3(plan.terrain.size * 0.5f, plan.terrain.height * 0.5f, plan.terrain.size * 0.5f);

            if (Urp) BuildPostProcessing(plan, gen);
            return sun;
        }

        static void BuildPostProcessing(AbLevelPlan plan, string gen)
        {
            var profile = ScriptableObject.CreateInstance<VolumeProfile>();
            AssetDatabase.CreateAsset(profile, $"{gen}/PostProcessing.asset");
            var tone = profile.Add<Tonemapping>(true);
            tone.mode.Override(TonemappingMode.ACES);
            var bloom = profile.Add<Bloom>(true);
            bloom.threshold.Override(1.0f);
            bloom.intensity.Override(plan.timeOfDay == "night" ? 1.4f : 0.7f);
            bloom.scatter.Override(0.7f);
            var grade = profile.Add<ColorAdjustments>(true);
            grade.postExposure.Override(plan.timeOfDay == "night" ? 0.6f : 0.15f);
            grade.contrast.Override(12f);
            grade.saturation.Override(10f);
            var vignette = profile.Add<Vignette>(true);
            vignette.intensity.Override(0.24f);
            vignette.smoothness.Override(0.45f);
            var white = profile.Add<WhiteBalance>(true);
            white.temperature.Override(plan.timeOfDay == "sunset" ? 10f : plan.timeOfDay == "dawn" ? 4f : plan.timeOfDay == "night" ? -15f : 3f);
            foreach (var component in profile.components) AssetDatabase.AddObjectToAsset(component, profile);
            EditorUtility.SetDirty(profile);

            var volumeGo = new GameObject("Post Processing");
            var volume = volumeGo.AddComponent<Volume>();
            volume.isGlobal = true;
            volume.sharedProfile = profile;
        }

        // ------------------------------------------------------------------ assets

        class Grain { public Texture2D albedo; public Texture2D normal; }

        static Grain GrainTextures(string gen)
        {
            // A light, near-white grain multiplied over every prop's colour, and
            // a soft bump: flat vertex colours are what make procedural props look cheap.
            return new Grain
            {
                albedo = NoiseTexture($"{gen}/Textures/grain.png", 256, (u, v) =>
                {
                    float n = Fbm(u * 6f, v * 6f, 5, 0.55f, 11f, 7f);
                    float k = 0.84f + n * 0.2f;
                    return new Color(k, k, k, 1f);
                }, false),
                normal = NormalTexture($"{gen}/Textures/grain_n.png", 256, (u, v) => Fbm(u * 8f, v * 8f, 5, 0.6f, 3f, 5f), 2f)
            };
        }

        static Dictionary<string, GameObject> BuildAssets(AbLevelPlan plan, string gen, string folder, Grain grain)
        {
            var prefabs = new Dictionary<string, GameObject>();
            int index = 0;
            foreach (var asset in plan.assets)
            {
                index++;
                if (string.IsNullOrEmpty(asset.id)) continue;
                var id = Safe(asset.id);
                var mats = new[]
                {
                    Lit($"{gen}/Materials/{id}_primary.mat", Hex(asset.primary, Color.gray), Gloss(asset, 1f), Mathf.Clamp01(asset.metallic), grain.albedo, grain.normal),
                    Lit($"{gen}/Materials/{id}_secondary.mat", Hex(asset.secondary, Color.gray), Gloss(asset, 0.8f), Mathf.Clamp01(asset.metallic * 0.5f), grain.albedo, grain.normal),
                    Glow($"{gen}/Materials/{id}_glow.mat", Hex(asset.glow, Color.cyan), asset.emissive ? 3.2f : 0.6f)
                };

                GameObject root;
                var fbx = AssetDatabase.LoadAssetAtPath<GameObject>($"{folder}/Models/{id}.fbx");
                if (fbx != null)
                {
                    root = (GameObject)PrefabUtility.InstantiatePrefab(fbx);
                    PrefabUtility.UnpackPrefabInstance(root, PrefabUnpackMode.Completely, InteractionMode.AutomatedAction);
                    // Blender names its material slots primary / secondary / glow.
                    foreach (var r in root.GetComponentsInChildren<Renderer>())
                    {
                        r.sharedMaterials = r.sharedMaterials.Select(m =>
                        {
                            var n = m == null ? "" : m.name.ToLowerInvariant();
                            return n.Contains("glow") ? mats[2] : n.Contains("secondary") ? mats[1] : mats[0];
                        }).ToArray();
                    }
                    if (asset.collider)
                        foreach (var mf in root.GetComponentsInChildren<MeshFilter>())
                            mf.gameObject.AddComponent<MeshCollider>().sharedMesh = mf.sharedMesh;
                    Log($"  {asset.id}: Blender model");
                }
                else
                {
                    var mesh = AbMeshKit.Build(asset, plan.terrain.seed + index * 101, out var used);
                    AssetDatabase.CreateAsset(mesh, $"{gen}/Meshes/{id}.asset");
                    root = new GameObject(id);
                    root.AddComponent<MeshFilter>().sharedMesh = mesh;
                    var list = new List<Material>();
                    for (int s = 0; s < 3; s++) if (used[s]) list.Add(mats[s]);
                    root.AddComponent<MeshRenderer>().sharedMaterials = list.ToArray();
                    if (asset.collider) root.AddComponent<MeshCollider>().sharedMesh = mesh;
                }
                root.name = id;
                var prefab = PrefabUtility.SaveAsPrefabAsset(root, $"{gen}/Prefabs/{id}.prefab");
                UnityEngine.Object.DestroyImmediate(root);
                prefabs[asset.id] = prefab;
            }
            return prefabs;
        }

        static GameObject Spawn(Dictionary<string, GameObject> prefabs, string id, Vector3 at, float yaw, float scale, Transform parent)
        {
            if (string.IsNullOrEmpty(id) || !prefabs.TryGetValue(id, out var prefab)) return null;
            var go = (GameObject)PrefabUtility.InstantiatePrefab(prefab, parent);
            go.transform.SetPositionAndRotation(at, Quaternion.Euler(0f, yaw, 0f));
            go.transform.localScale = Vector3.one * scale;
            return go;
        }

        // ------------------------------------------------------------------ placement

        class Placer
        {
            readonly Terrain terrain;
            readonly float waterY;
            readonly Random rng;
            readonly List<(Vector3 at, float radius)> reserved = new List<(Vector3, float)>();
            public Placer(Terrain terrain, float waterY, Random rng) { this.terrain = terrain; this.waterY = waterY; this.rng = rng; }

            public float Rand() => (float)rng.NextDouble();
            float Size => terrain.terrainData.size.x;

            public Vector3 Ground(float x, float z) => new Vector3(x, terrain.SampleHeight(new Vector3(x, 0f, z)), z);

            public bool Ok(Vector3 p, float maxSlope, float minH01, float maxH01, float clearance)
            {
                var d = terrain.terrainData;
                float u = p.x / d.size.x, v = p.z / d.size.z;
                if (u < 0.08f || u > 0.92f || v < 0.08f || v > 0.92f) return false;
                if (p.y < waterY + 0.4f) return false;
                if (d.GetSteepness(u, v) > maxSlope) return false;
                float h01 = p.y / d.size.y;
                if (h01 < minH01 || h01 > maxH01) return false;
                foreach (var (at, radius) in reserved)
                    if ((new Vector2(at.x, at.z) - new Vector2(p.x, p.z)).sqrMagnitude < (radius + clearance) * (radius + clearance)) return false;
                return true;
            }

            public void Reserve(Vector3 at, float radius) => reserved.Add((at, radius));

            public Vector3? Near(Vector3 centre, float minR, float maxR, float maxSlope)
            {
                for (int i = 0; i < 400; i++)
                {
                    float a = Rand() * Mathf.PI * 2f, r = Mathf.Lerp(minR, maxR, Rand()) + i * 0.15f;
                    var p = Ground(centre.x + Mathf.Cos(a) * r, centre.z + Mathf.Sin(a) * r);
                    if (Ok(p, maxSlope, 0f, 1f, 0f)) return p;
                }
                return null;
            }

            public Vector3? Far(Vector3 from, float minDistance, float maxSlope)
            {
                Vector3? best = null;
                float bestD = 0f;
                for (int i = 0; i < 600; i++)
                {
                    var p = Ground(Mathf.Lerp(0.12f, 0.88f, Rand()) * Size, Mathf.Lerp(0.12f, 0.88f, Rand()) * Size);
                    if (!Ok(p, maxSlope, 0f, 0.6f, 0f)) continue;
                    float d = Vector3.Distance(p, from);
                    if (d >= minDistance) return p;
                    if (d > bestD) { bestD = d; best = p; }
                }
                return best;
            }

            public Vector3? Anywhere(float maxSlope, float minH01, float maxH01, float clearance)
            {
                for (int i = 0; i < 60; i++)
                {
                    var p = Ground(Mathf.Lerp(0.08f, 0.92f, Rand()) * Size, Mathf.Lerp(0.08f, 0.92f, Rand()) * Size);
                    if (Ok(p, maxSlope, minH01, maxH01, clearance)) return p;
                }
                return null;
            }
        }

        static AbGoal PlaceGoal(AbLevelPlan plan, Dictionary<string, GameObject> prefabs, Vector3 at)
        {
            var go = Spawn(prefabs, plan.objective.goalAssetId, at, 0f, 1.6f, null) ?? GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            go.name = "Goal";
            go.transform.position = at;
            var trigger = go.AddComponent<SphereCollider>();
            trigger.isTrigger = true;
            trigger.radius = 1.6f;
            trigger.center = Vector3.up * 1.5f;
            go.AddComponent<Rigidbody>().isKinematic = true;
            var lightGo = new GameObject("Beacon");
            lightGo.transform.SetParent(go.transform, false);
            lightGo.transform.localPosition = Vector3.up * 3f;
            var beacon = lightGo.AddComponent<Light>();
            beacon.type = LightType.Point;
            beacon.range = 18f;
            beacon.intensity = 6f;
            beacon.color = Hex(Find(plan, plan.objective.goalAssetId)?.glow, Color.cyan);
            beacon.enabled = false;
            var goal = go.AddComponent<AbGoal>();
            goal.beacon = beacon;
            return goal;
        }

        static int PlacePickups(AbLevelPlan plan, Dictionary<string, GameObject> prefabs, Placer placer, Vector3 spawn, Vector3 goal)
        {
            var parent = new GameObject("Pickups").transform;
            int count = Mathf.Clamp(plan.objective.count, 1, 30);
            int placed = 0;
            float S = plan.terrain.size;
            for (int i = 0; i < count; i++)
            {
                // Spread them on a loose ring so the hunt crosses the level.
                float a = (float)i / count * Mathf.PI * 2f + placer.Rand() * 0.6f;
                float r = Mathf.Lerp(0.15f, 0.36f, placer.Rand()) * S;
                Vector3? p = null;
                for (int k = 0; k < 40 && p == null; k++)
                {
                    var c = placer.Ground(S * 0.5f + Mathf.Cos(a) * r + (placer.Rand() - 0.5f) * k, S * 0.5f + Mathf.Sin(a) * r + (placer.Rand() - 0.5f) * k);
                    if (placer.Ok(c, 32f, 0f, 0.75f, 4f)) p = c;
                }
                if (p == null) continue;
                placer.Reserve(p.Value, 4f);
                var go = Spawn(prefabs, plan.objective.pickupAssetId, p.Value + Vector3.up * 1.1f, placer.Rand() * 360f, 0.7f, parent);
                if (go == null) { go = GameObject.CreatePrimitive(PrimitiveType.Sphere); go.transform.SetParent(parent); go.transform.position = p.Value + Vector3.up * 1.1f; }
                go.name = $"Pickup {i + 1}";
                foreach (var c in go.GetComponentsInChildren<Collider>()) UnityEngine.Object.DestroyImmediate(c);
                var trigger = go.AddComponent<SphereCollider>();
                trigger.isTrigger = true;
                trigger.radius = 1.4f;
                go.AddComponent<Rigidbody>().isKinematic = true;
                go.AddComponent<AbPickup>();
                var glow = new GameObject("Glow").AddComponent<Light>();
                glow.transform.SetParent(go.transform, false);
                glow.type = LightType.Point;
                glow.range = 5f;
                glow.intensity = 2f;
                glow.color = Hex(Find(plan, plan.objective.pickupAssetId)?.glow, Color.cyan);
                placed++;
            }
            return placed;
        }

        static void PlaceLandmarks(AbLevelPlan plan, Dictionary<string, GameObject> prefabs, Terrain terrain, Transform env)
        {
            var parent = new GameObject("Landmarks").transform;
            parent.SetParent(env);
            float S = plan.terrain.size;
            foreach (var l in plan.landmarks ?? new AbLandmark[0])
            {
                float x = Mathf.Clamp(l.x, 0.1f, 0.9f) * S, z = Mathf.Clamp(l.z, 0.1f, 0.9f) * S;
                var at = new Vector3(x, terrain.SampleHeight(new Vector3(x, 0f, z)), z);
                var go = Spawn(prefabs, l.assetId, at, l.yaw, Mathf.Clamp(l.scale, 0.3f, 8f), parent);
                if (go != null) GameObjectUtility.SetStaticEditorFlags(go, StaticEditorFlags.BatchingStatic | StaticEditorFlags.OccluderStatic | StaticEditorFlags.OccludeeStatic);
            }
        }

        static int Scatter(AbLevelPlan plan, Dictionary<string, GameObject> prefabs, Placer placer, Transform env)
        {
            int total = 0;
            foreach (var rule in plan.scatter ?? new AbScatter[0])
            {
                if (!prefabs.ContainsKey(rule.assetId ?? "")) continue;
                var parent = new GameObject(rule.assetId).transform;
                parent.SetParent(env);
                int count = Mathf.Clamp(rule.count, 0, 600);
                var centres = new List<Vector3>();
                if (rule.clustered)
                    for (int c = 0; c < Mathf.Max(2, count / 8); c++)
                    {
                        var at = placer.Anywhere(rule.maxSlope, rule.minHeight, rule.maxHeight, 0f);
                        if (at != null) centres.Add(at.Value);
                    }
                for (int i = 0; i < count; i++)
                {
                    Vector3? p = null;
                    if (rule.clustered && centres.Count > 0)
                    {
                        var c = centres[i % centres.Count];
                        for (int k = 0; k < 12 && p == null; k++)
                        {
                            float a = placer.Rand() * Mathf.PI * 2f, r = Mathf.Sqrt(placer.Rand()) * 14f;
                            var q = placer.Ground(c.x + Mathf.Cos(a) * r, c.z + Mathf.Sin(a) * r);
                            if (placer.Ok(q, rule.maxSlope, rule.minHeight, rule.maxHeight, 1.5f)) p = q;
                        }
                    }
                    else p = placer.Anywhere(rule.maxSlope, rule.minHeight, rule.maxHeight, 1.5f);
                    if (p == null) continue;
                    float scale = Mathf.Lerp(Mathf.Max(rule.minScale, 0.1f), Mathf.Max(rule.maxScale, rule.minScale), placer.Rand());
                    // Sink a little so nothing floats on a slope.
                    var go = Spawn(prefabs, rule.assetId, p.Value - Vector3.up * 0.15f * scale, placer.Rand() * 360f, scale, parent);
                    if (go == null) continue;
                    GameObjectUtility.SetStaticEditorFlags(go, StaticEditorFlags.BatchingStatic);
                    total++;
                }
            }
            return total;
        }

        static void PlaceEnemies(AbLevelPlan plan, Dictionary<string, GameObject> prefabs, Placer placer, Vector3 spawn)
        {
            var e = plan.enemies;
            if (e == null || e.count <= 0) return;
            var parent = new GameObject("Enemies").transform;
            for (int i = 0; i < Mathf.Min(e.count, 20); i++)
            {
                Vector3? p = null;
                for (int k = 0; k < 30 && p == null; k++)
                {
                    var q = placer.Anywhere(30f, 0f, 0.7f, 2f);
                    if (q != null && Vector3.Distance(q.Value, spawn) > 30f) p = q;
                }
                if (p == null) continue;
                var go = Spawn(prefabs, e.assetId, p.Value + Vector3.up * 0.9f, 0f, 1f, parent);
                if (go == null) { go = GameObject.CreatePrimitive(PrimitiveType.Sphere); go.transform.SetParent(parent); go.transform.position = p.Value + Vector3.up * 0.9f; }
                go.name = $"Enemy {i + 1}";
                foreach (var c in go.GetComponentsInChildren<Collider>()) UnityEngine.Object.DestroyImmediate(c);
                var trigger = go.AddComponent<SphereCollider>();
                trigger.isTrigger = true;
                trigger.radius = 1.1f;
                go.AddComponent<Rigidbody>().isKinematic = true;
                var hazard = go.AddComponent<AbHazard>();
                hazard.speed = Mathf.Clamp(e.speed, 1f, 10f);
                hazard.patrolRadius = Mathf.Clamp(e.radius, 2f, 20f);
            }
        }

        static GameObject BuildPlayer(AbLevelPlan plan, string gen, Grain grain, Vector3 spawn)
        {
            var player = new GameObject("Player");
            player.transform.position = spawn + Vector3.up * 0.1f;
            var body = player.AddComponent<CharacterController>();
            body.height = 1.8f;
            body.radius = 0.4f;
            body.center = Vector3.up * 0.9f;

            var model = new GameObject("Model").transform;
            model.SetParent(player.transform, false);
            var suit = Lit($"{gen}/Materials/player.mat", Hex(plan.player.color, Color.white), 0.45f, 0.1f, grain.albedo, grain.normal);
            var visor = Glow($"{gen}/Materials/player_visor.mat", new Color(0.3f, 0.85f, 1f), 2.5f);
            Part(model, PrimitiveType.Capsule, new Vector3(0f, 0.9f, 0f), new Vector3(0.75f, 0.9f, 0.75f), suit);
            Part(model, PrimitiveType.Sphere, new Vector3(0f, 1.62f, 0f), new Vector3(0.55f, 0.55f, 0.55f), suit);
            Part(model, PrimitiveType.Cube, new Vector3(0f, 1.64f, 0.22f), new Vector3(0.38f, 0.14f, 0.16f), visor);
            Part(model, PrimitiveType.Cube, new Vector3(0f, 1.05f, -0.38f), new Vector3(0.45f, 0.55f, 0.22f), suit);

            var camGo = new GameObject("Main Camera") { tag = "MainCamera" };
            var cam = camGo.AddComponent<Camera>();
            cam.farClipPlane = 1500f;
            cam.fieldOfView = 60f;
            camGo.AddComponent<AudioListener>();
            if (Urp)
            {
                var data = camGo.AddComponent<UniversalAdditionalCameraData>();
                data.renderPostProcessing = true;
                data.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
            }

            var controller = player.AddComponent<AbPlayer>();
            controller.view = cam;
            controller.model = model;
            controller.speed = Mathf.Clamp(plan.player.speed, 2f, 14f);
            controller.jumpHeight = Mathf.Clamp(plan.player.jumpHeight, 0.5f, 4f);
            camGo.transform.position = spawn + new Vector3(0f, 3.5f, -7f);
            camGo.transform.LookAt(spawn + Vector3.up * 1.5f);
            return player;
        }

        static void Part(Transform parent, PrimitiveType type, Vector3 at, Vector3 scale, Material mat)
        {
            var go = GameObject.CreatePrimitive(type);
            UnityEngine.Object.DestroyImmediate(go.GetComponent<Collider>());
            go.transform.SetParent(parent, false);
            go.transform.localPosition = at;
            go.transform.localScale = scale;
            go.GetComponent<MeshRenderer>().sharedMaterial = mat;
        }

        // ------------------------------------------------------------------ output

        static void AddToBuildSettings(string scenePath)
        {
            // Agent Builder's levels play in the order they were made; other
            // scenes (the template's sample) stay listed but switched off.
            var scenes = EditorBuildSettings.scenes.ToList();
            if (!scenes.Any(s => s.path == scenePath)) scenes.Add(new EditorBuildSettingsScene(scenePath, true));
            var levels = scenes.Where(s => Path.GetFileName(s.path).StartsWith("AB_")).Select(s => new EditorBuildSettingsScene(s.path, true));
            var others = scenes.Where(s => !Path.GetFileName(s.path).StartsWith("AB_")).Select(s => new EditorBuildSettingsScene(s.path, false));
            EditorBuildSettings.scenes = levels.Concat(others).ToArray();
        }

        static void RenderPreview(AbPlayer player, Vector3 spawn, Vector3 goal, float S, float H, string file, bool overview)
        {
            // Realtime probes only render in play mode; render them now so the preview reflects this sky.
            foreach (var probe in UnityEngine.Object.FindObjectsByType<ReflectionProbe>(FindObjectsSortMode.None)) probe.RenderProbe();
            bool fog = RenderSettings.fog;
            // From above the whole valley, gameplay fog turns everything grey.
            if (overview) RenderSettings.fog = false;
            Camera cam;
            GameObject temp = null;
            if (!overview && player != null && player.view != null)
            {
                cam = player.view;
                var mid = Vector3.Lerp(spawn, goal, 0.35f);
                cam.transform.position = spawn + (spawn - goal).normalized * 7f + Vector3.up * 3.2f;
                cam.transform.LookAt(mid + Vector3.up * 2f);
            }
            else
            {
                temp = new GameObject("Preview Camera");
                cam = temp.AddComponent<Camera>();
                cam.farClipPlane = 3000f;
                cam.fieldOfView = 50f;
                if (Urp) temp.AddComponent<UniversalAdditionalCameraData>().renderPostProcessing = true;
                var centre = new Vector3(S * 0.5f, 0f, S * 0.5f);
                cam.transform.position = centre + new Vector3(-S * 0.42f, H * 1.6f + S * 0.25f, -S * 0.42f);
                cam.transform.LookAt(centre + Vector3.up * H * 0.15f);
            }
            try
            {
                const int w = 1600, h = 900;
                var rt = new RenderTexture(w, h, 24, RenderTextureFormat.ARGB32) { antiAliasing = 4 };
                var old = cam.targetTexture;
                cam.targetTexture = rt;
                // URP builds its colour-grading lookup table during a frame; the
                // first render after opening a scene grades with an empty one
                // (greens come out brown). The second is what the game shows.
                cam.Render();
                cam.Render();
                RenderTexture.active = rt;
                var tex = new Texture2D(w, h, TextureFormat.RGB24, false);
                tex.ReadPixels(new Rect(0, 0, w, h), 0, 0);
                tex.Apply();
                File.WriteAllBytes(file, tex.EncodeToPNG());
                RenderTexture.active = null;
                cam.targetTexture = old;
                UnityEngine.Object.DestroyImmediate(rt);
                UnityEngine.Object.DestroyImmediate(tex);
                Log($"PREVIEW {file}");
            }
            catch (Exception e)
            {
                Log($"Preview not rendered ({e.Message}); run without -nographics to get previews.");
            }
            finally
            {
                RenderSettings.fog = fog;
                if (temp != null) UnityEngine.Object.DestroyImmediate(temp);
            }
        }

        static void BuildPlayer(string target, string safe, string outDir)
        {
            var scenes = EditorBuildSettings.scenes.Where(s => s.enabled).Select(s => s.path).ToArray();
            var options = new BuildPlayerOptions
            {
                scenes = scenes,
                target = target == "webgl" ? BuildTarget.WebGL : BuildTarget.StandaloneWindows64,
                locationPathName = target == "webgl" ? Path.Combine(outDir, "web") : Path.Combine(outDir, "windows", $"{safe}.exe"),
                options = BuildOptions.None
            };
            var report = BuildPipeline.BuildPlayer(options);
            var summary = report.summary;
            if (summary.result != UnityEditor.Build.Reporting.BuildResult.Succeeded)
                throw new Exception($"Player build {summary.result}: {summary.totalErrors} error(s).");
            Log($"PLAYER {target} {options.locationPathName} ({summary.totalSize / (1024 * 1024)} MB, {summary.totalTime.TotalSeconds:0}s)");
        }

        // ------------------------------------------------------------------ materials, textures, helpers

        static Material Lit(string path, Color color, float smoothness, float metallic, Texture2D albedo, Texture2D normal)
        {
            var shader = Urp ? Shader.Find("Universal Render Pipeline/Lit") : Shader.Find("Standard");
            var mat = new Material(shader);
            if (Urp)
            {
                mat.SetColor("_BaseColor", color);
                if (albedo != null) mat.SetTexture("_BaseMap", albedo);
                mat.SetFloat("_Smoothness", smoothness);
            }
            else
            {
                mat.SetColor("_Color", color);
                if (albedo != null) mat.SetTexture("_MainTex", albedo);
                mat.SetFloat("_Glossiness", smoothness);
            }
            mat.SetFloat("_Metallic", metallic);
            if (normal != null)
            {
                mat.SetTexture("_BumpMap", normal);
                mat.SetFloat("_BumpScale", 0.6f);
                mat.EnableKeyword("_NORMALMAP");
            }
            mat.enableInstancing = true;
            AssetDatabase.CreateAsset(mat, path);
            return mat;
        }

        // Stone, bark and leaves are matte; only metal is allowed to shine much.
        static float Gloss(AbAsset asset, float roughnessScale) =>
            Mathf.Min(1f - Mathf.Clamp01(asset.roughness * roughnessScale), asset.metallic > 0.3f ? 0.9f : 0.35f);

        static Material Glow(string path, Color color, float strength)
        {
            var mat = Lit(path, color, 0.7f, 0f, null, null);
            mat.EnableKeyword("_EMISSION");
            mat.globalIlluminationFlags = MaterialGlobalIlluminationFlags.RealtimeEmissive;
            mat.SetColor("_EmissionColor", color * strength);
            EditorUtility.SetDirty(mat);
            return mat;
        }

        static Texture2D NoiseTexture(string path, int size, Func<float, float, Color> pixel, bool linear)
        {
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, false, linear);
            var px = new Color[size * size];
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                    px[y * size + x] = Tileable(pixel, (float)x / size, (float)y / size);
            tex.SetPixels(px);
            File.WriteAllBytes(path, tex.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(tex);
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
            return AssetDatabase.LoadAssetAtPath<Texture2D>(path);
        }

        // Blends the four wrapped copies so the texture repeats without seams.
        static Color Tileable(Func<float, float, Color> pixel, float u, float v)
        {
            var a = pixel(u, v); var b = pixel(u - 1f, v); var c = pixel(u, v - 1f); var d = pixel(u - 1f, v - 1f);
            return Color.Lerp(Color.Lerp(a, b, u), Color.Lerp(c, d, u), v);
        }

        static Texture2D NormalTexture(string path, int size, Func<float, float, float> height, float strength)
        {
            var hmap = new float[size, size];
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    float u = (float)x / size, v = (float)y / size;
                    float a = height(u, v), b = height(u - 1f, v), c = height(u, v - 1f), d = height(u - 1f, v - 1f);
                    hmap[x, y] = Mathf.Lerp(Mathf.Lerp(a, b, u), Mathf.Lerp(c, d, u), v);
                }
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, false, true);
            var px = new Color[size * size];
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    // Gentle: steep normal maps send the surface to grazing angles,
                    // where it mirrors the sky's ground colour and turns muddy brown.
                    float dx = (hmap[(x + 1) % size, y] - hmap[(x - 1 + size) % size, y]) * strength * 1.5f;
                    float dy = (hmap[x, (y + 1) % size] - hmap[x, (y - 1 + size) % size]) * strength * 1.5f;
                    var n = new Vector3(-dx, -dy, 1f).normalized;
                    px[y * size + x] = new Color(n.x * 0.5f + 0.5f, n.y * 0.5f + 0.5f, n.z * 0.5f + 0.5f, 1f);
                }
            tex.SetPixels(px);
            File.WriteAllBytes(path, tex.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(tex);
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
            var importer = (TextureImporter)AssetImporter.GetAtPath(path);
            importer.textureType = TextureImporterType.NormalMap;
            importer.SaveAndReimport();
            return AssetDatabase.LoadAssetAtPath<Texture2D>(path);
        }

        static AbAsset Find(AbLevelPlan plan, string id) => plan.assets.FirstOrDefault(a => a.id == id);

        static Color Hex(string hex, Color fallback) =>
            !string.IsNullOrEmpty(hex) && ColorUtility.TryParseHtmlString(hex.StartsWith("#") ? hex : "#" + hex, out var c) ? c : fallback;

        static string Safe(string name)
        {
            var chars = name.Select(ch => char.IsLetterOrDigit(ch) || ch == '-' || ch == '_' ? ch : '_').ToArray();
            var s = new string(chars).Trim('_');
            return string.IsNullOrEmpty(s) ? "level" : s;
        }

        static void Ensure(string folder)
        {
            if (AssetDatabase.IsValidFolder(folder)) return;
            var parent = Path.GetDirectoryName(folder).Replace('\\', '/');
            Ensure(parent);
            AssetDatabase.CreateFolder(parent, Path.GetFileName(folder));
        }

        static void Log(string message) => Debug.Log($"{Tag} {message}");
    }
}
