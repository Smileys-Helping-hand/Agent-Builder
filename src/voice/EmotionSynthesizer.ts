import { Logger } from "../utils/Logger.js";

export type EmotionTone = "neutral" | "happy" | "curious" | "angry" | "sad" | "fearful" | "excited" | "tired";

export type EmotionProfile = {
  style?: string;
  rate?: string;
  volume?: string;
};

const EMOTION_PRESETS: Record<EmotionTone, EmotionProfile> = {
  neutral: { rate: "0%", volume: "+0dB" },
  happy: { style: "cheerful", rate: "+12%", volume: "+2dB" },
  curious: { style: "chat", rate: "+6%", volume: "+1dB" },
  angry: { style: "angry", rate: "+4%", volume: "+4dB" },
  sad: { style: "sad", rate: "-8%", volume: "-2dB" },
  fearful: { style: "fearful", rate: "+2%", volume: "-1dB" },
  excited: { style: "excited", rate: "+18%", volume: "+3dB" },
  tired: { style: "empathetic", rate: "-12%", volume: "-3dB" }
};

export class EmotionSynthesizer {
  private static instance: EmotionSynthesizer | null = null;

  static getInstance() {
    if (!this.instance) {
      this.instance = new EmotionSynthesizer();
    }
    return this.instance;
  }

  private constructor() {}

  resolve(emotion?: string): EmotionTone {
    if (!emotion) return "neutral";
    const key = emotion.toLowerCase() as EmotionTone;
    if (key in EMOTION_PRESETS) {
      return key;
    }
    Logger.warn("EmotionSynthesizer received unknown emotion", { emotion });
    return "neutral";
  }

  applyEmotion(baseProfile: { voice: string; style?: string; rate?: string; volume?: string }, emotion?: string) {
    const tone = this.resolve(emotion);
    const preset = EMOTION_PRESETS[tone];
    return {
      voice: baseProfile.voice,
      style: preset.style ?? baseProfile.style,
      rate: preset.rate ?? baseProfile.rate,
      volume: preset.volume ?? baseProfile.volume,
      emotion: tone
    };
  }
}
