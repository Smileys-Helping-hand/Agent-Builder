/**
 * The page around the game: the engine draws in GameCanvas; put menus or HUD
 * that are easier in HTML on top of it here. Getting ready… disappears as the
 * game takes shape: replace this text with the game's own.
 */
import GameCanvas from "./engine/GameCanvas";

export default function App() {
  return (
    <main className="app" style={{ position: "fixed", inset: 0, margin: 0, padding: 0, maxWidth: "none", background: "#000" }}>
      <GameCanvas />
      <p style={{ position: "absolute", left: 12, bottom: 8, color: "#889", margin: 0, font: "12px system-ui", pointerEvents: "none" }}>__NAME__ · Getting ready…</p>
    </main>
  );
}
