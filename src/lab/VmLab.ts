/**
 * VmLab — real virtual machines for testing what the agents build.
 *
 * Each VM is QEMU running an actual operating system (an ISO and/or a qcow2
 * disk), with a persistent record (data/vmlab/vms.json): its purpose, the
 * project it belongs to, its hardware, its snapshots and what happened to it.
 *
 * Backend: QEMU inside WSL2 on this PC (the PC has no QEMU of its own and
 * WSL has no /dev/kvm, so the CPU is emulated: slower than a real PC, but a
 * real kernel, real init, real userland). The backend is one object, so
 * another (QEMU with WHPX on Windows, libvirt on a Linux host) can be added
 * beside it. QEMU runs daemonized, so VMs keep running when the builder
 * restarts; on start the builder finds them again by their pid files.
 *
 * What the builder holds per running VM:
 *   control   QMP over TCP: pause, resume, reset, power off, screenshots,
 *             keys, snapshots, status
 *   serial    the VM's serial console over TCP, every byte also logged to
 *             data/vmlab/vms/<id>/serial.log (the agents' terminal; the app's
 *             terminal shows it live)
 *   screen    VNC on 127.0.0.1, bridged to the app's live console
 *
 * Isolation: QEMU runs inside WSL, not on Windows; no host folder is shared
 * into a guest; networking is none, isolated (user-mode NAT with
 * restrict=on: no way out) or internet (NAT, outbound only — WSL's own
 * loopback is not the PC's, so the builder and other services on this PC are
 * out of reach); every listener binds 127.0.0.1; RAM, CPU, VM count and
 * running time are capped; disposable VMs are deleted after their run.
 */
import { execFile } from "child_process";
import { EventEmitter } from "events";
import fs from "fs";
import net from "net";
import path from "path";

import { Evidence } from "../knowledge/Evidence.js";
import { Logger } from "../utils/Logger.js";
import { Qmp, keysFor } from "./Qmp.js";
import { readPpm, screenContent, toPng } from "./Screens.js";

export type VmState = "stopped" | "starting" | "running" | "paused" | "failed";
export type Network = "none" | "isolated" | "internet";

export interface VmEvent {
  at: string;
  event: string;
  detail: string | null;
}

export interface Vm {
  id: string;
  name: string;
  purpose: string;
  projectId: string | null;
  /** Windows path of the ISO it boots from, if any. */
  iso: string | null;
  disk: { file: string; sizeGb: number };
  cpus: number;
  memoryMb: number;
  network: Network;
  /** Extra kernel arguments are the guest's business; this boots the ISO first while the disk is empty. */
  bootFrom: "iso" | "disk";
  /** Deleted once its test run is over. */
  disposable: boolean;
  /** Stopped after this many minutes running. */
  maxRuntimeMinutes: number;
  state: VmState;
  slot: number | null;
  ports: { vnc: number; qmp: number; serial: number } | null;
  pid: number | null;
  createdAt: string;
  startedAt: string | null;
  stoppedAt: string | null;
  lastError: string | null;
  snapshots: Array<{ name: string; at: string; note: string | null }>;
  history: VmEvent[];
}

const DATA = () => path.resolve(process.env.VMLAB_DIR ?? "data/vmlab");
const STORE = () => path.join(DATA(), "vms.json");
const vmDir = (id: string) => path.join(DATA(), "vms", id);
export const ISO_DIR = () => path.join(DATA(), "isos");
const WSL_ROOT = "/root/vmlab";
const MAX_RUNNING = Number(process.env.VMLAB_MAX_RUNNING) || 3;
const MAX_TOTAL_MEMORY_MB = Number(process.env.VMLAB_MAX_MEMORY_MB) || 8192;
const MAX_CPUS = Number(process.env.VMLAB_MAX_CPUS) || 4;
const MAX_DISK_GB = Number(process.env.VMLAB_MAX_DISK_GB) || 64;
/** Folders a VM may boot an ISO from: the lab's own, and builds and projects on this PC. */
const ISO_ROOTS = () =>
  [ISO_DIR(), path.resolve("builds"), ...(process.env.VMLAB_ISO_ROOTS ?? "E:/Projects;K:/Projects").split(";")].filter(Boolean).map((p) => path.resolve(p).toLowerCase());

/* ─── the backend: QEMU in WSL ─── */

const shq = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

