/**
 * This PC's screen, seen and used from the phone.
 *
 * One long-running PowerShell helper (C# compiled once with Add-Type) does the
 * Windows work: it captures the whole desktop as a scaled JPEG, and replays
 * clicks, drags, scrolls, keys and typed text with the Win32 input calls. The
 * builder talks to it a line of JSON at a time, so a frame costs a capture
 * and an encode, not a process start. It starts on the first request and
 * stops after a few idle minutes: nothing runs when nobody is watching.
 *
 * Input uses Jarvis's format (lib/jarvis/hands-core.mjs validateInput), so one
 * screen view drives this PC and the laptop alike: x and y are 0..1 of the
 * screen, keys are X11 names ("Return", "ctrl+c") mapped here to Windows keys.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import readline from "readline";

import { Logger } from "../utils/Logger.js";

export type ScreenEvent =
  | { kind: "click"; x: number; y: number; button: Button; double: boolean }
  | { kind: "move"; x: number; y: number }
  | { kind: "down" | "up"; x: number; y: number; button: Button }
  | { kind: "scroll"; x: number; y: number; dy: number; dx?: number }
  | { kind: "type"; text: string }
  | { kind: "key"; key: string }
  | { kind: "keydown" | "keyup"; key: string }
  | { kind: "release" };
type Button = "left" | "right" | "middle";

export const MAX_TEXT = 500;
const IDLE_MS = 5 * 60_000;
const COMMAND_TIMEOUT_MS = 20_000;

/** X11 key names (what Jarvis's viewer sends) to Windows virtual-key codes. */
const NAMED: Record<string, number> = {
  Return: 0x0d, BackSpace: 0x08, Tab: 0x09, Escape: 0x1b, Delete: 0x2e, Insert: 0x2d, Home: 0x24, End: 0x23,
  Page_Up: 0x21, Page_Down: 0x22, Up: 0x26, Down: 0x28, Left: 0x25, Right: 0x27, space: 0x20, Super_L: 0x5b,
  Menu: 0x5d, Print: 0x2c, minus: 0xbd, equal: 0xbb, plus: 0xbb, comma: 0xbc, period: 0xbe, slash: 0xbf,
  backslash: 0xdc, semicolon: 0xba, apostrophe: 0xde, grave: 0xc0, bracketleft: 0xdb, bracketright: 0xdd,
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, 0x70 + i]))
};
const MODS: Record<string, number> = { ctrl: 0x11, alt: 0x12, shift: 0x10, super: 0x5b };

const vkOf = (name: string): number | null => {
  if (name in MODS) return MODS[name];
  if (name in NAMED) return NAMED[name];
  if (/^[a-z]$/.test(name)) return name.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(name)) return name.charCodeAt(0);
  return null;
};

const unit = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const button = (v: unknown): Button | null => (v === undefined ? "left" : v === "left" || v === "right" || v === "middle" ? v : null);

/** One input, checked the way Jarvis checks it. */
export function validateEvent(raw: unknown): { ok: true; event: ScreenEvent } | { ok: false; error: string } {
  const e = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  switch (e.kind) {
    case "click": {
      const b = button(e.button);
      if (!unit(e.x) || !unit(e.y) || !b) return { ok: false, error: "A click needs x and y between 0 and 1." };
      return { ok: true, event: { kind: "click", x: e.x, y: e.y, button: b, double: e.double === true } };
    }
    case "move":
      if (!unit(e.x) || !unit(e.y)) return { ok: false, error: "A move needs x and y between 0 and 1." };
      return { ok: true, event: { kind: "move", x: e.x, y: e.y } };
    case "down":
    case "up": {
      const b = button(e.button);
      if (!unit(e.x) || !unit(e.y) || !b) return { ok: false, error: "A press needs x and y between 0 and 1." };
      return { ok: true, event: { kind: e.kind, x: e.x, y: e.y, button: b } };
    }
    case "scroll": {
      const dy = Math.trunc(Number(e.dy ?? 0));
      const dx = Math.trunc(Number(e.dx ?? 0));
      if (!unit(e.x) || !unit(e.y) || (dy === 0 && dx === 0) || Math.abs(dy) > 15 || Math.abs(dx) > 15) return { ok: false, error: "Scroll by 1 to 15 steps." };
      return { ok: true, event: { kind: "scroll", x: e.x, y: e.y, dy, ...(dx ? { dx } : {}) } };
    }
    case "type": {
      if (typeof e.text !== "string") return { ok: false, error: "Nothing to type." };
      // eslint-disable-next-line no-control-regex
      const text = e.text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
      if (!text || text.length > MAX_TEXT) return { ok: false, error: `Type 1 to ${MAX_TEXT} characters at a time.` };
      return { ok: true, event: { kind: "type", text } };
    }
    case "key": {
      const parts = typeof e.key === "string" && e.key.length <= 40 ? e.key.split("+") : [];
      const base = parts.pop();
      const ok = base && parts.length <= 3 && new Set(parts).size === parts.length && parts.every((m) => m in MODS) && vkOf(base) !== null;
      return ok ? { ok: true, event: { kind: "key", key: [...parts, base].join("+") } } : { ok: false, error: "That key is not on the list." };
    }
    case "keydown":
    case "keyup":
      return typeof e.key === "string" && vkOf(e.key) !== null ? { ok: true, event: { kind: e.kind, key: e.key } } : { ok: false, error: "That key is not on the list." };
    case "release":
      return { ok: true, event: { kind: "release" } };
    default:
      return { ok: false, error: "Unknown input." };
  }
}

