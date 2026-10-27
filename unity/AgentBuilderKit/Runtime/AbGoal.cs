// Agent Builder level kit: the level exit. Dormant (dim, no glow) until the
// objective is met, then it lights up and finishes the level on contact.
using UnityEngine;

namespace AgentBuilder.Levels
{
    public class AbGoal : MonoBehaviour
    {
        public Light beacon;
        bool open;

        public void Open()
        {
            open = true;
            if (beacon != null) beacon.enabled = true;
        }

        void Update()
        {
            if (open) transform.Rotate(0f, 30f * Time.deltaTime, 0f, Space.World);
        }

        void OnTriggerEnter(Collider other)
        {
            if (!open || other.GetComponent<AbPlayer>() == null) return;
            if (AbLevelDirector.Instance != null) AbLevelDirector.Instance.ReachedGoal();
        }
    }
}