/** A Windows path as WSL sees it: E:\a\b → /mnt/e/a/b. */
export const toWsl = (windowsPath: string): string => {
  const full = path.resolve(windowsPath);
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(full);
  if (!match) return full.replace(/\\/g, "/");
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
};

export const Backend = {
  name: "qemu-wsl",

  run(script: string, timeoutMs = 120_000): Promise<{ ok: boolean; out: string }> {
    return new Promise((resolve) => {
      execFile("wsl.exe", ["-e", "bash", "-c", script], { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        const out = `${stdout}${stderr}`
          .split(/\r?\n/)
          .filter((line) => !/systemd user session|journalctl for more/i.test(line))
          .join("\n")
          .trim();
        resolve({ ok: !error, out });
      });
    });
  },

  /** Whether VMs can run here, and how fast. */
  async available(): Promise<{ ok: boolean; detail: string; accel: "kvm" | "tcg" | null; qemu: string | null }> {
    if (process.platform !== "win32") return { ok: false, detail: "This backend runs QEMU inside WSL on Windows.", accel: null, qemu: null };
    const probe = await Backend.run("command -v qemu-system-x86_64 >/dev/null && qemu-system-x86_64 --version | head -1; command -v qemu-img >/dev/null && echo IMG; test -e /dev/kvm && grep -qE 'svm|vmx' /proc/cpuinfo && echo KVM", 60_000);
    if (!probe.ok && !probe.out) return { ok: false, detail: "WSL does not answer (is virtualization on, and WSL installed?).", accel: null, qemu: null };
    const version = /QEMU emulator version [^\n]+/.exec(probe.out)?.[0] ?? null;
    if (!version || !/IMG/.test(probe.out)) return { ok: false, detail: `QEMU is not installed in WSL (apt-get install qemu-system-x86 qemu-utils): ${probe.out.slice(0, 200)}`, accel: null, qemu: null };
    const accel = /KVM/.test(probe.out) ? "kvm" : "tcg";
    return { ok: true, detail: accel === "kvm" ? "QEMU with KVM in WSL" : "QEMU in WSL, CPU emulated (no KVM inside WSL on this PC): real, but slower than hardware", accel, qemu: version };
  },

  diskPath: (vm: Vm) => `${WSL_ROOT}/disks/${vm.id}.qcow2`,

  async createDisk(vm: Vm): Promise<void> {
    const result = await Backend.run(`mkdir -p ${WSL_ROOT}/disks ${WSL_ROOT}/run && qemu-img create -q -f qcow2 ${shq(Backend.diskPath(vm))} ${vm.disk.sizeGb}G && echo OK`);
    if (!/OK/.test(result.out)) throw new Error(`Could not create its disk: ${result.out.slice(0, 300)}`);
  },

  async cloneDisk(from: Vm, to: Vm): Promise<void> {
    const result = await Backend.run(`qemu-img convert -O qcow2 ${shq(Backend.diskPath(from))} ${shq(Backend.diskPath(to))} && echo OK`, 30 * 60_000);
    if (!/OK/.test(result.out)) throw new Error(`Could not copy its disk: ${result.out.slice(0, 300)}`);
  },

  async deleteDisk(vm: Vm): Promise<void> {
    await Backend.run(`rm -f ${shq(Backend.diskPath(vm))} ${WSL_ROOT}/run/${vm.id}.*`);
  },

  async diskInfo(vm: Vm): Promise<{ actualMb: number; virtualGb: number } | null> {
    const result = await Backend.run(`qemu-img info --force-share --output=json ${shq(Backend.diskPath(vm))}`);
    try {
      const info = JSON.parse(result.out) as { "actual-size": number; "virtual-size": number };
      return { actualMb: Math.round(info["actual-size"] / 1048576), virtualGb: Math.round(info["virtual-size"] / 1073741824) };
    } catch {
      return null;
    }
  },

  /** Offline snapshots (the VM stopped): qemu-img on its disk. */
  async offlineSnapshot(vm: Vm, op: "create" | "apply" | "delete", name: string): Promise<void> {
    const flag = op === "create" ? "-c" : op === "apply" ? "-a" : "-d";
    const result = await Backend.run(`qemu-img snapshot ${flag} ${shq(name)} ${shq(Backend.diskPath(vm))} && echo OK`, 10 * 60_000);
    if (!/OK/.test(result.out)) throw new Error(result.out.slice(0, 300) || `snapshot ${op} failed`);
  },

  async start(vm: Vm, accel: "kvm" | "tcg"): Promise<number> {
    const ports = vm.ports!;
    const dir = vmDir(vm.id);
    fs.mkdirSync(dir, { recursive: true });
    const net =
      vm.network === "none" ? "-nic none" : `-nic user,model=virtio-net-pci${vm.network === "isolated" ? ",restrict=on" : ""}`;
    const args = [
      `-name ${shq(vm.name.replace(/,/g, " "))},process=vmlab-${vm.id}`,
      `-machine q35`,
      accel === "kvm" ? "-accel kvm -cpu host" : "-accel tcg,thread=multi -cpu max",
      `-smp ${vm.cpus}`,
      `-m ${vm.memoryMb}`,
      `-drive file=${shq(Backend.diskPath(vm))},if=virtio,format=qcow2,cache=writeback`,
      vm.iso ? `-drive file=${shq(toWsl(vm.iso))},media=cdrom,readonly=on` : "",
      `-boot order=${vm.bootFrom === "iso" && vm.iso ? "dc" : "cd"},menu=off`,
      net,
      "-vga std -display none",
      `-vnc 127.0.0.1:${ports.vnc - 5900}`,
      "-usb -device usb-tablet",
      "-audiodev none,id=snd0 -device intel-hda -device hda-duplex,audiodev=snd0",
      `-qmp tcp:127.0.0.1:${ports.qmp},server=on,wait=off`,
      `-chardev socket,id=ser0,host=127.0.0.1,port=${ports.serial},server=on,wait=off,logfile=${shq(toWsl(path.join(dir, "serial.log")))},logappend=on`,
      "-serial chardev:ser0",
      `-pidfile ${WSL_ROOT}/run/${vm.id}.pid`,
      `-D ${WSL_ROOT}/run/${vm.id}.qemu.log`,
      "-daemonize"
    ].filter(Boolean);
    const result = await Backend.run(`mkdir -p ${WSL_ROOT}/run && qemu-system-x86_64 ${args.join(" ")} && cat ${WSL_ROOT}/run/${vm.id}.pid`, 120_000);
    const pid = Number(/(\d+)\s*$/.exec(result.out)?.[1]);
    if (!result.ok || !pid) throw new Error(`QEMU did not start: ${result.out.slice(-600)}`);
    return pid;
  },

  async alive(pid: number): Promise<boolean> {
    const result = await Backend.run(`kill -0 ${pid} 2>/dev/null && echo ALIVE`, 30_000);
    return /ALIVE/.test(result.out);
  },

  async kill(pid: number): Promise<void> {
    await Backend.run(`kill ${pid} 2>/dev/null; sleep 1; kill -9 ${pid} 2>/dev/null; true`, 30_000);
  },

  /** CPU and memory the VM's QEMU uses on the host. */
  async usage(pid: number): Promise<{ cpuPercent: number; memoryMb: number } | null> {
    const result = await Backend.run(`ps -o %cpu=,rss= -p ${pid}`, 20_000);
    const match = /([\d.]+)\s+(\d+)/.exec(result.out);
    return match ? { cpuPercent: Number(match[1]), memoryMb: Math.round(Number(match[2]) / 1024) } : null;
  }
};

