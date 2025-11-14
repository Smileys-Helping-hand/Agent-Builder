import http from "http";
import { Server as SocketServer, type Socket } from "socket.io";
import { Logger } from "../utils/Logger.js";
import { CollaborationHub } from "./CollaborationHub.js";

export type CollaborationParticipant = {
  id: string;
  name: string;
  role: "Builder" | "UX" | "QA" | "Ops";
  cursor?: { filePath: string; position: { line: number; column: number } };
};

export class CollaborationServer {
  private static instance: CollaborationServer | null = null;
  private io: SocketServer | null = null;
  private readonly hub = CollaborationHub.getInstance();

  static getInstance() {
    if (!this.instance) {
      this.instance = new CollaborationServer();
    }
    return this.instance;
  }

  start(server?: http.Server) {
    if (this.io) {
      return this.io;
    }

    const port = Number(process.env.COLLAB_PORT ?? 35000);

    if (!server) {
      server = http.createServer();
      server.listen(port, () => {
        Logger.log("Collaboration server listening", { port });
      });
    }

    this.io = new SocketServer(server, {
      cors: { origin: "*" }
    });

    this.io.on("connection", (socket) => this.registerHandlers(socket));
    return this.io;
  }

  private registerHandlers(socket: Socket) {
    Logger.log("Collaboration client connected", { id: socket.id });

    socket.on("collab:join", ({ sessionId, participant }: { sessionId: string; participant: CollaborationParticipant }) => {
      const session = this.hub.joinSession(sessionId, participant, socket.id);
      socket.join(session.id);
      socket.emit("collab:snapshot", session.snapshot);
      socket.to(session.id).emit("collab:participants", session.participants);
    });

    socket.on("collab:cursor", ({ sessionId, participantId, cursor }: { sessionId: string; participantId: string; cursor: CollaborationParticipant["cursor"] }) => {
      const participants = this.hub.updateCursor(sessionId, participantId, cursor ?? null);
      if (participants) {
        this.io?.to(sessionId).emit("collab:participants", participants);
      }
    });

    socket.on("collab:diff", ({ sessionId, filePath, diff }: { sessionId: string; filePath: string; diff: string }) => {
      const update = this.hub.recordDiff(sessionId, filePath, diff);
      if (update) {
        this.io?.to(sessionId).emit("collab:diff", update);
      }
    });

    socket.on("disconnect", () => {
      Logger.log("Collaboration client disconnected", { id: socket.id });
      const updates = this.hub.removeBySocket(socket.id);
      for (const update of updates) {
        this.io?.to(update.sessionId).emit("collab:participants", update.participants);
      }
    });
  }
}
