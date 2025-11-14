/// <reference types="node" />

declare module "whisper-tts" {
  export function transcribe(audio: Buffer, options?: { model?: string }): Promise<{
    text: string;
    confidence: number;
  }>;
}

declare module "edge-tts" {
  export function speak(text: string, options?: Record<string, unknown>): Promise<Buffer>;
}
