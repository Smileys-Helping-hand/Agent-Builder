// Agent Builder level kit: an enemy that patrols a circle around its post and
// chases the player who comes close. Touching it sends the player back to the start.
using UnityEngine;

namespace AgentBuilder.Levels
{
    public class AbHazard : MonoBehaviour
    {
        public float speed = 3f;
        public float patrolRadius = 6f;
        public float chaseRadius = 9f;
        Vector3 post;
        float angle;
        Transform player;

        void Start()
        {
            post = transform.position;
            angle = Random.value * Mathf.PI * 2f;
            var p = FindAnyObjectByType<AbPlayer>();
            if (p != null) player = p.transform;
        }

        void Update()
        {
            if (AbLevelDirector.Instance != null && !AbLevelDirector.Instance.Playing) return;
            Vector3 target;
            if (player != null && Vector3.Distance(player.position, post) < chaseRadius)
            {
                target = player.position;
            }
            else
            {
                angle += speed / Mathf.Max(patrolRadius, 0.5f) * Time.deltaTime;
                target = post + new Vector3(Mathf.Cos(angle), 0f, Mathf.Sin(angle)) * patrolRadius;
            }
            target.y = SampleGround(target) + 0.9f;
            transform.position = Vector3.MoveTowards(transform.position, target, speed * Time.deltaTime);
            var flat = new Vector3(target.x - transform.position.x, 0f, target.z - transform.position.z);
            if (flat.sqrMagnitude > 0.001f) transform.rotation = Quaternion.LookRotation(flat);
        }

        static float SampleGround(Vector3 at)
        {
            var t = Terrain.activeTerrain;
            return t == null ? at.y : t.SampleHeight(at) + t.transform.position.y;
        }

        void OnTriggerEnter(Collider other)
        {
            var p = other.GetComponent<AbPlayer>();
            if (p != null) p.Respawn();
        }
    }
}
