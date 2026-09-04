import Head from "next/head";
import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { EventFeed } from "../components/EventFeed";
import { TaskCard } from "../components/TaskCard";
import { AuthPanel } from "../components/AuthPanel";
import { MemoryBrowser } from "../components/MemoryBrowser";
import { PluginGallery } from "../components/PluginGallery";
import { GraphView } from "../components/GraphView";
import { MarketplaceManager } from "../components/MarketplaceManager";
import { AnalyticsPanel } from "../components/AnalyticsPanel";
import { ContainersPanel } from "../components/ContainersPanel";
import { QueuePanel } from "../components/QueuePanel";
import { HealthPanel } from "../components/HealthPanel";
import { SecurityPanel } from "../components/SecurityPanel";
import { LogsPanel } from "../components/LogsPanel";
import { GovernancePanel } from "../components/GovernancePanel";
import { ControlPanel } from "../components/ControlPanel";
import { EnvManager } from "../components/Admin/EnvManager";
import { LicenseManager } from "../components/Admin/LicenseManager";
import { SystemStatusPanel } from "../components/Admin/SystemStatusPanel";
import { UserManagementPanel } from "../components/Admin/UserManagement";
import { OnboardingWizard } from "../components/Admin/OnboardingWizard";
import { ChatPanel } from "../components/ChatPanel";
import { GamePanel } from "../components/GamePanel";
import { BuildPanel } from "../components/BuildPanel";
import { CollaboratePanel } from "../components/CollaboratePanel";
import { NpcPanel } from "../components/NpcPanel";
import { TerrainPanel } from "../components/TerrainPanel";
import { StoryPanel } from "../components/StoryPanel";
import { SimulationPanel } from "../components/SimulationPanel";
import { SocialPanel } from "../components/SocialPanel";
import { PlayerPanel } from "../components/PlayerPanel";
import { AutonomousPanel } from "../components/AutonomousPanel";
import {
  fetchTasks,
  runAgent,
  subscribeToEvents,
  updateTask,
  fetchUpdateStatus,
  type AuthUser,
  type ServerEvent,
  type Task,
  type UpdateStatus
} from "../lib/api";
import heroImages from "../theme/heroImages";

const fetcher = () => fetchTasks();

type TabKey =
  | "overview"
  | "graph"
  | "marketplace"
  | "analytics"
  | "queue"
  | "health"
  | "security"
  | "logs"
  | "governance"
  | "controls"
  | "env"
  | "license"
  | "system"
  | "users"
  | "build"
  | "autocode"
  | "game"
  | "collaborate"
  | "npc"
  | "terrain"
  | "story"
  | "social"
  | "simulation"
  | "player"
  | "autonomous";

// Order here is render order for the tab bar — Autonomous Build first since
// it's the one pipeline that verifies its own output before calling a build
// done. "(basic)"/"(legacy)" suffixes are honest labels, not a value
// judgment on removing them: Build and AutoCode run without the
// install/typecheck/test/repair loop Autonomous Build has.
const tabLabels: Record<TabKey, string> = {
  autonomous: "Autonomous Build",
  overview: "Overview",
  build: "Build (basic)",
  autocode: "AutoCode (basic)",
  graph: "Graph",
  marketplace: "Marketplace",
  analytics: "Analytics",
  queue: "Queue",
  health: "Health",
  security: "Security",
  logs: "Logs",
  governance: "Governance",
  controls: "Controls",
  env: "Environment Manager",
  license: "License",
  system: "System Status",
  users: "Users",
  game: "Game",
  collaborate: "Collaborate",
  npc: "NPC AI",
  terrain: "Terrain",
  story: "StoryWorld",
  social: "Social",
  simulation: "Simulation",
  player: "Players"
};

