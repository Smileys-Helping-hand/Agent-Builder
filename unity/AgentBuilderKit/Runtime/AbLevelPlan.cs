// Agent Builder level kit: the level plan Agent Builder writes (level.json),
// in the shape JsonUtility reads. Agent Builder's UnityLevelStudio.ts is the
// other half of this contract: change a field there, change it here.
using System;

namespace AgentBuilder.Levels
{
    [Serializable]
    public class AbPart
    {
        public string shape = "box"; // box | sphere | rock | cylinder | cone | torus
        public float[] pos = { 0f, 0f, 0f };
        public float[] rot = { 0f, 0f, 0f };
        public float[] scale = { 1f, 1f, 1f };
        public int slot; // 0 primary, 1 secondary, 2 glow
        public float noise; // 0..1 surface displacement
        public float taper = 1f; // cylinder top radius / bottom radius
        public int segments; // 0 = default
    }

    [Serializable]
    public class AbAsset
    {
        public string id;
        public string name;
        public string kind;
        public string primary = "#808080";
        public string secondary = "#404040";
        public string glow = "#00E5FF";
        public bool emissive;
        public float roughness = 0.6f;
        public float metallic;
        public bool collider = true;
        public AbPart[] parts = new AbPart[0];
    }

    [Serializable]
    public class AbScatter
    {
        public string assetId;
        public int count;
        public float minHeight; // 0..1 of the terrain's height
        public float maxHeight = 1f;
        public float maxSlope = 35f;
        public float minScale = 0.8f;
        public float maxScale = 1.3f;
        public bool clustered;
    }

    [Serializable]
    public class AbLandmark
    {
        public string assetId;
        public float x = 0.5f; // 0..1 across the terrain
        public float z = 0.5f;
        public float scale = 1f;
        public float yaw;
    }

    [Serializable]
    public class AbPalette
    {
        public string ground = "#6B5B45";
        public string grass = "#4E7A3A";
        public string rock = "#7A7570";
        public string sand = "#C8B48A";
        public string sky = "#8EC5FF";
        public string fog = "#B8C8D8";
        public string water = "#2A6F8F";
    }

    [Serializable]
    public class AbTerrain
    {
        public float size = 220f;
        public float height = 45f;
        public float roughness = 0.5f;
        public float mountains = 0.6f; // how high the rim that encloses the level rises
        public float valley = 0.3f;
        public bool water = true;
        public float waterLevel = 0.12f; // 0..1 of height
        public int seed = 1;
    }

    [Serializable]
    public class AbPlayerDef
    {
        public float speed = 6f;
        public float jumpHeight = 1.6f;
        public string color = "#E8E2D0";
    }

    [Serializable]
    public class AbObjective
    {
        public string pickupAssetId;
        public string goalAssetId;
        public string pickupLabel = "crystals";
        public string goalLabel = "the portal";
        public int count = 6;
    }

    [Serializable]
    public class AbEnemies
    {
        public string assetId;
        public int count = 3;
        public float speed = 3f;
        public float radius = 7f;
    }

    [Serializable]
    public class AbLevelPlan
    {
        public string name = "level";
        public string title = "Level";
        public string story = "";
        public string biome = "forest";
        public string timeOfDay = "noon"; // dawn | noon | sunset | night
        public float fogDensity = 0.006f;
        public AbPalette palette = new AbPalette();
        public AbTerrain terrain = new AbTerrain();
        public AbPlayerDef player = new AbPlayerDef();
        public AbObjective objective = new AbObjective();
        public AbEnemies enemies = new AbEnemies();
        public AbAsset[] assets = new AbAsset[0];
        public AbScatter[] scatter = new AbScatter[0];
        public AbLandmark[] landmarks = new AbLandmark[0];
    }
}
