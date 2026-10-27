/**
 * SoundCraft — Zero-dependency Procedural Web Audio API sound synthesizer generator.
 *
 * Generates client-side procedural sound engines (`src/lib/sound.ts`) for games and apps.
 * Requires NO external sound files (.mp3, .wav), eliminating 404 broken asset links
 * and latency while delivering instant crisp retro/modern audio.
 */
import type { SoundFxDef } from "./SuperPrompter.js";

export class SoundCraft {
  /**
   * Generates a complete TypeScript Web Audio API sound engine module (`src/lib/sound.ts`).
   */
  static generateSoundEngine(sounds: SoundFxDef[]): string {
    const soundListJson = JSON.stringify(sounds, null, 2);

    return `/**
 * Procedural Web Audio API Sound System
 * Zero external asset dependencies — synthesized in real-time
 */

class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted: boolean = false;
  private volume: number = 0.3;

  private initCtx() {
    if (!this.ctx && typeof window !== "undefined") {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        this.ctx = new AudioCtxClass();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
  }

  /**
   * Plays a high-frequency descending laser beam or blaster shot.
   */
  laser(startFreq = 880, durationMs = 120) {
    if (this.muted) return;
    this.initCtx();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(startFreq, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(80, this.ctx.currentTime + durationMs / 1000);

      gain.gain.setValueAtTime(this.volume * 0.8, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + durationMs / 1000);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + durationMs / 1000);
    } catch {}
  }

  /**
   * Plays a deep rumbling explosion using noise / modulated frequencies.
   */
  explosion(durationMs = 400) {
    if (this.muted) return;
    this.initCtx();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(140, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + durationMs / 1000);

      gain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + durationMs / 1000);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + durationMs / 1000);
    } catch {}
  }

  /**
   * Plays an ascending positive coin or item collection chime.
   */
  coin(freq = 987, durationMs = 180) {
    if (this.muted) return;
    this.initCtx();
    if (!this.ctx) return;

    try {
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = "sine";
      osc2.type = "sine";

      osc1.frequency.setValueAtTime(freq, this.ctx.currentTime);
      osc2.frequency.setValueAtTime(freq * 1.5, this.ctx.currentTime + 0.08);

      gain.gain.setValueAtTime(this.volume * 0.7, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + durationMs / 1000);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start();
      osc2.start(this.ctx.currentTime + 0.08);

      osc1.stop(this.ctx.currentTime + durationMs / 1000);
      osc2.stop(this.ctx.currentTime + durationMs / 1000);
    } catch {}
  }

  /**
   * Plays a blunt impact or damage hit.
   */
  hit(freq = 150, durationMs = 150) {
    if (this.muted) return;
    this.initCtx();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "square";
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(50, this.ctx.currentTime + durationMs / 1000);

      gain.gain.setValueAtTime(this.volume * 0.9, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + durationMs / 1000);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + durationMs / 1000);
    } catch {}
  }

  /**
   * Plays a crisp subtle UI click.
   */
  click(freq = 600) {
    if (this.muted) return;
    this.initCtx();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

      gain.gain.setValueAtTime(this.volume * 0.4, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.04);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.04);
    } catch {}
  }

  /**
   * Generic dispatcher based on sound name or type.
   */
  play(name: string) {
    switch (name) {
      case "laser":
      case "laser_blast":
      case "laser_shot":
      case "shoot":
        this.laser();
        break;
      case "explosion":
      case "explosion_rumble":
      case "boom":
        this.explosion();
        break;
      case "coin":
      case "gem_pickup":
      case "collect":
      case "powerup":
      case "success":
        this.coin();
        break;
      case "hit":
      case "player_hit":
      case "damage":
        this.hit();
        break;
      case "click":
      case "tap":
      case "select":
      default:
        this.click();
        break;
    }
  }
}

export const sounds = new SoundEngine();
export const SOUND_DEFINITIONS = ${soundListJson};
`;
  }
}
