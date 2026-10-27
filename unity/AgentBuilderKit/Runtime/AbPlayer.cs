// Agent Builder level kit: third-person player. CharacterController movement
// relative to the camera, jump, sprint, and an orbit camera that pulls in
// when terrain or props are between it and the player.
using UnityEngine;

namespace AgentBuilder.Levels
{
    [RequireComponent(typeof(CharacterController))]
    public class AbPlayer : MonoBehaviour
    {
        public float speed = 6f;
        public float sprintMultiplier = 1.6f;
        public float jumpHeight = 1.6f;
        public float gravity = -22f;
        public Transform model;

        [Header("Camera")]
        public Camera view;
        public float cameraDistance = 7f;
        public float cameraHeight = 1.6f;
        public float lookSensitivity = 1f;

        CharacterController body;
        Vector3 velocity;
        float yaw;
        float pitch = 14f;
        Vector3 spawn;

        void Awake()
        {
            body = GetComponent<CharacterController>();
            spawn = transform.position;
            yaw = transform.eulerAngles.y;
            if (view == null) view = Camera.main;
        }

        void Update()
        {
            if (AbLevelDirector.Instance != null && !AbLevelDirector.Instance.Playing) return;

            var look = AbInput.Look() * lookSensitivity;
            yaw += look.x;
            pitch = Mathf.Clamp(pitch - look.y, -10f, 60f);

            var input = AbInput.Move();
            var forward = Quaternion.Euler(0f, yaw, 0f) * Vector3.forward;
            var right = Quaternion.Euler(0f, yaw, 0f) * Vector3.right;
            var move = (forward * input.y + right * input.x) * speed * (AbInput.Sprint() ? sprintMultiplier : 1f);

            if (body.isGrounded)
            {
                if (velocity.y < 0f) velocity.y = -2f;
                if (AbInput.Jump()) velocity.y = Mathf.Sqrt(jumpHeight * -2f * gravity);
            }
            velocity.y += gravity * Time.deltaTime;
            body.Move((move + Vector3.up * velocity.y) * Time.deltaTime);

            if (model != null && move.sqrMagnitude > 0.01f)
            {
                var facing = Quaternion.LookRotation(new Vector3(move.x, 0f, move.z));
                model.rotation = Quaternion.Slerp(model.rotation, facing, 12f * Time.deltaTime);
            }

            if (transform.position.y < AbLevelDirector.KillHeight) Respawn();
        }

        void LateUpdate()
        {
            if (view == null) return;
            var pivot = transform.position + Vector3.up * cameraHeight;
            var rotation = Quaternion.Euler(pitch, yaw, 0f);
            var wanted = pivot - rotation * Vector3.forward * cameraDistance;
            // Pull the camera in front of anything between it and the player.
            if (Physics.SphereCast(pivot, 0.3f, (wanted - pivot).normalized, out var hit, cameraDistance, ~0, QueryTriggerInteraction.Ignore)
                && hit.transform != transform)
            {
                wanted = pivot + (wanted - pivot).normalized * Mathf.Max(hit.distance - 0.2f, 1f);
            }
            view.transform.SetPositionAndRotation(wanted, Quaternion.LookRotation(pivot - wanted));
        }

        public void Respawn()
        {
            body.enabled = false;
            transform.position = spawn;
            velocity = Vector3.zero;
            body.enabled = true;
            if (AbLevelDirector.Instance != null) AbLevelDirector.Instance.Flash("Back to the start", 1.5f);
        }
    }
}
