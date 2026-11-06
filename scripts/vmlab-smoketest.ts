/**
 * Smoketest: the Virtual Test Lab, for real — QEMU in WSL boots Alpine Linux
 * (data/vmlab/isos/alpine-virt-*.iso, the official image) and the runner tests it:
 *   - a VM is created with its own disk, started, and boots a real kernel to a login prompt
 *   - the runner logs in on the serial console and runs the built-in profiles,
 *     with each step's expected and actual result, output and screenshots kept
 *   - a failure is a real one: the live ISO's root account has no password, and the security profile says so
 *   - snapshots restore the machine's state (a file made after one is gone after restoring it)
 *   - pause and resume; a screenshot shows the console; evidence is written and linked
 *   - stopped, cloned and deleted, leaving nothing behind
 *
 * Needs WSL with qemu-system-x86 and qemu-utils, and the Alpine ISO.
 *   npx tsx scripts/vmlab-smoketest.ts
 */
import fs from "fs";
import os from "os";
import path from "path";

const repo = process.cwd();
const isoDir = path.join(repo, "data", "vmlab", "isos");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vmlab-"));
process.chdir(tmp);
process.env.VMLAB_DIR = path.join(tmp, "vmlab");
process.env.VMLAB_ISO_ROOTS = isoDir;
process.env.KNOWLEDGE_DB_PATH = path.join(tmp, "knowledge.db");
process.env.SECOND_BRAIN_SYNC = "false";

const fail = (message: string): never => {
  throw new Error(message);
};

