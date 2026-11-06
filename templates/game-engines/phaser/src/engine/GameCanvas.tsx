/** Where the Phaser game runs. It loads only in a real browser: tests have no canvas. */
import { useEffect, useRef } from "react";

export default function GameCanvas() {
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!holder.current || /jsdom/i.test(navigator.userAgent)) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import("./game").then(({ startGame }) => {
      if (!cancelled && holder.current) stop = startGame(holder.current);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
  return <div ref={holder} style={{ width: "100%", height: "100%" }} />;
}
