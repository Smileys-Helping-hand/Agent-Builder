"use client";

/**
 * Virtual Test Lab: real virtual machines (QEMU) that boot what the agents
 * build. Create a VM from an ISO, open its live screen and terminal, and run
 * test profiles on it; every run keeps each step's expected and actual result,
 * output, screenshots and the serial log.
 */
import { useEffect, useState } from "react";

import { api, onMachine, type LabRunSummary, type LabTestRun, type LabVm } from "@/lib/api";
import { Banner, Busy, Header, Icon, NotConnected, Skeleton, ago, useConnected, useRemote, useToast } from "../ui";
import VmConsole from "./VmConsole";

type Act = (label: string, fn: () => Promise<unknown>, ok: string) => Promise<void>;

const stateTag = (state: string) => (state === "running" || state === "passed" ? "ok" : state === "failed" || state === "error" ? "bad" : state === "stopped" ? "" : "warn");

function CreateVm({ isos, busy, act }: { isos: Array<{ name: string; path: string; sizeMb: number }>; busy: string | null; act: Act }) {
  const [name, setName] = useState("");
  const [iso, setIso] = useState("");
  const [customIso, setCustomIso] = useState("");
  const [cpus, setCpus] = useState(2);
  const [memoryMb, setMemory] = useState(2048);
  const [diskGb, setDisk] = useState(16);
  const [network, setNetwork] = useState<"none" | "isolated" | "internet">("isolated");
  const [url, setUrl] = useState("");
  const [sha, setSha] = useState("");
  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>New virtual machine</div>
      <div className="learn-plan" style={{ flexWrap: "wrap" }}>
        <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="input" style={{ flex: 1, minWidth: 180 }} value={iso} onChange={(e) => setIso(e.target.value)} aria-label="ISO">
          <option value="">Boot from… (no ISO)</option>
          {isos.map((i) => (
            <option key={i.path} value={i.path}>
              {i.name} ({i.sizeMb} MB)
            </option>
          ))}
          <option value="__path">A build's ISO, by path…</option>
        </select>
      </div>
      {iso === "__path" ? <input className="input" style={{ marginTop: 8, width: "100%" }} placeholder="E:\Projects\NexusOS\os\out\nexusos.iso" value={customIso} onChange={(e) => setCustomIso(e.target.value)} /> : null}
      <div className="learn-plan" style={{ marginTop: 8, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
        <label>
          CPUs <input className="input" style={{ width: 60 }} type="number" min={1} max={4} value={cpus} onChange={(e) => setCpus(Number(e.target.value))} />
        </label>
        <label>
          Memory (MB) <input className="input" style={{ width: 90 }} type="number" min={128} step={256} value={memoryMb} onChange={(e) => setMemory(Number(e.target.value))} />
        </label>
        <label>
          Disk (GB) <input className="input" style={{ width: 70 }} type="number" min={1} max={64} value={diskGb} onChange={(e) => setDisk(Number(e.target.value))} />
        </label>
        <select className="input" value={network} onChange={(e) => setNetwork(e.target.value as typeof network)} aria-label="Network">
          <option value="isolated">Network: isolated (no way out)</option>
          <option value="internet">Network: internet (outbound only)</option>
          <option value="none">Network: none</option>
        </select>
        <button
          className="btn primary"
          style={{ marginLeft: "auto" }}
          disabled={busy !== null || !name.trim()}
          onClick={() =>
            void act(
              "create",
              async () => {
                await api.labCreateVm({ name: name.trim(), iso: iso === "__path" ? customIso.trim() || null : iso || null, cpus, memoryMb, diskGb, network });
                setName("");
              },
              "Created."
            )
          }
        >
          {busy === "create" ? <Busy label="Creating…" /> : "Create VM"}
        </button>
      </div>
      <details style={{ marginTop: 10 }}>
        <summary className="small" style={{ cursor: "pointer" }}>Download an ISO into the lab</summary>
        <div className="learn-plan" style={{ marginTop: 8, flexWrap: "wrap" }}>
          <input className="input" style={{ flex: 2, minWidth: 220 }} placeholder="https://…/linux.iso" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="SHA-256 (recommended)" value={sha} onChange={(e) => setSha(e.target.value)} />
          <button className="btn small" disabled={busy !== null || !url.trim()} onClick={() => void act("iso", () => api.labDownloadIso(url.trim(), sha.trim() || undefined).then(() => setUrl("")), "Downloading; it appears in the list when it is done.")}>
            Download
          </button>
        </div>
      </details>
    </div>
  );
}

function VmCard({ vm, profiles, full, busy, act, onOpenRun }: { vm: LabVm; profiles: Array<{ id: string; name: string; about: string }>; full: string[]; busy: string | null; act: Act; onOpenRun: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>(full);
  const [user, setUser] = useState("root");
  const [password, setPassword] = useState("");
  const [snap, setSnap] = useState("");
  const running = vm.state === "running" || vm.state === "paused";
  const b = (what: string) => busy === `${what}:${vm.id}`;
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <strong>{vm.name}</strong> <span className={`tag ${stateTag(vm.state)}`}>{vm.state}</span>
          <div className="small muted">
            {vm.cpus} CPU · {vm.memoryMb} MB · {vm.disk.sizeGb} GB disk · network {vm.network}
            {vm.iso ? ` · ${vm.iso.split(/[\\/]/).pop()}` : " · boots its disk"}
            {vm.startedAt && running ? ` · up since ${ago(vm.startedAt)}` : ""}
          </div>
          {vm.lastError ? <div className="small" style={{ color: "var(--bad, #f87171)" }}>{vm.lastError.slice(0, 300)}</div> : null}
        </div>
        <div className="btn-row">
          {!running ? (
            <button className="btn small primary" disabled={busy !== null} onClick={() => void act(`start:${vm.id}`, () => api.labVmAction(vm.id, "start"), "Started.")}>
              {b("start") ? <Busy label="Starting…" /> : <>{Icon.play} Start</>}
            </button>
          ) : (
            <>
              <button className="btn small primary" onClick={() => setOpen((v) => !v)}>
                {open ? "Close console" : "Open console"}
              </button>
              {vm.state === "paused" ? (
                <button className="btn small" disabled={busy !== null} onClick={() => void act(`resume:${vm.id}`, () => api.labVmAction(vm.id, "resume"), "Resumed.")}>Resume</button>
              ) : (
                <button className="btn small" disabled={busy !== null} onClick={() => void act(`pause:${vm.id}`, () => api.labVmAction(vm.id, "pause"), "Paused.")}>Pause</button>
              )}
              <button className="btn small" disabled={busy !== null} onClick={() => void act(`restart:${vm.id}`, () => api.labVmAction(vm.id, "restart"), "Restarted.")}>Restart</button>
              <button className="btn small" disabled={busy !== null} onClick={() => void act(`stop:${vm.id}`, () => api.labVmAction(vm.id, "stop"), "Stopped.")}>
                {b("stop") ? <Busy label="Stopping…" /> : "Stop"}
              </button>
            </>
          )}
          {!running ? (
            <>
              <button className="btn small ghost" disabled={busy !== null} onClick={() => void act(`clone:${vm.id}`, () => api.labVmAction(vm.id, "clone"), "Cloned.")}>Clone</button>
              <button
                className="btn small ghost"
                disabled={busy !== null}
                onClick={() => {
                  if (window.confirm(`Delete ${vm.name} and its disk? This cannot be undone.`)) void act(`delete:${vm.id}`, () => api.labDeleteVm(vm.id), "Deleted.");
                }}
              >
                Delete
              </button>
            </>
          ) : null}
        </div>
      </div>

      {open && running ? <VmConsole vm={vm} /> : null}

      <details style={{ marginTop: 10 }}>
        <summary className="small" style={{ cursor: "pointer" }}>Run tests on it</summary>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 4, margin: "8px 0", fontSize: 12.5 }}>
          {profiles.map((p) => (
            <label key={p.id} title={p.about} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={chosen.includes(p.id)} onChange={(e) => setChosen((list) => (e.target.checked ? [...list, p.id] : list.filter((x) => x !== p.id)))} />
              {p.name}
            </label>
          ))}
        </div>
        <div className="learn-plan" style={{ flexWrap: "wrap" }}>
          <input className="input" style={{ width: 120 }} placeholder="Login user" value={user} onChange={(e) => setUser(e.target.value)} />
          <input className="input" style={{ width: 150 }} placeholder="Password (if any)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button
            className="btn small primary"
            disabled={busy !== null || !chosen.length}
            onClick={() =>
              void act(
                `test:${vm.id}`,
                async () => {
                  const order = [...profiles.map((p) => p.id)].filter((id) => chosen.includes(id));
                  const { run } = await api.labStartRun({ vmId: vm.id, profiles: order, login: { user, password } });
                  onOpenRun(run.id);
                },
                "The test run is under way."
              )
            }
          >
            Run {chosen.length} profile{chosen.length === 1 ? "" : "s"}
          </button>
        </div>
      </details>

      <details style={{ marginTop: 8 }}>
        <summary className="small" style={{ cursor: "pointer" }}>Snapshots ({vm.snapshots.length})</summary>
        <div style={{ marginTop: 6 }}>
          {vm.snapshots.map((s) => (
            <div key={s.name} className="small" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
              <strong>{s.name}</strong> <span className="muted">{ago(s.at)}</span>
              <button className="btn small ghost" disabled={busy !== null} onClick={() => void act(`restore:${vm.id}`, () => api.labRestoreSnapshot(vm.id, s.name), `Restored ${s.name}.`)}>Restore</button>
              <button className="btn small ghost" disabled={busy !== null} onClick={() => void act(`delsnap:${vm.id}`, () => api.labDeleteSnapshot(vm.id, s.name), "Snapshot deleted.")}>Delete</button>
            </div>
          ))}
          <div className="learn-plan">
            <input className="input" style={{ width: 200 }} placeholder="Snapshot name" value={snap} onChange={(e) => setSnap(e.target.value)} />
            <button className="btn small" disabled={busy !== null || !snap.trim()} onClick={() => void act(`snap:${vm.id}`, () => api.labSnapshot(vm.id, snap.trim()).then(() => setSnap("")), "Snapshot taken.")}>
              {b("snap") ? <Busy label="Saving…" /> : "Take snapshot"}
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}

function RunDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const toast = useToast();
  const [run, setRun] = useState<LabTestRun | null>(null);
  const [text, setText] = useState("");
  const load = () => api.labRun(id).then((d) => setRun(d.run)).catch(() => undefined);
  useEffect(() => {
    void load();
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [id]);
  if (!run) return <Skeleton rows={2} />;
  const file = (name: string) => onMachine(`/lab/file/run/${run.id}/${name}?t=${run.fileToken}`);
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <div>
          <strong>{run.vmName}</strong> <span className={`tag ${stateTag(run.state)}`}>{run.state}</span>
          <div className="small muted">
            {run.counts.passed} passed · {run.counts.failed} failed · {run.counts.warned} warnings · {run.counts.skipped} skipped · by {run.agent} · {ago(run.startedAt)}
            {run.build.iso ? ` · ${run.build.iso}` : ""}
          </div>
        </div>
        <div className="btn-row">
          {run.state === "running" ? <button className="btn small" onClick={() => void api.labStopRun(run.id)}>Stop</button> : null}
          {run.state !== "running" ? <a className="btn small ghost" href={file("serial.log")} target="_blank" rel="noreferrer">Serial log</a> : null}
          <button className="btn small ghost" onClick={onClose}>Close</button>
        </div>
      </div>
      {run.error ? <Banner kind="error">{run.error}</Banner> : null}
      <div style={{ marginTop: 8 }}>
        {run.steps.map((step) => (
          <details key={step.index} style={{ borderTop: "1px solid var(--line, rgba(255,255,255,.08))", padding: "5px 0" }}>
            <summary className="small" style={{ cursor: "pointer" }}>
              <span className={`tag ${step.result === "passed" ? "ok" : step.result === "failed" ? "bad" : step.result === "warned" ? "warn" : ""}`}>{step.result}</span> <span className="muted">[{step.profile}]</span> {step.what}
              <span className="muted"> · {Math.round(step.durationMs / 100) / 10} s</span>
            </summary>
            <div className="small" style={{ margin: "6px 0 6px 12px" }}>
              <div><strong>Expected:</strong> {step.expected}</div>
              <div><strong>Actual:</strong> {step.actual}</div>
              {step.output ? <pre style={{ whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto", fontSize: 11.5 }}>{step.output}</pre> : null}
              {step.screenshot ? <img alt={step.what} src={file(step.screenshot)} style={{ maxWidth: "100%", marginTop: 6, borderRadius: 6 }} /> : null}
            </div>
          </details>
        ))}
      </div>
      {run.frames.length ? <div className="small muted" style={{ marginTop: 6 }}>{run.frames.length} recorded frames kept with the run.</div> : null}
      <div className="section-title">Your feedback</div>
      {run.feedback.map((f, i) => (
        <div key={i} className="small" style={{ marginBottom: 4 }}>
          <span className="tag">{f.kind}</span> {f.text} <span className="muted">{ago(f.at)}{f.followUp ? ` · ${f.followUp}` : ""}</span>
        </div>
      ))}
      <div className="learn-plan">
        <input className="input" style={{ flex: 1 }} placeholder="A defect, a critique, what to test again…" value={text} onChange={(e) => setText(e.target.value)} />
        <button
          className="btn small"
          disabled={!text.trim()}
          onClick={() =>
            void api
              .labRunFeedback(run.id, text.trim())
              .then((d) => {
                setRun(d.run);
                setText("");
                toast("Noted, and linked to this run.", "ok");
              })
              .catch((error) => toast(error instanceof Error ? error.message : String(error), "error"))
          }
        >
          Send
        </button>
      </div>
    </div>
  );
}

export default function LabPage() {
  const connected = useConnected();
  const toast = useToast();
  const lab = useRemote(() => api.lab(), 8000, "lab");
  const [busy, setBusy] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  // A link can open a run: /lab/?run=<id>.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("run");
    if (wanted) setOpenRun(wanted);
  }, []);

  const act: Act = async (label, fn, ok) => {
    setBusy(label);
    try {
      await fn();
      toast(ok, "ok");
      await lab.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(null);
    }
  };

  if (connected === false) return <NotConnected />;
  const data = lab.data;
  const runningCount = data?.vms.filter((v) => v.state === "running" || v.state === "paused").length ?? 0;

  return (
    <>
      <Header title="Virtual Test Lab" sub="Real virtual machines that boot what the agents build, for you and for them to test" />
      <div className="wrap">
        {!data ? (
          <Skeleton rows={3} />
        ) : (
          <>
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <span className={`tag ${data.backend.ok ? (data.backend.accel === "kvm" ? "ok" : "warn") : "bad"}`}>{data.backend.ok ? (data.backend.accel === "kvm" ? "Hardware accelerated" : "CPU emulated") : "Not available"}</span>{" "}
                  <span className="small">{data.backend.detail}</span>
                  <div className="small muted">
                    {runningCount} of {data.limits.maxRunning} VMs running · up to {data.limits.maxMemoryMb} MB of memory · {data.backend.qemu ?? ""}
                  </div>
                </div>
                {runningCount ? (
                  <button
                    className="btn small"
                    disabled={busy !== null}
                    onClick={() => {
                      if (window.confirm("Stop every VM now? Anything unsaved in them is lost.")) void act("stopall", () => api.labStopAll(), "Every VM stopped.");
                    }}
                  >
                    Emergency stop
                  </button>
                ) : null}
              </div>
            </div>

            <CreateVm isos={data.isos} busy={busy} act={act} />

            {openRun ? <RunDetail id={openRun} onClose={() => setOpenRun(null)} /> : null}

            <div className="section-title">Virtual machines · {data.vms.length}</div>
            {data.vms.length === 0 ? <p className="small muted">None yet. Create one above and start it: it boots a real operating system.</p> : null}
            {data.vms.map((vm) => (
              <VmCard key={vm.id} vm={vm} profiles={data.profiles} full={data.full} busy={busy} act={act} onOpenRun={setOpenRun} />
            ))}

            <div className="section-title">Test runs · {data.runs.length}</div>
            {data.runs.length === 0 ? <p className="small muted">No test runs yet.</p> : null}
            {data.runs.map((run: LabRunSummary) => (
              <div key={run.id} className="small" style={{ display: "flex", gap: 8, padding: "5px 0", alignItems: "center", flexWrap: "wrap", cursor: "pointer" }} onClick={() => setOpenRun(run.id)}>
                <span className={`tag ${stateTag(run.state)}`}>{run.state}</span>
                <strong>{run.vmName}</strong>
                <span className="muted">
                  {run.counts.passed} passed, {run.counts.failed} failed, {run.counts.warned} warnings · {run.agent} · {ago(run.startedAt)}
                  {run.build.iso ? ` · ${run.build.iso}` : ""}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}