/** The helper's own wire format: numbers and key codes, text in base64 (stdin is not UTF-8 on Windows). */
const toWire = (event: ScreenEvent): Record<string, unknown> => {
  switch (event.kind) {
    case "key":
      return { k: "chord", vks: event.key.split("+").map((part) => vkOf(part)) };
    case "keydown":
    case "keyup":
      return { k: event.kind === "keydown" ? "kd" : "ku", vk: vkOf(event.key) };
    case "type":
      return { k: "type", t64: Buffer.from(event.text, "utf8").toString("base64") };
    case "click":
      return { k: "click", x: event.x, y: event.y, b: event.button, d: event.double };
    case "down":
    case "up":
      return { k: event.kind, x: event.x, y: event.y, b: event.button };
    case "scroll":
      return { k: "scroll", x: event.x, y: event.y, dy: event.dy, dx: event.dx ?? 0 };
    default:
      return { k: event.kind, ...("x" in event ? { x: event.x, y: event.y } : {}) };
  }
};

const HELPER = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Drawing,System.Windows.Forms -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class ABScreen {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, int dx, int dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion u; }
  [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr extra; }

  static bool ready;
  static void Init() { if (!ready) { SetProcessDPIAware(); ready = true; } }
  public static Rectangle Bounds() { Init(); return SystemInformation.VirtualScreen; }

  public static string Capture(int maxWidth, long quality) {
    var b = Bounds();
    using (var full = new Bitmap(b.Width, b.Height, PixelFormat.Format24bppRgb)) {
      using (var g = Graphics.FromImage(full)) g.CopyFromScreen(b.Left, b.Top, 0, 0, b.Size, CopyPixelOperation.SourceCopy);
      int w = Math.Min(maxWidth, b.Width);
      int h = (int)Math.Round((double)b.Height * w / b.Width);
      using (var scaled = new Bitmap(w, h, PixelFormat.Format24bppRgb)) {
        using (var g2 = Graphics.FromImage(scaled)) {
          g2.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBilinear;
          g2.DrawImage(full, 0, 0, w, h);
        }
        ImageCodecInfo jpeg = null;
        foreach (var codec in ImageCodecInfo.GetImageEncoders()) if (codec.FormatID == ImageFormat.Jpeg.Guid) jpeg = codec;
        var options = new EncoderParameters(1);
        options.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
        using (var ms = new MemoryStream()) { scaled.Save(ms, jpeg, options); return Convert.ToBase64String(ms.ToArray()); }
      }
    }
  }

  static void Move(double x, double y) {
    var b = Bounds();
    SetCursorPos(b.Left + (int)Math.Round(x * (b.Width - 1)), b.Top + (int)Math.Round(y * (b.Height - 1)));
  }
  static uint Down(string button) { return button == "right" ? 0x8u : button == "middle" ? 0x20u : 0x2u; }
  static uint Up(string button) { return button == "right" ? 0x10u : button == "middle" ? 0x40u : 0x4u; }
  public static void MoveTo(double x, double y) { Move(x, y); }
  public static void Click(double x, double y, string button, bool twice) {
    Move(x, y);
    for (int i = 0; i < (twice ? 2 : 1); i++) { mouse_event(Down(button), 0, 0, 0, UIntPtr.Zero); mouse_event(Up(button), 0, 0, 0, UIntPtr.Zero); }
  }
  public static void Press(double x, double y, string button, bool down) { Move(x, y); mouse_event(down ? Down(button) : Up(button), 0, 0, 0, UIntPtr.Zero); }
  public static void Scroll(double x, double y, int dy, int dx) {
    Move(x, y);
    if (dy != 0) mouse_event(0x800, 0, 0, -dy * 120, UIntPtr.Zero);
    if (dx != 0) mouse_event(0x1000, 0, 0, dx * 120, UIntPtr.Zero);
  }
  static bool Extended(int vk) { return vk == 0x2D || vk == 0x2E || (vk >= 0x21 && vk <= 0x28) || vk == 0x5B || vk == 0x5D || vk == 0x2C; }
  public static void Key(int vk, bool down) { keybd_event((byte)vk, 0, (down ? 0u : 0x2u) | (Extended(vk) ? 0x1u : 0u), UIntPtr.Zero); }
  public static void Chord(int[] vks) {
    foreach (var vk in vks) Key(vk, true);
    for (int i = vks.Length - 1; i >= 0; i--) Key(vks[i], false);
  }
  public static void Type(string text) {
    foreach (char c in text) {
      if (c == '\n') { Chord(new int[] { 0x0D }); continue; }
      if (c == '\t') { Chord(new int[] { 0x09 }); continue; }
      var inputs = new INPUT[2];
      inputs[0].type = 1; inputs[0].u.ki = new KEYBDINPUT { wVk = 0, wScan = c, dwFlags = 0x4 };
      inputs[1].type = 1; inputs[1].u.ki = new KEYBDINPUT { wVk = 0, wScan = c, dwFlags = 0x6 };
      SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
    }
  }
  public static void Release() {
    foreach (var vk in new int[] { 0x10, 0x11, 0x12, 0x5B }) Key(vk, false);
    foreach (var flag in new uint[] { 0x4u, 0x10u, 0x40u }) mouse_event(flag, 0, 0, 0, UIntPtr.Zero);
  }
}
'@
[Console]::Out.WriteLine('{"ready":true}')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $c = $line | ConvertFrom-Json
    if ($c.op -eq 'capture') {
      $b = [ABScreen]::Bounds()
      $data = [ABScreen]::Capture([int]$c.w, [long]$c.q)
      [Console]::Out.WriteLine('{"ok":true,"w":' + $b.Width + ',"h":' + $b.Height + ',"data":"' + $data + '"}')
    } elseif ($c.op -eq 'input') {
      foreach ($e in $c.events) {
        switch ($e.k) {
          'click'  { [ABScreen]::Click([double]$e.x, [double]$e.y, [string]$e.b, [bool]$e.d) }
          'move'   { [ABScreen]::MoveTo([double]$e.x, [double]$e.y) }
          'down'   { [ABScreen]::Press([double]$e.x, [double]$e.y, [string]$e.b, $true) }
          'up'     { [ABScreen]::Press([double]$e.x, [double]$e.y, [string]$e.b, $false) }
          'scroll' { [ABScreen]::Scroll([double]$e.x, [double]$e.y, [int]$e.dy, [int]$e.dx) }
          'chord'  { [ABScreen]::Chord([int[]]$e.vks) }
          'kd'     { [ABScreen]::Key([int]$e.vk, $true) }
          'ku'     { [ABScreen]::Key([int]$e.vk, $false) }
          'type'   { [ABScreen]::Type([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$e.t64))) }
          'release' { [ABScreen]::Release() }
        }
        Start-Sleep -Milliseconds 15
      }
      [Console]::Out.WriteLine('{"ok":true}')
    } else {
      [Console]::Out.WriteLine('{"ok":false,"error":"unknown op"}')
    }
  } catch {
    $msg = ($_.Exception.Message -replace '[\r\n"\\]', ' ')
    [Console]::Out.WriteLine('{"ok":false,"error":"' + $msg + '"}')
  }
}
`;

type Pending = { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

let child: ChildProcessWithoutNullStreams | null = null;
let starting: Promise<void> | null = null;
const queue: Pending[] = [];
let chain: Promise<unknown> = Promise.resolve();
let idleTimer: NodeJS.Timeout | null = null;

const stop = (reason: string) => {
  if (!child) return;
  Logger.log("Screen helper stopped", { reason });
  child.kill();
  child = null;
  starting = null;
  while (queue.length) {
    const pending = queue.shift()!;
    clearTimeout(pending.timer);
    pending.reject(new Error(`The screen helper stopped (${reason}).`));
  }
};

const start = (): Promise<void> => {
  if (starting) return starting;
  starting = new Promise<void>((resolve, reject) => {
    const file = path.join(os.tmpdir(), `agent-builder-screen-${process.pid}.ps1`);
    fs.writeFileSync(file, HELPER, "utf8");
    const proc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file], { windowsHide: true });
    child = proc;
    let ready = false;
    const lines = readline.createInterface({ input: proc.stdout });
    lines.on("line", (line) => {
      if (!ready) {
        if (line.includes('"ready":true')) {
          ready = true;
          resolve();
        }
        return;
      }
      const pending = queue.shift();
      if (!pending) return;
      clearTimeout(pending.timer);
      try {
        pending.resolve(JSON.parse(line) as Record<string, unknown>);
      } catch {
        pending.reject(new Error("The screen helper answered something unreadable."));
      }
    });
    let stderr = "";
    proc.stderr.on("data", (chunk) => (stderr = (stderr + String(chunk)).slice(-2000)));
    proc.on("exit", (code) => {
      if (!ready) reject(new Error(`The screen helper did not start: ${stderr.trim().split("\n")[0] || `exit ${code}`}`));
      if (child === proc) stop(`exited ${code}`);
    });
    setTimeout(() => {
      if (!ready) {
        reject(new Error("The screen helper took too long to start."));
        if (child === proc) stop("start timeout");
      }
    }, 60_000).unref();
  });
  return starting;
};

/** One command to the helper, in turn. */
const send = (command: Record<string, unknown>): Promise<Record<string, unknown>> => {
  const run = async () => {
    if (process.platform !== "win32") throw new Error("Seeing the screen works on Windows only.");
    await start();
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => stop("idle"), IDLE_MS);
    idleTimer.unref();
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("The screen helper did not answer in time."));
        stop("timeout");
      }, COMMAND_TIMEOUT_MS);
      queue.push({ resolve, reject, timer });
      child!.stdin.write(`${JSON.stringify(command)}\n`);
    });
  };
  const result = chain.then(run, run);
  chain = result.catch(() => undefined);
  return result;
};

export interface Frame {
  jpeg: Buffer;
  etag: string;
  width: number;
  height: number;
}

let lastFrame: { at: number; width: number; promise: Promise<Frame> } | null = null;

export const WindowsScreen = {
  available: (): boolean => process.platform === "win32",

  /** The desktop as a JPEG at most `maxWidth` wide. Shared by callers within 250 ms. */
  capture(maxWidth = 1280, quality = 55): Promise<Frame> {
    if (lastFrame && lastFrame.width === maxWidth && Date.now() - lastFrame.at < 250) return lastFrame.promise;
    const promise = send({ op: "capture", w: Math.max(320, Math.min(2560, Math.round(maxWidth))), q: Math.max(20, Math.min(90, Math.round(quality))) }).then((answer) => {
      if (answer.ok !== true || typeof answer.data !== "string") {
        const error = String(answer.error ?? "no picture");
        // The lock screen and the UAC prompt are on a desktop no program can capture.
        throw new Error(/handle is invalid|operation completed successfully/i.test(error) ? "The PC is locked, asleep or showing a security prompt, so its screen cannot be captured." : error);
      }
      const jpeg = Buffer.from(answer.data, "base64");
      return { jpeg, etag: crypto.createHash("sha1").update(jpeg).digest("hex").slice(0, 16), width: Number(answer.w) || 0, height: Number(answer.h) || 0 };
    });
    lastFrame = { at: Date.now(), width: maxWidth, promise };
    promise.catch(() => {
      if (lastFrame?.promise === promise) lastFrame = null;
    });
    return promise;
  },

  /** Replay checked input on this PC. */
  async input(events: ScreenEvent[]): Promise<void> {
    const answer = await send({ op: "input", events: events.map(toWire) });
    if (answer.ok !== true) throw new Error(String(answer.error ?? "The input did not go through."));
  },

  stop
};
