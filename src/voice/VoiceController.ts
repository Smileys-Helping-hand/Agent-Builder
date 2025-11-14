import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { Logger } from "../utils/Logger.js";
import { EmotionSynthesizer, type EmotionTone } from "./EmotionSynthesizer.js";

export type VoiceControllerEvents = {
  transcription: [transcript: VoiceTranscript];
  error: [error: Error];
  speech: [audioPath: string];
};

export type VoiceTranscript = {
  text: string;
  confidence: number;
  timestamp: string;
};

export type VoiceControllerOptions = {
  whisperModel?: string;
  speechCacheDir?: string;
};

export type VoiceProfile = {
  voice: string;
  style?: string;
  rate?: string;
  volume?: string;
};

export type NarrationOptions = {
  entityId?: string;
  voice?: string;
  profile?: VoiceProfile;
  emotion?: EmotionTone;
};

type OptionalWhisper = {
  transcribe: (audio: Buffer, options?: { model?: string }) => Promise<VoiceTranscript>;
};

type OptionalEdgeTTS = {
  speak: (text: string, options?: Record<string, unknown>) => Promise<Buffer>;
};

const ensureDir = async (target: string) => {
  await fs.promises.mkdir(target, { recursive: true });
};

export class VoiceController extends EventEmitter {
  private listening = false;
  private whisper: OptionalWhisper | null = null;
  private edge: OptionalEdgeTTS | null = null;
  private readonly options: VoiceControllerOptions;
  private readonly defaultVoice = process.env.VOICE_DEFAULT_VOICE ?? "en-US-JennyNeural";
  private narratorEnabled = false;
  private readonly voiceProfiles = new Map<string, VoiceProfile>();
  private readonly emotion = EmotionSynthesizer.getInstance();

  constructor(options: VoiceControllerOptions = {}) {
    super();
    this.options = options;
  }

  private async ensureWhisper(): Promise<void> {
    if (this.whisper) return;
    try {
      const module = (await import("whisper-tts")) as any;
      this.whisper = (module?.transcribe ? module : module?.default) ?? null;
      if (!this.whisper) {
        Logger.warn("Whisper integration unavailable – missing transcribe method");
      }
    } catch (error) {
      Logger.warn("Failed to load whisper-tts. Voice transcription will be simulated.", error);
      this.whisper = null;
    }
  }

  private async ensureEdgeTTS(): Promise<void> {
    if (this.edge) return;
    try {
      const module = (await import("edge-tts")) as any;
      this.edge = (module?.speak ? module : module?.default) ?? null;
      if (!this.edge) {
        Logger.warn("edge-tts integration unavailable – missing speak method");
      }
    } catch (error) {
      Logger.warn("Failed to load edge-tts. Text to speech will be simulated.", error);
      this.edge = null;
    }
  }

  async startListening(): Promise<void> {
    await this.ensureWhisper();
    this.listening = true;
    Logger.log("VoiceController listening started");
  }

  async stopListening(): Promise<void> {
    this.listening = false;
    Logger.log("VoiceController listening stopped");
  }

  async processAudio(audio: Buffer): Promise<void> {
    if (!this.listening) {
      Logger.warn("VoiceController received audio while not listening");
      return;
    }

    try {
      if (this.whisper) {
        const result = await this.whisper.transcribe(audio, { model: this.options.whisperModel });
        this.emit("transcription", { ...result, timestamp: new Date().toISOString() });
        return;
      }

      const simulated: VoiceTranscript = {
        text: "(transcription unavailable – configure whisper-tts)",
        confidence: 0,
        timestamp: new Date().toISOString()
      };
      this.emit("transcription", simulated);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      Logger.error("VoiceController transcription error", err);
      this.emit("error", err);
    }
  }

  setNarratorEnabled(enabled: boolean) {
    this.narratorEnabled = enabled;
  }

  assignVoiceProfile(entityId: string, profile: VoiceProfile) {
    this.voiceProfiles.set(entityId, profile);
  }

  removeVoiceProfile(entityId: string) {
    this.voiceProfiles.delete(entityId);
  }

  async speak(responseText: string, emotion?: EmotionTone): Promise<string> {
    const base: VoiceProfile = { voice: this.defaultVoice };
    const shouldApply = Boolean(emotion ?? this.shouldApplyEmotion());
    const enriched = shouldApply ? this.emotion.applyEmotion(base, emotion) : base;
    return this.synthesize(responseText, enriched);
  }

  async speakWithEmotion(responseText: string, emotion: EmotionTone, options: NarrationOptions = {}): Promise<string> {
    const base: VoiceProfile = {
      voice: options.voice ?? this.defaultVoice,
      ...(options.profile ?? {})
    };
    const enriched = this.emotion.applyEmotion(base, emotion);
    return this.synthesize(responseText, enriched);
  }

  async narrate(responseText: string, options: NarrationOptions = {}): Promise<string | null> {
    if (!this.narratorEnabled) {
      return null;
    }

    const storedProfile = options.profile ?? (options.entityId ? this.voiceProfiles.get(options.entityId) : undefined);
    const voice = options.voice ?? storedProfile?.voice ?? process.env.VOICE_NARRATOR_VOICE ?? this.defaultVoice;
    const baseProfile: VoiceProfile = { voice };
    if (storedProfile?.style) baseProfile.style = storedProfile.style;
    if (storedProfile?.rate) baseProfile.rate = storedProfile.rate;
    if (storedProfile?.volume) baseProfile.volume = storedProfile.volume;

    const shouldApplyEmotion = this.shouldApplyEmotion() || Boolean(options.emotion);
    const profile = shouldApplyEmotion ? this.emotion.applyEmotion(baseProfile, options.emotion) : baseProfile;

    try {
      return await this.synthesize(responseText, profile);
    } catch (error) {
      Logger.warn("VoiceController narration failed", error);
      return null;
    }
  }

  private async synthesize(text: string, profile: VoiceProfile): Promise<string> {
    await this.ensureEdgeTTS();
    try {
      const cacheDir = this.options.speechCacheDir ?? path.resolve("./data/voice");
      await ensureDir(cacheDir);
      const filename = `speech-${Date.now()}.mp3`;
      const filePath = path.join(cacheDir, filename);

      if (this.edge) {
        const options: Record<string, unknown> = { voice: profile.voice ?? this.defaultVoice };
        if (profile.style) options.style = profile.style;
        if (profile.rate) options.rate = profile.rate;
        if (profile.volume) options.volume = profile.volume;
        const audio = await this.edge.speak(text, options);
        await fs.promises.writeFile(filePath, audio);
      } else {
        await fs.promises.writeFile(filePath, Buffer.from(text, "utf8"));
      }

      this.emit("speech", filePath);
      return filePath;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      Logger.error("VoiceController speech synthesis error", err);
      this.emit("error", err);
      throw err;
    }
  }

  private shouldApplyEmotion() {
    return String(process.env.NPC_VOICE_EMOTION ?? "false").toLowerCase() === "true";
  }
}
