import express from "express";
import { authenticate, authorizeRoles } from "./auth.js";
import {
  submitArGesture,
  submitVoiceCommand,
  registerVoiceListener,
  registerGestureListener,
  type VoiceCommand,
  type ArGesture
} from "../integrations/VoiceArController.js";

const recentVoice: VoiceCommand[] = [];
const recentGestures: ArGesture[] = [];

registerVoiceListener((command) => {
  recentVoice.unshift(command);
  if (recentVoice.length > 50) {
    recentVoice.pop();
  }
});

registerGestureListener((gesture) => {
  recentGestures.unshift(gesture);
  if (recentGestures.length > 50) {
    recentGestures.pop();
  }
});

export const registerControlRoutes = (app: express.Express) => {
  app.get("/api/controls/voice", authenticate, authorizeRoles(["viewer", "editor", "admin", "owner"]), (_req, res) => {
    res.json({ commands: recentVoice });
  });

  app.post("/api/controls/voice", authenticate, authorizeRoles(["editor", "admin", "owner"]), (req, res) => {
    const { text, confidence } = req.body as { text?: string; confidence?: number };
    if (!text) {
      return res.status(400).json({ error: "text is required" });
    }
    const command = submitVoiceCommand({ text, confidence: confidence ?? 0.5 });
    res.status(201).json({ command });
  });

  app.get("/api/controls/gestures", authenticate, authorizeRoles(["viewer", "editor", "admin", "owner"]), (_req, res) => {
    res.json({ gestures: recentGestures });
  });

  app.post("/api/controls/gestures", authenticate, authorizeRoles(["editor", "admin", "owner"]), (req, res) => {
    const { gesture, context } = req.body as { gesture?: string; context?: string };
    if (!gesture) {
      return res.status(400).json({ error: "gesture is required" });
    }
    const record = submitArGesture({ gesture, context });
    res.status(201).json({ gesture: record });
  });
};
