// Agent Builder level kit: the level's state — story card, objective count,
// opening the exit, the win screen, and moving on to the next level in Build
// Settings. Draws its HUD with IMGUI so the level needs no UI package.
using UnityEngine;
using UnityEngine.SceneManagement;

namespace AgentBuilder.Levels
{
    public class AbLevelDirector : MonoBehaviour
    {
        public static AbLevelDirector Instance { get; private set; }
        public static float KillHeight = -50f;

        public string levelTitle = "Level";
        [TextArea] public string story = "";
        public string pickupLabel = "crystals";
        public string goalLabel = "the portal";
        public int required = 5;
        public float killHeight = -50f;
        public AbGoal goal;

        public bool Playing { get; private set; }
        int collected;
        bool won;
        string flash;
        float flashUntil;
        float startedAt;
        GUIStyle big, body, small;

        void Awake()
        {
            Instance = this;
            KillHeight = killHeight;
        }

        void Start()
        {
            Playing = false;
            Cursor.lockState = CursorLockMode.None;
            if (required <= 0 && goal != null) goal.Open();
        }

        void Update()
        {
            if (!Playing && !won && (AbInput.Pressed(KeyCode.Return) || AbInput.Click())) Begin();
            if (Playing && AbInput.Pressed(KeyCode.Escape)) { Playing = false; Cursor.lockState = CursorLockMode.None; Cursor.visible = true; }
            if (won && AbInput.Pressed(KeyCode.Return)) NextLevel();
            if (won && AbInput.Pressed(KeyCode.R)) SceneManager.LoadScene(SceneManager.GetActiveScene().buildIndex);
        }

        void Begin()
        {
            Playing = true;
            if (startedAt <= 0f) startedAt = Time.time;
            Cursor.lockState = CursorLockMode.Locked;
            Cursor.visible = false;
        }

        public void Collected(AbPickup pickup)
        {
            collected++;
            if (collected >= required)
            {
                if (goal != null) goal.Open();
                Flash($"All {pickupLabel} found — {goalLabel} is open!", 3f);
            }
            else
            {
                Flash($"{collected} / {required} {pickupLabel}", 1.2f);
            }
        }

        public void ReachedGoal()
        {
            won = true;
            Playing = false;
            Cursor.lockState = CursorLockMode.None;
            Cursor.visible = true;
        }

        public void Flash(string message, float seconds)
        {
            flash = message;
            flashUntil = Time.time + seconds;
        }

        void NextLevel()
        {
            int next = SceneManager.GetActiveScene().buildIndex + 1;
            SceneManager.LoadScene(next < SceneManager.sceneCountInBuildSettings ? next : 0);
        }

        void Styles()
        {
            if (big != null) return;
            big = new GUIStyle(GUI.skin.label) { fontSize = 34, fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleCenter, wordWrap = true };
            body = new GUIStyle(GUI.skin.label) { fontSize = 17, alignment = TextAnchor.MiddleCenter, wordWrap = true };
            small = new GUIStyle(GUI.skin.label) { fontSize = 16, fontStyle = FontStyle.Bold };
            big.normal.textColor = body.normal.textColor = small.normal.textColor = Color.white;
        }

        void Panel(Rect r)
        {
            var old = GUI.color;
            GUI.color = new Color(0f, 0f, 0f, 0.55f);
            GUI.DrawTexture(r, Texture2D.whiteTexture);
            GUI.color = old;
        }

        void OnGUI()
        {
            Styles();
            float w = Screen.width, h = Screen.height;
            if (!Playing && !won)
            {
                var r = new Rect(w * 0.2f, h * 0.22f, w * 0.6f, h * 0.5f);
                Panel(r);
                GUI.Label(new Rect(r.x + 20, r.y + 20, r.width - 40, 60), levelTitle, big);
                GUI.Label(new Rect(r.x + 30, r.y + 90, r.width - 60, r.height - 170), story, body);
                GUI.Label(new Rect(r.x + 20, r.yMax - 80, r.width - 40, 60),
                    $"Find {required} {pickupLabel}, then reach {goalLabel}.\nWASD move · Mouse look · Space jump · Shift sprint — click or Enter to {(startedAt > 0f ? "resume" : "start")}", body);
                return;
            }
            if (won)
            {
                var r = new Rect(w * 0.25f, h * 0.3f, w * 0.5f, h * 0.3f);
                Panel(r);
                GUI.Label(new Rect(r.x, r.y + 20, r.width, 60), "Level complete!", big);
                GUI.Label(new Rect(r.x, r.y + 90, r.width, 80), $"Time: {Time.time - startedAt:0.0}s\nEnter — next level · R — play again", body);
                return;
            }
            Panel(new Rect(16, 16, 260, 64));
            GUI.Label(new Rect(28, 22, 240, 26), levelTitle, small);
            GUI.Label(new Rect(28, 48, 240, 26), $"{Mathf.Min(collected, required)} / {required} {pickupLabel}", small);
            if (!string.IsNullOrEmpty(flash) && Time.time < flashUntil)
            {
                Panel(new Rect(w * 0.3f, h * 0.12f, w * 0.4f, 50));
                GUI.Label(new Rect(w * 0.3f, h * 0.12f, w * 0.4f, 50), flash, body);
            }
        }
    }
}