const main = async () => {
  const { VmLab } = await import("../src/lab/VmLab.js");
  const { VmTests, runOnSerial } = await import("../src/lab/VmTests.js");
  const { Evidence } = await import("../src/knowledge/Evidence.js");

  const backend = await VmLab.backend.available();
  if (!backend.ok) fail(`no VM backend: ${backend.detail}`);
  const iso = fs.readdirSync(isoDir).find((f) => /^alpine-virt-.*\.iso$/.test(f));
  if (!iso) fail(`no Alpine ISO in ${isoDir}`);
  console.log(`[info] ${backend.qemu}; ${backend.detail}`);

  // 1. A VM with its own disk.
  const vm = await VmLab.create({ name: "Alpine smoke", purpose: "smoketest", iso: path.join(isoDir, iso!), cpus: 2, memoryMb: 512, diskGb: 2, network: "isolated" });
  let refused = false;
  await VmLab.create({ name: "bad", iso: "C:/Windows/notepad.exe" }).catch(() => (refused = true));
  if (!refused) fail("a file outside the ISO folders was accepted as an ISO");
  console.log("[PASS] a VM is created with its own disk; ISOs only from the lab, builds and projects");

  try {
    // 2. Boot, log in, and the profiles.
    const started = Date.now();
    const run = await VmTests.runToEnd({ vmId: vm.id, profiles: ["boot", "login", "basics", "services", "network", "packages", "security"], agent: "smoketest", task: "smoke:vmlab" });
    const byWhat = (what: string) => run.steps.find((s) => s.what === what);
    const lines = run.steps.map((s) => `   ${s.result.padEnd(7)} [${s.profile}] ${s.what}: ${s.actual}`).join("\n");
    console.log(lines);
    if (byWhat("Reaches a login prompt")?.result !== "passed") fail(`it did not boot: ${byWhat("Reaches a login prompt")?.output.slice(-500)}`);
    if (byWhat("Log in")?.result !== "passed") fail("could not log in on the serial console");
    if (byWhat("Kernel identifies itself")?.result !== "passed" || !/Linux/.test(byWhat("Kernel identifies itself")!.output)) fail("uname did not run");
    if (byWhat("The virtual disk is seen")?.result !== "passed") fail("the virtio disk was not seen");
    if (byWhat("A package manager exists")?.result !== "passed" || !/apk/.test(byWhat("A package manager exists")!.output)) fail("apk was not found");
    console.log(`[PASS] a real kernel boots to a login prompt in ${Math.round((Date.now() - started) / 1000)} s; the runner logs in and runs the profiles (${run.counts.passed} passed)`);

    const shot = run.steps.find((s) => s.screenshot);
    if (!shot || !VmTests.file(run.id, shot.screenshot!) || !(fs.readFileSync(VmTests.file(run.id, shot.screenshot!)!).subarray(1, 4).toString() === "PNG")) fail("no screenshot kept");
    if (!fs.existsSync(path.join(process.env.VMLAB_DIR!, "runs", run.id, "serial.log"))) fail("no serial log kept");
    console.log(`[PASS] evidence: each step's expected and actual result and output, the screenshot (${shot!.actual}) and the serial log`);

    const empty = byWhat("No account lacks a password");
    if (empty?.result !== "failed" || !/NO PASSWORD: root/.test(empty.output)) fail(`the live ISO's passwordless root was not caught: ${empty?.result} ${empty?.output}`);
    if (!/No account lacks a password/.test(VmTests.failureReport(run))) fail("the failure report misses it");
    console.log("[PASS] a real defect is found: the live system's root account has no password");

    // 3. Snapshots restore state.
    await runOnSerial(vm.id, "rm -f /root/after-snapshot; echo base > /root/before", 60_000);
    await VmLab.snapshot(vm.id, "clean", "after login");
    await runOnSerial(vm.id, "echo changed > /root/after-snapshot", 60_000);
    const made = await runOnSerial(vm.id, "cat /root/after-snapshot", 60_000);
    if (!/changed/.test(made.output)) fail("the file after the snapshot was not made");
    await VmLab.restore(vm.id, "clean");
    // After loadvm the console continues from the saved moment: give it a new line.
    await VmLab.writeSerial(vm.id, "\n");
    const after = await runOnSerial(vm.id, "ls /root/; test -e /root/after-snapshot && echo STILL-THERE || echo GONE", 90_000);
    if (!/GONE/.test(after.output) || !/before/.test(after.output)) fail(`restoring the snapshot did not restore the state: ${after.output}`);
    console.log("[PASS] a snapshot restores the machine: the file made after it is gone, the one before it is there");

    // 4. Pause, resume, a screenshot, its status.
    await VmLab.pause(vm.id);
    if ((await VmLab.status(vm.id)).qemu !== "paused") fail("not paused");
    await VmLab.resume(vm.id);
    const status = await VmLab.status(vm.id);
    if (status.qemu !== "running" || !status.usage) fail(`status: ${JSON.stringify(status.usage)} ${status.qemu}`);
    const screen = await VmLab.screenshot(vm.id);
    if (screen.coverage <= 0) fail("the screen shows nothing");
    console.log(`[PASS] pause and resume; the host sees its use (${status.usage!.cpuPercent}% CPU, ${status.usage!.memoryMb} MB); the screen shows the console (${Math.round(screen.coverage * 1000) / 10}% non-background)`);

    // 5. Evidence and feedback.
    VmTests.feedback(run.id, { text: "Set a root password in the live image", kind: "defect" });
    const trace = Evidence.trace(`vmrun:${run.id}`);
    if (!trace.records.length || !trace.outgoing.some((l) => l.to === `vm:${vm.id}`) || !trace.incoming.some((l) => l.relation === "feedback-on")) fail(`evidence: ${JSON.stringify(trace)}`);
    if (!Evidence.trace(`vm:${vm.id}`).records.some((r) => /started/.test(r.title))) fail("the VM's events are not in the ledger");
    console.log("[PASS] the run, the VM's events and the feedback on it are in the evidence ledger, linked");
  } finally {
    // 6. Stopped, cloned, deleted.
    await VmLab.stop(vm.id, true).catch(() => undefined);
    if (VmLab.get(vm.id)?.state !== "stopped") fail("it did not stop");
    const copy = await VmLab.clone(vm.id, "Alpine copy");
    if (!copy.snapshots.some((s) => s.name === "clean")) fail("the clone lost the snapshot record");
    await VmLab.remove(copy.id);
    await VmLab.remove(vm.id);
    const left = await VmLab.backend.run(`ls /root/vmlab/disks/ | grep -E '${vm.id}|${copy.id}' || echo none`);
    if (!/none/.test(left.out) || VmLab.list().length) fail(`left behind: ${left.out}`);
    console.log("[PASS] stopped, cloned and deleted, leaving no disk behind");
  }
  console.log("All Virtual Test Lab checks passed.");
};

const finish = (code: number) => {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 1500).unref();
};

main()
  .then(() => finish(0))
  .catch((error) => {
    console.error("Virtual Test Lab smoketest failed:", error?.message ?? error);
    finish(1);
  });
