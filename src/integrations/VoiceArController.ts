import { EventEmitter } from "events";
import { randomUUID } from "crypto";

export type VoiceCommand = {
  id: string;
  text: string;
  confidence: number;
  timestamp: string;
};

export type ArGesture = {
  id: string;
  gesture: string;
  context?: string;
  timestamp: string;
};

class VoiceArBus extends EventEmitter {
  pushVoice(command: VoiceCommand) {
    this.emit("voice", command);
  }

  pushGesture(gesture: ArGesture) {
    this.emit("gesture", gesture);
  }
}

export const voiceArBus = new VoiceArBus();

export const registerVoiceListener = (listener: (command: VoiceCommand) => void) => {
  voiceArBus.on("voice", listener);
  return () => voiceArBus.off("voice", listener);
};

export const registerGestureListener = (listener: (gesture: ArGesture) => void) => {
  voiceArBus.on("gesture", listener);
  return () => voiceArBus.off("gesture", listener);
};

export const submitVoiceCommand = (command: Omit<VoiceCommand, "id" | "timestamp"> & { id?: string; timestamp?: string }) => {
  const payload: VoiceCommand = {
    id: command.id ?? randomUUID(),
    text: command.text,
    confidence: command.confidence,
    timestamp: command.timestamp ?? new Date().toISOString()
  };
  voiceArBus.pushVoice(payload);
  return payload;
};

export const submitArGesture = (gesture: Omit<ArGesture, "id" | "timestamp"> & { id?: string; timestamp?: string }) => {
  const payload: ArGesture = {
    id: gesture.id ?? randomUUID(),
    gesture: gesture.gesture,
    context: gesture.context,
    timestamp: gesture.timestamp ?? new Date().toISOString()
  };
  voiceArBus.pushGesture(payload);
  return payload;
};
