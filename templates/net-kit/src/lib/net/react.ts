/**
 * React glue for src/lib/net: re-renders the component whenever the room
 * changes (players, state, status), and leaves the room when it unmounts.
 *
 *   const room = useRoom(() => connect(rules, { room: code, name }), [code, name]);
 *   if (!room) return null;
 *   return <Board state={room.state} onMove={(m) => room.send(m)} />;
 */
import { useEffect, useState } from "react";

import type { Room } from "./index";

export function useRoom<S, A>(open: () => Room<S, A> | null, deps: unknown[]): Room<S, A> | null {
  const [room, setRoom] = useState<Room<S, A> | null>(null);
  const [, setVersion] = useState(0);
  useEffect(() => {
    const next = open();
    setRoom(next);
    const stop = next?.subscribe(() => setVersion((v) => v + 1));
    return () => {
      stop?.();
      next?.leave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller says when to reconnect
  }, deps);
  return room;
}
