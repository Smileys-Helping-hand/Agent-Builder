// Agent Builder level kit: a collectible that bobs and spins, counted by the
// level director when the player touches it.
using UnityEngine;

namespace AgentBuilder.Levels
{
    public class AbPickup : MonoBehaviour
    {
        public float spinDegrees = 90f;
        public float bob = 0.25f;
        Vector3 start;
        float phase;

        void Start()
        {
            start = transform.position;
            phase = Random.value * 10f;
        }

        void Update()
        {
            transform.Rotate(0f, spinDegrees * Time.deltaTime, 0f, Space.World);
            transform.position = start + Vector3.up * (Mathf.Sin((Time.time + phase) * 2f) * bob);
        }

        void OnTriggerEnter(Collider other)
        {
            if (other.GetComponent<AbPlayer>() == null) return;
            if (AbLevelDirector.Instance != null) AbLevelDirector.Instance.Collected(this);
            gameObject.SetActive(false);
        }
    }
}
