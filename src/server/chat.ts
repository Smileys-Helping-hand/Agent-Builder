import type { Application, Request, Response } from "express";
import { authenticate, authorizeRoles } from "./auth.js";
import { AutoCodeEngine, ProposedEdit } from "../utils/AutoCodeEngine.js";
import { Logger } from "../utils/Logger.js";

const engine = new AutoCodeEngine();

type AutoCodeAction = "read" | "propose" | "apply" | "commit";

type AutoCodeRequest = {
  action: AutoCodeAction;
  filePath?: string;
  instruction?: string;
  edit?: ProposedEdit;
  commitMessage?: string;
  files?: string[];
};

export const registerChatRoutes = (app: Application) => {
  app.post(
    "/api/chat/autocode",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    async (req: Request, res: Response) => {
      const { action, filePath, instruction, edit, commitMessage, files } = req.body as AutoCodeRequest;

      try {
        switch (action) {
          case "read": {
            if (!filePath) {
              return res.status(400).json({ error: "filePath is required" });
            }
            const content = await engine.readFile(filePath);
            return res.json({ message: `Read ${filePath}`, content, history: engine.getHistory() });
          }
          case "propose": {
            if (!filePath || !instruction) {
              return res.status(400).json({ error: "filePath and instruction are required" });
            }
            const result = await engine.proposeEdit(filePath, instruction);
            return res.json({ ...result, history: engine.getHistory() });
          }
          case "apply": {
            if (!edit) {
              return res.status(400).json({ error: "edit payload is required" });
            }
            await engine.applyEdit(edit);
            return res.json({ message: `Applied changes to ${edit.filePath}`, history: engine.getHistory() });
          }
          case "commit": {
            if (!commitMessage) {
              return res.status(400).json({ error: "commitMessage is required" });
            }
            await engine.commit(commitMessage, files);
            return res.json({ message: `Committed changes: ${commitMessage}`, history: engine.getHistory() });
          }
          default:
            return res.status(400).json({ error: `Unsupported action ${(action as string) ?? "unknown"}` });
        }
      } catch (error) {
        Logger.error("AutoCode chat error", error);
        const message = error instanceof Error ? error.message : String(error);
        return res.status(500).json({ error: message });
      }
    }
  );
};
