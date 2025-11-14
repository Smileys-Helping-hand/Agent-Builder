import { EventEmitter } from "events";
import { Logger } from "../utils/Logger.js";
import { VoiceController, type VoiceTranscript } from "./VoiceController.js";
import { VoicePlanner } from "../orchestrator/VoicePlanner.js";
import { BuildEngine } from "../orchestrator/BuildEngine.js";
import type { BuildMode } from "../models/BuildTypes.js";

export type VoiceFlowEvents = {
  transcript: [VoiceTranscript];
  build: [{ buildId: string; prompt: string }];
  error: [Error];
};

const MODE_KEYWORDS: Record<BuildMode, RegExp[]> = {
  app: [/app/i, /dashboard/i, /frontend/i, /backend/i],
  game: [/game/i, /roblox/i, /obby/i, /tycoon/i],
  simulation: [/simulation/i, /storyworld/i, /narrative/i, /world/i],
  fusion: [/fusion/i, /hybrid/i, /simulation app/i]
};

const detectMode = (text: string): BuildMode => {
  const lowered = text.toLowerCase();
  for (const [mode, patterns] of Object.entries(MODE_KEYWORDS) as Array<[BuildMode, RegExp[]]>) {
    if (patterns.some((pattern) => pattern.test(lowered))) {
      return mode;
    }
  }
  return (process.env.BUILD_MODE as BuildMode) ?? "app";
};

export class VoiceFlowController extends EventEmitter {
  private readonly voice: VoiceController;
  private buildEngine: BuildEngine | null = null;
  private narrator = false;

  constructor(voice = new VoiceController()) {
    super();
    this.voice = voice;
    this.voice.on("transcription", (transcript) => {
      this.emit("transcript", transcript);
      void this.handleTranscript(transcript);
    });
    this.voice.on("error", (error) => this.emit("error", error));
  }

  attachBuildEngine(engine: BuildEngine) {
    this.buildEngine = engine;
  }

  enableNarratorMode(enabled: boolean) {
    this.narrator = enabled;
    this.voice.setNarratorEnabled(enabled);
  }

  async start(): Promise<void> {
    await this.voice.startListening();
  }

  async stop(): Promise<void> {
    await this.voice.stopListening();
  }

  async handleTranscript(transcript: VoiceTranscript): Promise<void> {
    const command = transcript.text.trim();
    if (!command || !this.buildEngine) {
      return;
    }

    const mode = detectMode(command);
    const plan = await VoicePlanner.planBuild(command, mode);
    const job = this.buildEngine.startBuild({
      prompt: command,
      mode,
      autonomy: (process.env.AUTONOMY_LEVEL as any) ?? "semi",
      planOverride: plan
    });
    this.emit("build", { buildId: job.id, prompt: command });

    if (this.narrator) {
      try {
        const audioPath = await this.voice.narrate(`Planning ${mode} build: ${plan.overview}`);
        if (audioPath) {
          Logger.log("VoiceFlowController narration ready", { audioPath });
        }
      } catch (error) {
        Logger.warn("VoiceFlowController narration failed", error);
      }
    }
  }
}
