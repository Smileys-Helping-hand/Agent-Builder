import { WebSocketServer } from "ws";
import { eventBus, type ServerEvent } from "../eventBus.js";
import { Logger } from "../../utils/Logger.js";

export class BuilderStream {
  private static instance: BuilderStream | null = null;
  private readonly wss: WebSocketServer;

  private constructor(port = 8090) {
    this.wss = new WebSocketServer({ port });
    this.wss.on("connection", (socket) => {
      socket.send(JSON.stringify({ type: "builder", payload: { level: "info", message: "Live builder stream connected" } }));
      const forward = (event: ServerEvent) => {
        if (event.type === "builder" || event.type === "task" || event.type === "log" || event.type === "build") {
          socket.send(JSON.stringify(event));
        }
      };

      eventBus.on("event", forward);
      socket.on("close", () => eventBus.off("event", forward));
    });
    Logger.log(`Builder stream listening on ws://localhost:${port}/builder-stream`);
  }

  static getInstance() {
    if (!this.instance) {
      this.instance = new BuilderStream();
    }
    return this.instance;
  }
}