export default function Dashboard() {
  const { data: tasks, mutate } = useSWR<Task[]>("tasks", fetcher, {
    refreshInterval: 15000
  });
  const [prompt, setPrompt] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [updateTarget, setUpdateTarget] = useState<Task | null>(null);
  const [updateInstruction, setUpdateInstruction] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("autonomous");
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const canPublishQueue = useMemo(
    () =>
      Boolean(
        currentUser?.teams?.some((team) => ["developer", "admin", "owner"].includes(team.role))
      ),
    [currentUser]
  );
  const isAdmin = useMemo(
    () =>
      Boolean(currentUser?.teams?.some((team) => ["admin", "owner"].includes(team.role))),
    [currentUser]
  );

  const { data: updateStatus } = useSWR<UpdateStatus>("update-status", fetchUpdateStatus, {
    revalidateOnFocus: false,
    refreshInterval: 60000
  });

  useEffect(() => {
    const subscription = subscribeToEvents((event) => {
      setEvents((prev) => [event, ...prev].slice(0, 200));
      if (event.type === "task") {
        mutate();
      }
    });

    return () => {
      subscription.close();
    };
  }, [mutate]);

  const sortedTasks = useMemo(() => {
    if (!tasks) return [];
    return [...tasks].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [tasks]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!prompt.trim()) return;
      setIsRunning(true);

      try {
        await runAgent(prompt.trim());
        setPrompt("");
        await mutate();
      } catch (error) {
        console.error("Failed to run agent", error);
      } finally {
        setIsRunning(false);
      }
    },
    [prompt, mutate]
  );

  const onUpdateTask = useCallback((task: Task) => {
    setUpdateTarget(task);
    setUpdateInstruction("");
  }, []);

  const submitUpdate = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!updateTarget) return;
      setIsUpdating(true);

      try {
        await updateTask(updateTarget.id, updateInstruction);
        setUpdateTarget(null);
        setUpdateInstruction("");
        await mutate();
      } catch (error) {
        console.error("Failed to update task", error);
      } finally {
        setIsUpdating(false);
      }
    },
    [updateInstruction, updateTarget, mutate]
  );

  const handleAuthChange = useCallback((user: AuthUser | null) => {
    setCurrentUser(user);
  }, []);

  return (
    <>
      <Head>
        <title>Agent Builder Dashboard</title>
      </Head>
      <main className="min-h-screen bg-slate-950 pb-20">
        <header className="border-b border-slate-900/70 bg-slate-950/80 backdrop-blur">
          {updateStatus?.updateAvailable && !updateDismissed && (
            <div className="border-b border-amber-500/40 bg-amber-500/10">
              <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-3 text-sm text-amber-200">
                <span>
                  A new Agent Builder release ({updateStatus.latestVersion}) is available. Current version: {updateStatus.currentVersion}.
                </span>
                <button
                  type="button"
                  onClick={() => setUpdateDismissed(true)}
                  className="rounded-full border border-amber-500/60 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-200 hover:bg-amber-500/10"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-12 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex w-full flex-col gap-4 lg:max-w-xl">
              <div className="flex items-center gap-3">
                <Image
                  src="/branding/hustle_studio_logo.png"
                  alt="Hustle Studio Logo"
                  width={56}
                  height={56}
                  className="h-14 w-14 rounded-full border border-slate-800 bg-slate-900 object-cover"
                  priority
                />
                <div>
                  <p className="text-sm uppercase tracking-[0.2em] text-sky-400">Agent Builder</p>
                  <h1 className="mt-1 text-3xl font-bold text-slate-100 lg:text-4xl">Mission Control</h1>
                </div>
              </div>
              <p className="max-w-2xl text-sm text-slate-400">
                Launch new builds, monitor autonomous agents, and orchestrate updates from a single real-time dashboard.
              </p>
            </div>
            <form onSubmit={handleSubmit} className="w-full max-w-xl rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg shadow-black/40">
              <label htmlFor="prompt" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Launch a new build (basic — no verification)
              </label>
              <p className="mt-1 text-xs text-slate-500">
                Runs one fixed pass with no compile/test check on the result. For a build that
                installs, tests, and repairs itself,{" "}
                <button
                  type="button"
                  onClick={() => setActiveTab("autonomous")}
                  className="font-semibold text-sky-400 underline decoration-dotted underline-offset-2 hover:text-sky-300"
                >
                  use Autonomous Build
                </button>
                .
              </p>
              <textarea
                id="prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                className="mt-2 h-28 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 shadow-inner focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                placeholder="Build a React dashboard with Node.js backend"
                disabled={isRunning}
              />
              <button
                type="submit"
                disabled={isRunning}
                className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700"
              >
                {isRunning ? "Running orchestration..." : "Run Orchestrator"}
              </button>
            </form>
          </div>
        </header>

        {/* Autonomous Build Quick Access — the pipeline that actually verifies its own output */}
        <section className="mx-auto mt-6 max-w-6xl px-6">
          <div className="rounded-xl border-2 border-sky-500/30 bg-gradient-to-r from-sky-500/10 to-blue-500/10 p-4 shadow-lg shadow-sky-500/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-500/20 text-2xl">
                  🏗️
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-100">Autonomous Build</h3>
                  <p className="text-sm text-slate-400">
                    Generates, installs, tests, and repairs the app until an objective check passes
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("autonomous")}
                className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/30 transition hover:bg-sky-400 hover:shadow-sky-400/40"
              >
                Open Autonomous Build →
              </button>
            </div>
          </div>
        </section>

        <section className="mx-auto mt-6 flex max-w-6xl flex-wrap items-center gap-3 px-6">
          <Image
            src={heroImages.logo}
            alt="Hustle Studio mark"
            width={40}
            height={40}
            className="h-10 w-10 rounded-full border border-slate-800 bg-slate-900 object-cover shadow-[0_0_0_rgba(56,189,248,0)] transition-shadow hover:shadow-[0_0_25px_rgba(56,189,248,0.45)]"
            priority
          />
          <div className="flex flex-wrap items-center gap-2">
            {(Object.entries(tabLabels) as Array<[TabKey, string]>).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                  activeTab === key
                    ? "bg-sky-500 text-white"
                    : "border border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        {activeTab === "overview" && (
          <section className="mx-auto mt-10 grid max-w-6xl gap-8 px-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-slate-100">Active & Recent Tasks</h2>
                <span className="text-xs uppercase tracking-wide text-slate-500">Auto-refreshing</span>
              </div>
              <div className="grid gap-4">
                {sortedTasks.length === 0 && (
                  <p className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
                    No tasks yet. Launch a build to see agents in action.
                  </p>
                )}
                {sortedTasks.map((task) => (
                  <TaskCard key={task.id} task={task} onUpdate={onUpdateTask} />
                ))}
              </div>
              <MemoryBrowser canSearch={Boolean(currentUser)} />
            </div>
            <aside className="space-y-6">
              <AuthPanel onAuthChange={handleAuthChange} />
              <EventFeed events={events} />
              {updateTarget && (
                <form onSubmit={submitUpdate} className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg shadow-black/40">
                  <h2 className="text-lg font-semibold text-slate-100">Request Adjustment</h2>
                  <p className="mt-1 text-xs text-slate-400">Target: {updateTarget.agentType}</p>
                  <textarea
                    value={updateInstruction}
                    onChange={(event) => setUpdateInstruction(event.target.value)}
                    className="mt-3 h-32 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                    placeholder="Refine the UI to include a sidebar navigation"
                    disabled={isUpdating}
                  />
                  <div className="mt-3 flex gap-2">
                    <button
                      type="submit"
                      disabled={isUpdating}
                      className="inline-flex flex-1 items-center justify-center rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700"
                    >
                      {isUpdating ? "Sending..." : "Send Update"}
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-md border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
                      onClick={() => setUpdateTarget(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              <PluginGallery />
            </aside>
          </section>
        )}

        {activeTab === "graph" && (
          <section className="mx-auto mt-10 max-w-6xl space-y-6 px-6">
            <GraphView tasks={sortedTasks} />
          </section>
        )}

        {activeTab === "governance" && (
          <section className="mx-auto mt-10 max-w-6xl px-6">
            <GovernancePanel />
          </section>
        )}

        {activeTab === "controls" && (
          <section className="mx-auto mt-10 max-w-6xl px-6">
            <ControlPanel />
          </section>
        )}

        {activeTab === "env" && <EnvManager currentUser={currentUser} />}

        {activeTab === "license" && <LicenseManager canManage={isAdmin} />}

        {activeTab === "system" && <SystemStatusPanel canView={isAdmin} />}

        {activeTab === "users" && <UserManagementPanel canManage={isAdmin} />}

        {activeTab === "marketplace" && (
          <section className="mx-auto mt-10 max-w-6xl space-y-6 px-6">
            <MarketplaceManager currentUser={currentUser} />
          </section>
        )}

        {activeTab === "analytics" && (
          <section className="mx-auto mt-10 grid max-w-6xl gap-8 px-6 lg:grid-cols-2">
            <AnalyticsPanel enabled={Boolean(currentUser)} />
            <ContainersPanel currentUser={currentUser} />
          </section>
        )}

        {activeTab === "queue" && (
          <section className="mx-auto mt-10 max-w-6xl space-y-6 px-6">
            {currentUser ? (
              <QueuePanel canPublish={canPublishQueue} />
            ) : (
              <p className="rounded-xl border border-dashed border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-400">
                Sign in to view queue metrics and publish messages.
              </p>
            )}
          </section>
        )}

        {activeTab === "health" && (
          <section className="mx-auto mt-10 max-w-6xl space-y-6 px-6">
            <HealthPanel />
          </section>
        )}

        {activeTab === "security" && (
          <section className="mx-auto mt-10 max-w-6xl space-y-6 px-6">
            {currentUser ? (
              <SecurityPanel />
            ) : (
              <p className="rounded-xl border border-dashed border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-400">
                Sign in to review policies and validate sandbox requests.
              </p>
            )}
          </section>
        )}

        {activeTab === "logs" && (
          <section className="mx-auto mt-10 max-w-6xl space-y-6 px-6">
            {currentUser ? (
              <LogsPanel />
            ) : (
              <p className="rounded-xl border border-dashed border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-400">
                Sign in to access structured runtime logs.
              </p>
            )}
          </section>
        )}

        {activeTab === "build" && <BuildPanel events={events} />}

        {activeTab === "autocode" && (
          <section className="mx-auto mt-10 max-w-5xl space-y-6 px-6">
            <ChatPanel />
          </section>
        )}

        {activeTab === "game" && (
          <section className="mx-auto mt-10 max-w-6xl space-y-6 px-6">
            <GamePanel />
          </section>
        )}

        {activeTab === "collaborate" && (
          <section className="mx-auto mt-10 max-w-6xl space-y-6 px-6">
            <CollaboratePanel />
          </section>
        )}

        {activeTab === "npc" && (
          <section className="mx-auto mt-10 max-w-6xl space-y-6 px-6">
            <NpcPanel />
          </section>
        )}

        {activeTab === "terrain" && (
          <section className="mx-auto mt-10 max-w-6xl space-y-6 px-6">
            <TerrainPanel />
          </section>
        )}

        {activeTab === "story" && (
          <StoryPanel events={events} />
        )}

        {activeTab === "social" && <SocialPanel events={events} />}

        {activeTab === "simulation" && <SimulationPanel events={events} />}

        {activeTab === "player" && <PlayerPanel events={events} />}

        {activeTab === "autonomous" && <AutonomousPanel />}
      </main>
      <OnboardingWizard onConfigured={() => window.location.reload()} />
    </>
  );
}
