import { io, type Socket } from "socket.io-client";
import type { CollaborationParticipant, SessionSnapshot } from "../orchestrator/CollaborationHub.js";

export type CollaborationClientOptions = {
  serverUrl?: string;
};

export class CollaborationClient {
  private socket: Socket | null = null;
  private readonly options: CollaborationClientOptions;

  constructor(options: CollaborationClientOptions = {}) {
    this.options = options;
  }

  connect() {
    if (this.socket) {
      return this.socket;
    }

    const url = this.options.serverUrl ?? `http://localhost:${process.env.COLLAB_PORT ?? 35000}`;
    this.socket = io(url, { transports: ["websocket", "polling"] });
    return this.socket;
  }

  join(sessionId: string, participant: CollaborationParticipant, onSnapshot: (snapshot: SessionSnapshot) => void) {
    const socket = this.connect();
    socket.emit("collab:join", { sessionId, participant });
    socket.on("collab:snapshot", onSnapshot);
  }

  updateCursor(sessionId: string, participantId: string, cursor: CollaborationParticipant["cursor"]) {
    this.socket?.emit("collab:cursor", { sessionId, participantId, cursor });
  }

  sendDiff(sessionId: string, filePath: string, diff: string) {
    this.socket?.emit("collab:diff", { sessionId, filePath, diff });
  }
}