/* ─── records ─── */

const read = (): Vm[] => {
  try {
    return JSON.parse(fs.readFileSync(STORE(), "utf8")) as Vm[];
  } catch {
    return [];
  }
};
const write = (vms: Vm[]) => {
  fs.mkdirSync(DATA(), { recursive: true });
  const temp = `${STORE()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(vms, null, 2));
  fs.renameSync(temp, STORE());
};
const get = (id: string) => read().find((vm) => vm.id === id) ?? null;
const patch = (id: string, changes: Partial<Vm>) => {
  const vms = read();
  const vm = vms.find((v) => v.id === id);
  if (!vm) return null;
  Object.assign(vm, changes);
  write(vms);
  return vm;
};
const remember = (id: string, event: string, detail: string | null = null) => {
  const vms = read();
  const vm = vms.find((v) => v.id === id);
  if (!vm) return;
  vm.history = [...vm.history, { at: new Date().toISOString(), event, detail }].slice(-200);
  write(vms);
  Evidence.record({ kind: "vm-event", ref: `vm:${id}`, task: vm.projectId ? `project:${vm.projectId}` : `vm:${id}`, title: `${vm.name}: ${event}`, outcome: event, data: detail ? { detail } : null });
};

/* ─── live connections ─── */

interface Live {
  qmp: Qmp;
  serial: net.Socket | null;
  serialListeners: Set<(chunk: Buffer) => void>;
}
const live = new Map<string, Live>();
export const labEvents = new EventEmitter();

const portFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(true));
    socket.setTimeout(800, () => {
      socket.destroy();
      resolve(true);
    });
  });

const portsFor = (slot: number) => ({ vnc: 5960 + slot, qmp: 47100 + slot, serial: 47200 + slot });

const freeSlot = async (): Promise<number> => {
  const taken = new Set(read().filter((v) => v.state !== "stopped" && v.state !== "failed" && v.slot !== null).map((v) => v.slot));
  for (let slot = 0; slot < 32; slot++) {
    if (taken.has(slot)) continue;
    const ports = portsFor(slot);
    if ((await portFree(ports.vnc)) && (await portFree(ports.qmp)) && (await portFree(ports.serial))) return slot;
  }
  throw new Error("No free ports for another VM.");
};

const connectSerial = (vm: Vm, holder: Live) => {
  if (!vm.ports) return;
  const socket = net.connect(vm.ports.serial, "127.0.0.1");
  socket.on("data", (chunk: Buffer) => {
    for (const listener of holder.serialListeners) listener(chunk);
  });
  socket.on("error", () => undefined);
  socket.on("close", () => {
    if (holder.serial === socket) holder.serial = null;
    // Still running: the serial console comes back.
    setTimeout(() => {
      const current = get(vm.id);
      if (live.get(vm.id) === holder && current && (current.state === "running" || current.state === "paused") && !holder.serial) connectSerial(current, holder);
    }, 2000);
  });
  holder.serial = socket;
};

const attach = async (vm: Vm): Promise<Live> => {
  const existing = live.get(vm.id);
  if (existing?.qmp.connected) return existing;
  const qmp = new Qmp(vm.ports!.qmp);
  await qmp.connect();
  const holder: Live = { qmp, serial: null, serialListeners: new Set() };
  qmp.on("event", (message: { event: string; data?: unknown }) => {
    if (message.event === "SHUTDOWN") {
      void markStopped(vm.id, "The guest shut down");
    } else if (message.event === "STOP") patch(vm.id, { state: "paused" });
    else if (message.event === "RESUME") patch(vm.id, { state: "running" });
    labEvents.emit("vm", { id: vm.id, event: message.event });
  });
  qmp.on("close", () => {
    if (live.get(vm.id) === holder) {
      live.delete(vm.id);
      void (async () => {
        const current = get(vm.id);
        if (current?.pid && !(await Backend.alive(current.pid))) await markStopped(vm.id, "QEMU exited");
      })();
    }
  });
  connectSerial(vm, holder);
  live.set(vm.id, holder);
  return holder;
};

const markStopped = async (id: string, why: string) => {
  const holder = live.get(id);
  live.delete(id);
  holder?.serial?.destroy();
  holder?.qmp.close();
  const vm = get(id);
  if (!vm || vm.state === "stopped") return;
  patch(id, { state: "stopped", pid: null, ports: null, slot: null, stoppedAt: new Date().toISOString() });
  remember(id, "stopped", why);
  labEvents.emit("vm", { id, event: "stopped" });
};

const isoAllowed = (iso: string): boolean => {
  const full = path.resolve(iso).toLowerCase();
  return /\.(iso|img)$/i.test(full) && ISO_ROOTS().some((root) => full === root || full.startsWith(root.endsWith(path.sep) ? root : root + path.sep));
};

const newId = () => `vm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/* ─── the API ─── */

export interface CreateVm {
  name: string;
  purpose?: string;
  projectId?: string | null;
  iso?: string | null;
  diskGb?: number;
  cpus?: number;
  memoryMb?: number;
  network?: Network;
  bootFrom?: "iso" | "disk";
  disposable?: boolean;
  maxRuntimeMinutes?: number;
}

export const VmLab = {
  backend: Backend,

  list(): Vm[] {
    return read();
  },

  get,

  /** The ISOs in the lab's folder. */
  isos(): Array<{ name: string; path: string; sizeMb: number; modifiedAt: string }> {
    fs.mkdirSync(ISO_DIR(), { recursive: true });
    return fs
      .readdirSync(ISO_DIR())
      .filter((f) => /\.(iso|img)$/i.test(f))
      .map((name) => {
        const stat = fs.statSync(path.join(ISO_DIR(), name));
        return { name, path: path.join(ISO_DIR(), name), sizeMb: Math.round(stat.size / 1048576), modifiedAt: stat.mtime.toISOString() };
      });
  },

  /** Download an ISO (https only) into the lab, checked against its SHA-256 when given. */
  async downloadIso(url: string, sha256?: string): Promise<{ name: string; path: string }> {
    const address = new URL(url);
    if (address.protocol !== "https:") throw new Error("Give an https address.");
    const name = path.basename(address.pathname).replace(/[^A-Za-z0-9._-]+/g, "-");
    if (!/\.(iso|img)$/i.test(name)) throw new Error("The address must end in .iso or .img.");
    const target = path.join(ISO_DIR(), name);
    fs.mkdirSync(ISO_DIR(), { recursive: true });
    const result = await Backend.run(
      `curl -fsSL --max-filesize 8000000000 -o ${shq(toWsl(target))}.part ${shq(address.href)} && ${sha256 ? `echo ${shq(`${sha256.toLowerCase()}  ${toWsl(target)}.part`)} | sha256sum -c - >/dev/null && ` : ""}mv ${shq(toWsl(target))}.part ${shq(toWsl(target))} && echo DONE`,
      3 * 3_600_000
    );
    if (!/DONE/.test(result.out)) {
      fs.rmSync(`${target}.part`, { force: true });
      throw new Error(`The download did not finish${sha256 ? " or its checksum did not match" : ""}: ${result.out.slice(-300)}`);
    }
    return { name, path: target };
  },

  async create(input: CreateVm): Promise<Vm> {
    const name = String(input.name ?? "").trim().slice(0, 60);
    if (!name) throw new Error("Name the VM.");
    const iso = input.iso ? path.resolve(input.iso) : null;
    if (iso && (!isoAllowed(iso) || !fs.existsSync(iso))) throw new Error("That ISO is not in the lab's folder, a build or a project (or it is not there).");
    const vm: Vm = {
      id: newId(),
      name,
      purpose: String(input.purpose ?? "").slice(0, 300),
      projectId: input.projectId ?? null,
      iso,
      disk: { file: "", sizeGb: clamp(input.diskGb, 1, MAX_DISK_GB, 8) },
      cpus: clamp(input.cpus, 1, MAX_CPUS, 2),
      memoryMb: clamp(input.memoryMb, 128, MAX_TOTAL_MEMORY_MB, 1024),
      network: input.network === "none" || input.network === "internet" ? input.network : "isolated",
      bootFrom: input.bootFrom === "disk" || !iso ? "disk" : "iso",
      disposable: Boolean(input.disposable),
      maxRuntimeMinutes: clamp(input.maxRuntimeMinutes, 5, 24 * 60, 8 * 60),
      state: "stopped",
      slot: null,
      ports: null,
      pid: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      stoppedAt: null,
      lastError: null,
      snapshots: [],
      history: []
    };
    vm.disk.file = Backend.diskPath(vm);
    await Backend.createDisk(vm);
    write([...read(), vm]);
    remember(vm.id, "created", `${vm.cpus} CPU, ${vm.memoryMb} MB, ${vm.disk.sizeGb} GB disk, network ${vm.network}${iso ? `, ISO ${path.basename(iso)}` : ""}`);
    return get(vm.id)!;
  },

  async update(id: string, changes: Partial<Pick<Vm, "name" | "purpose" | "cpus" | "memoryMb" | "network" | "bootFrom" | "iso" | "maxRuntimeMinutes">>): Promise<Vm> {
    const vm = get(id);
    if (!vm) throw new Error("Unknown VM.");
    if (vm.state !== "stopped" && vm.state !== "failed") throw new Error("Stop it before changing its hardware.");
    const next: Partial<Vm> = {};
    if (changes.name) next.name = String(changes.name).slice(0, 60);
    if (changes.purpose !== undefined) next.purpose = String(changes.purpose).slice(0, 300);
    if (changes.cpus !== undefined) next.cpus = clamp(changes.cpus, 1, MAX_CPUS, vm.cpus);
    if (changes.memoryMb !== undefined) next.memoryMb = clamp(changes.memoryMb, 128, MAX_TOTAL_MEMORY_MB, vm.memoryMb);
    if (changes.network) next.network = changes.network === "none" || changes.network === "internet" ? changes.network : "isolated";
    if (changes.bootFrom) next.bootFrom = changes.bootFrom === "disk" ? "disk" : "iso";
    if (changes.maxRuntimeMinutes !== undefined) next.maxRuntimeMinutes = clamp(changes.maxRuntimeMinutes, 5, 24 * 60, vm.maxRuntimeMinutes);
    if (changes.iso !== undefined) {
      const iso = changes.iso ? path.resolve(changes.iso) : null;
      if (iso && (!isoAllowed(iso) || !fs.existsSync(iso))) throw new Error("That ISO is not allowed or not there.");
      next.iso = iso;
    }
    patch(id, next);
    remember(id, "configured", JSON.stringify(next));
    return get(id)!;
  },

  async start(id: string): Promise<Vm> {
    const vm = get(id);
    if (!vm) throw new Error("Unknown VM.");
    if (vm.state === "running" || vm.state === "starting") return vm;
    if (vm.state === "paused") return VmLab.resume(id);
    const running = read().filter((v) => v.state === "running" || v.state === "paused" || v.state === "starting");
    if (running.length >= MAX_RUNNING) throw new Error(`${running.length} VMs are already running (the limit is ${MAX_RUNNING}). Stop one first.`);
    const memory = running.reduce((sum, v) => sum + v.memoryMb, 0);
    if (memory + vm.memoryMb > MAX_TOTAL_MEMORY_MB) throw new Error(`Not enough of the lab's memory left: ${MAX_TOTAL_MEMORY_MB - memory} MB of ${MAX_TOTAL_MEMORY_MB} MB.`);
    const backend = await Backend.available();
    if (!backend.ok) throw new Error(backend.detail);
    const slot = await freeSlot();
    patch(id, { state: "starting", slot, ports: portsFor(slot), lastError: null });
    try {
      const pid = await Backend.start(get(id)!, backend.accel ?? "tcg");
      patch(id, { pid, state: "running", startedAt: new Date().toISOString(), stoppedAt: null });
      await attach(get(id)!);
      remember(id, "started", `${backend.accel === "kvm" ? "KVM" : "emulated CPU"}, display :${portsFor(slot).vnc - 5900}`);
      labEvents.emit("vm", { id, event: "started" });
      return get(id)!;
    } catch (error) {
      const message = (error as Error).message;
      patch(id, { state: "failed", lastError: message, slot: null, ports: null, pid: null });
      remember(id, "failed to start", message);
      throw error;
    }
  },

  async stop(id: string, force = false): Promise<Vm> {
    const vm = get(id);
    if (!vm) throw new Error("Unknown VM.");
    if (vm.state === "stopped") return vm;
    const holder = live.get(id) ?? (vm.ports ? await attach(vm).catch(() => null) : null);
    if (!force && holder) {
      // Ask the guest to power off; pull the plug if it does not within 20 s.
      await holder.qmp.command("system_powerdown").catch(() => undefined);
      for (let i = 0; i < 20 && get(id)?.state !== "stopped"; i++) await new Promise((r) => setTimeout(r, 1000));
      if (get(id)?.state === "stopped") return get(id)!;
    }
    await holder?.qmp.command("quit").catch(() => undefined);
    if (vm.pid) await Backend.kill(vm.pid);
    await markStopped(id, force ? "Stopped (forced)" : "Stopped");
    return get(id)!;
  },

  async pause(id: string): Promise<Vm> {
    const holder = await VmLab.control(id);
    await holder.qmp.command("stop");
    patch(id, { state: "paused" });
    remember(id, "paused");
    return get(id)!;
  },

  async restart(id: string): Promise<Vm> {
    const holder = await VmLab.control(id);
    await holder.qmp.command("system_reset");
    remember(id, "restarted");
    return get(id)!;
  },

  async remove(id: string): Promise<void> {
    const vm = get(id);
    if (!vm) return;
    if (vm.state !== "stopped" && vm.state !== "failed") await VmLab.stop(id, true);
    await Backend.deleteDisk(vm);
    write(read().filter((v) => v.id !== id));
    Evidence.record({ kind: "vm-event", ref: `vm:${id}`, task: vm.projectId ? `project:${vm.projectId}` : `vm:${id}`, title: `${vm.name}: deleted`, outcome: "deleted" });
    fs.rmSync(vmDir(id), { recursive: true, force: true });
  },

  async clone(id: string, name?: string): Promise<Vm> {
    const from = get(id);
    if (!from) throw new Error("Unknown VM.");
    if (from.state !== "stopped" && from.state !== "failed") throw new Error("Stop it before cloning it.");
    const copy: Vm = { ...from, id: newId(), name: (name ?? `${from.name} (copy)`).slice(0, 60), state: "stopped", slot: null, ports: null, pid: null, createdAt: new Date().toISOString(), startedAt: null, stoppedAt: null, lastError: null, history: [], disposable: false };
    copy.disk = { ...from.disk, file: Backend.diskPath(copy) };
    await Backend.cloneDisk(from, copy);
    write([...read(), copy]);
    remember(copy.id, "cloned", `from ${from.name}`);
    return get(copy.id)!;
  },

  /** The live control connection of a running VM. */
  async control(id: string): Promise<Live> {
    const vm = get(id);
    if (!vm) throw new Error("Unknown VM.");
    if (vm.state !== "running" && vm.state !== "paused") throw new Error("It is not running.");
    return attach(vm);
  },

  /* snapshots: live (RAM and disk, savevm) while running; disk only while stopped */
  async snapshot(id: string, name: string, note: string | null = null): Promise<Vm> {
    const vm = get(id);
    if (!vm) throw new Error("Unknown VM.");
    const clean = name.trim().replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 40);
    if (!clean) throw new Error("Name the snapshot.");
    if (vm.state === "running" || vm.state === "paused") {
      const out = await (await VmLab.control(id)).qmp.hmp(`savevm ${clean}`, 10 * 60_000);
      if (/error/i.test(out)) throw new Error(out.trim());
    } else await Backend.offlineSnapshot(vm, "create", clean);
    patch(id, { snapshots: [...vm.snapshots.filter((s) => s.name !== clean), { name: clean, at: new Date().toISOString(), note }] });
    remember(id, "snapshot taken", clean);
    return get(id)!;
  },

  async restore(id: string, name: string): Promise<Vm> {
    const vm = get(id);
    if (!vm) throw new Error("Unknown VM.");
    if (!vm.snapshots.some((s) => s.name === name)) throw new Error("No such snapshot.");
    if (vm.state === "running" || vm.state === "paused") {
      const out = await (await VmLab.control(id)).qmp.hmp(`loadvm ${name}`, 10 * 60_000);
      if (/error/i.test(out)) throw new Error(out.trim());
    } else await Backend.offlineSnapshot(vm, "apply", name);
    remember(id, "snapshot restored", name);
    return get(id)!;
  },

  async deleteSnapshot(id: string, name: string): Promise<Vm> {
    const vm = get(id);
    if (!vm) throw new Error("Unknown VM.");
    if (vm.state === "running" || vm.state === "paused") await (await VmLab.control(id)).qmp.hmp(`delvm ${name}`);
    else await Backend.offlineSnapshot(vm, "delete", name);
    patch(id, { snapshots: vm.snapshots.filter((s) => s.name !== name) });
    remember(id, "snapshot deleted", name);
    return get(id)!;
  },

  /* the screen */
  async screenshot(id: string, folder?: string): Promise<{ file: string; png: Buffer; coverage: number; colours: number; width: number; height: number }> {
    const holder = await VmLab.control(id);
    const dir = folder ?? path.join(vmDir(id), "screens");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = Date.now();
    const ppm = path.join(dir, `${stamp}.ppm`);
    await holder.qmp.command("screendump", { filename: toWsl(ppm) });
    // The file is written through WSL's view of this disk: wait for it to land.
    for (let i = 0; i < 50 && !(fs.existsSync(ppm) && fs.statSync(ppm).size > 100); i++) await new Promise((r) => setTimeout(r, 100));
    const picture = readPpm(fs.readFileSync(ppm));
    const png = toPng(picture);
    const file = path.join(dir, `${stamp}.png`);
    fs.writeFileSync(file, png);
    fs.rmSync(ppm, { force: true });
    const content = screenContent(picture);
    return { file, png, ...content, width: picture.width, height: picture.height };
  },

  async sendKeys(id: string, combos: string[][]): Promise<void> {
    const holder = await VmLab.control(id);
    for (const keys of combos) {
      await holder.qmp.command("send-key", { keys: keys.map((k) => ({ type: "qcode", data: k })) });
      await new Promise((r) => setTimeout(r, 30));
    }
  },

  async typeText(id: string, text: string): Promise<void> {
    await VmLab.sendKeys(id, keysFor(text));
  },

  /** Mouse on the screen (absolute, 0..1 of width and height), optionally clicking. */
  async mouse(id: string, x: number, y: number, click: "left" | "right" | null = null): Promise<void> {
    const holder = await VmLab.control(id);
    const scale = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 0x7fff);
    await holder.qmp.command("input-send-event", {
      events: [
        { type: "abs", data: { axis: "x", value: scale(x) } },
        { type: "abs", data: { axis: "y", value: scale(y) } }
      ]
    });
    if (click) {
      await holder.qmp.command("input-send-event", { events: [{ type: "btn", data: { down: true, button: click } }] });
      await holder.qmp.command("input-send-event", { events: [{ type: "btn", data: { down: false, button: click } }] });
    }
  },

  /* the serial console */
  serialLogFile: (id: string) => path.join(vmDir(id), "serial.log"),

  serialLog(id: string, fromByte = 0, maxBytes = 256 * 1024): { text: string; size: number } {
    const file = VmLab.serialLogFile(id);
    if (!fs.existsSync(file)) return { text: "", size: 0 };
    const size = fs.statSync(file).size;
    const start = Math.max(fromByte, size - maxBytes);
    if (start >= size) return { text: "", size };
    const fd = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(size - start);
      fs.readSync(fd, buffer, 0, buffer.length, start);
      return { text: buffer.toString("utf8"), size };
    } finally {
      fs.closeSync(fd);
    }
  },

  async writeSerial(id: string, data: string | Buffer): Promise<void> {
    const holder = await VmLab.control(id);
    for (let i = 0; i < 30 && !holder.serial; i++) await new Promise((r) => setTimeout(r, 200));
    if (!holder.serial) throw new Error("The VM's serial console is not connected.");
    holder.serial.write(data);
  },

  /** Live serial output, for the app's terminal. Returns an unsubscribe. */
  async onSerial(id: string, listener: (chunk: Buffer) => void): Promise<() => void> {
    const holder = await VmLab.control(id);
    holder.serialListeners.add(listener);
    return () => holder.serialListeners.delete(listener);
  },

  async status(id: string): Promise<{ vm: Vm; usage: { cpuPercent: number; memoryMb: number } | null; disk: { actualMb: number; virtualGb: number } | null; qemu: string | null }> {
    const vm = get(id);
    if (!vm) throw new Error("Unknown VM.");
    const usage = vm.pid ? await Backend.usage(vm.pid) : null;
    const disk = await Backend.diskInfo(vm);
    let qemu: string | null = null;
    if (live.get(id)?.qmp.connected) qemu = String(((await live.get(id)!.qmp.command<{ status: string }>("query-status").catch(() => null)) ?? { status: "" }).status || "");
    return { vm, usage, disk, qemu };
  },

  async resume(id: string): Promise<Vm> {
    const holder = await VmLab.control(id);
    await holder.qmp.command("cont");
    patch(id, { state: "running" });
    remember(id, "resumed");
    return get(id)!;
  },

  /** After the builder restarts: VMs still running are found again; gone ones are marked stopped. */
  async reconnectAll(): Promise<void> {
    for (const vm of read().filter((v) => v.state === "running" || v.state === "paused" || v.state === "starting")) {
      if (vm.pid && (await Backend.alive(vm.pid))) {
        await attach(vm).catch((error) => Logger.warn("VmLab: could not reconnect to a running VM", { vm: vm.id, error: (error as Error).message }));
      } else await markStopped(vm.id, "Not running after the builder restarted");
    }
  },

  /** Stop every VM now (the emergency stop). */
  async stopAll(): Promise<number> {
    const running = read().filter((v) => v.state !== "stopped");
    for (const vm of running) await VmLab.stop(vm.id, true).catch(() => undefined);
    return running.length;
  },

  /** VMs past their running time are stopped; disposable ones left over are deleted. */
  async sweep(): Promise<void> {
    for (const vm of read()) {
      if ((vm.state === "running" || vm.state === "paused") && vm.startedAt && Date.now() - Date.parse(vm.startedAt) > vm.maxRuntimeMinutes * 60_000) {
        await VmLab.stop(vm.id, true).catch(() => undefined);
        remember(vm.id, "stopped: ran past its time limit", `${vm.maxRuntimeMinutes} min`);
      }
      if (vm.disposable && vm.state === "stopped" && vm.stoppedAt && Date.now() - Date.parse(vm.stoppedAt) > 30 * 60_000) await VmLab.remove(vm.id).catch(() => undefined);
    }
  },

  limits: () => ({ maxRunning: MAX_RUNNING, maxMemoryMb: MAX_TOTAL_MEMORY_MB, maxCpus: MAX_CPUS, maxDiskGb: MAX_DISK_GB })
};
