/**
 * Sound made in code with the Web Audio API: effects and a music loop, no files
 * and nothing to license. Browsers only allow sound after the first click or key,
 * so call unlock() from an input handler (the title screen does).
 */
type Wave = OscillatorType;

let context: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let musicTimer: ReturnType<typeof setInterval> | null = null;

export function unlock(): void {
  if (typeof AudioContext === "undefined") return;
  context ??= new AudioContext();
  if (!master) {
    master = context.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(context.destination);
  }
  void context.resume();
}

export function setMuted(value: boolean): void {
  muted = value;
  if (master) master.gain.value = muted ? 0 : 0.5;
}

export const isMuted = (): boolean => muted;

/** One note: frequency (and where it slides to), length, wave and loudness. */
export function tone(frequency: number, seconds = 0.15, wave: Wave = "square", volume = 0.25, slideTo?: number, delay = 0): void {
  if (!context || !master) return;
  const start = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(frequency, start);
  if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, start + seconds);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + seconds);
  oscillator.connect(gain).connect(master);
  oscillator.start(start);
  oscillator.stop(start + seconds);
}

/** A burst of noise, for explosions and impacts. */
export function noise(seconds = 0.25, volume = 0.3): void {
  if (!context || !master) return;
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * seconds), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  gain.gain.value = volume;
  source.connect(gain).connect(master);
  source.start();
}

export const sfx = {
  click: () => tone(660, 0.06, "square", 0.15),
  jump: () => tone(320, 0.18, "square", 0.2, 720),
  pickup: () => {
    tone(880, 0.08, "triangle", 0.25);
    tone(1320, 0.12, "triangle", 0.25, undefined, 0.08);
  },
  hit: () => {
    tone(180, 0.2, "sawtooth", 0.3, 60);
    noise(0.12, 0.2);
  },
  explode: () => {
    noise(0.45, 0.4);
    tone(120, 0.4, "sawtooth", 0.25, 40);
  },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, "triangle", 0.25, undefined, i * 0.14)),
  lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, "sawtooth", 0.2, undefined, i * 0.18))
};

/** A simple looping tune from a list of notes (0 is a rest). Give each game its own. */
export function playMusic(notes: number[], beatSeconds = 0.22, wave: Wave = "triangle", volume = 0.08): void {
  stopMusic();
  let step = 0;
  musicTimer = setInterval(() => {
    const note = notes[step++ % notes.length];
    if (note) tone(note, beatSeconds * 0.9, wave, volume);
  }, beatSeconds * 1000);
}

export function stopMusic(): void {
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = null;
}
