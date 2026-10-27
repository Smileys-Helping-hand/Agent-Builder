// Agent Builder level kit: one place that reads the keyboard and mouse, so the
// level works whether the project uses the new Input System, the old Input
// Manager, or both (Unity 6 templates default to the new one only, where the
// old Input.GetAxis throws).
using UnityEngine;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
#endif

namespace AgentBuilder.Levels
{
    public static class AbInput
    {
        public static Vector2 Move()
        {
#if ENABLE_INPUT_SYSTEM
            var k = Keyboard.current;
            if (k == null) return Vector2.zero;
            float x = (k.dKey.isPressed || k.rightArrowKey.isPressed ? 1f : 0f) - (k.aKey.isPressed || k.leftArrowKey.isPressed ? 1f : 0f);
            float y = (k.wKey.isPressed || k.upArrowKey.isPressed ? 1f : 0f) - (k.sKey.isPressed || k.downArrowKey.isPressed ? 1f : 0f);
            return Vector2.ClampMagnitude(new Vector2(x, y), 1f);
#else
            return Vector2.ClampMagnitude(new Vector2(Input.GetAxisRaw("Horizontal"), Input.GetAxisRaw("Vertical")), 1f);
#endif
        }

        public static Vector2 Look()
        {
#if ENABLE_INPUT_SYSTEM
            var m = Mouse.current;
            return m == null ? Vector2.zero : m.delta.ReadValue() * 0.1f;
#else
            return new Vector2(Input.GetAxis("Mouse X"), Input.GetAxis("Mouse Y")) * 2f;
#endif
        }

        public static bool Jump()
        {
#if ENABLE_INPUT_SYSTEM
            return Keyboard.current != null && Keyboard.current.spaceKey.wasPressedThisFrame;
#else
            return Input.GetKeyDown(KeyCode.Space);
#endif
        }

        public static bool Sprint()
        {
#if ENABLE_INPUT_SYSTEM
            return Keyboard.current != null && Keyboard.current.leftShiftKey.isPressed;
#else
            return Input.GetKey(KeyCode.LeftShift);
#endif
        }

        public static bool Pressed(KeyCode legacy)
        {
#if ENABLE_INPUT_SYSTEM
            var k = Keyboard.current;
            if (k == null) return false;
            switch (legacy)
            {
                case KeyCode.Escape: return k.escapeKey.wasPressedThisFrame;
                case KeyCode.Return: return k.enterKey.wasPressedThisFrame;
                case KeyCode.R: return k.rKey.wasPressedThisFrame;
                default: return false;
            }
#else
            return Input.GetKeyDown(legacy);
#endif
        }

        public static bool Click()
        {
#if ENABLE_INPUT_SYSTEM
            return Mouse.current != null && Mouse.current.leftButton.wasPressedThisFrame;
#else
            return Input.GetMouseButtonDown(0);
#endif
        }
    }
}
