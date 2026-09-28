import { useState, useEffect } from "react";
import useSWR from "swr";
import { apiRequest } from "../lib/api";

interface BuildIteration {
  iteration: number;
  timestamp: Date;
  qualityScore: number;
  objectiveScore: number;
  improvements: string[];
  artifacts: string[];
  status: "running" | "verifying" | "repairing" | "analyzing" | "improving" | "packaging" | "complete" | "error";
  metrics: {
    completeness: number;
    security: number;
    performance: number;
    usability: number;
    testCoverage: number;
  };
}

interface AutonomousBuildStatus {
  buildId: string;
  isRunning: boolean;
  isPaused: boolean;
  currentIteration: number;
  config: {
    projectName: string;
    description: string;
    targetPlatforms: string[];
    qualityThreshold: number;
    maxIterations: number;
  };
  iterations: BuildIteration[];
  startTime?: Date;
  latestQualityScore: number;
}

interface HardwareInfo {
  specs: {
    cpuCores: number;
    totalMemory: number;
    freeMemory: number;
    platform: string;
    recommendedModelSize: string;
  };
  utilization: {
    cpuUsage: number;
    memoryUsage: number;
    recommendation: string;
  };
  recommendations: {
    model: string;
    tokens: number;
    delay: number;
    batchSize: number;
  };
}

const fetcher = (path: string) => apiRequest<any>(path);

export const AutonomousPanel = () => {
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [platforms, setPlatforms] = useState<string[]>(["windows", "macos", "linux"]);
  const [qualityThreshold, setQualityThreshold] = useState(90);
  const [maxIterations, setMaxIterations] = useState(100);
  const [activeBuildId, setActiveBuildId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const { data: activeBuilds, mutate: mutateActiveBuilds } = useSWR<any>(
    "/api/autonomous/active",
    fetcher,
    { refreshInterval: 2000 }
  );

  const { data: buildStatus, mutate: mutateBuildStatus } = useSWR<AutonomousBuildStatus>(
    activeBuildId ? `/api/autonomous/${activeBuildId}/status` : null,
    fetcher,
    { refreshInterval: 1000 }
  );

  const { data: hardwareInfo } = useSWR<HardwareInfo>(
    "/api/autonomous/hardware",
    fetcher,
    { refreshInterval: 5000 }
  );

  useEffect(() => {
    if (activeBuilds?.builds?.length > 0 && !activeBuildId) {
      setActiveBuildId(activeBuilds.builds[0].buildId);
    }
  }, [activeBuilds, activeBuildId]);

  const startBuild = async () => {
    if (!projectName || !description) {
      alert("Please enter project name and description");
      return;
    }

    setIsStarting(true);
    try {
      const data = await apiRequest<{ success?: boolean; buildId?: string; error?: string }>("/api/autonomous/start", {
        method: "POST",
        body: JSON.stringify({
          projectName,
          description,
          targetPlatforms: platforms,
          qualityThreshold,
          maxIterations,
          enableContinuousLearning: true,
          hardwareOptimization: true,
          autoPackaging: true
        })
      });
      
      if (data.success) {
        setActiveBuildId(data.buildId ?? null);
        mutateActiveBuilds();
        setProjectName("");
        setDescription("");
      } else {
        alert(`Failed to start build: ${data.error}`);
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    } finally {
      setIsStarting(false);
    }
  };

  const pauseBuild = async () => {
    if (!activeBuildId) return;
    
    await apiRequest(`/api/autonomous/${activeBuildId}/pause`, { method: "POST" });
    mutateBuildStatus();
  };

  const resumeBuild = async () => {
    if (!activeBuildId) return;
    
    await apiRequest(`/api/autonomous/${activeBuildId}/resume`, { method: "POST" });
    mutateBuildStatus();
  };

  const stopBuild = async () => {
    if (!activeBuildId) return;
    
    await apiRequest(`/api/autonomous/${activeBuildId}/stop`, { method: "POST" });
    setActiveBuildId(null);
    mutateActiveBuilds();
  };

  const togglePlatform = (platform: string) => {
    setPlatforms(prev =>
      prev.includes(platform)
        ? prev.filter(p => p !== platform)
        : [...prev, platform]
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Autonomous Build System</h2>
        <p className="text-gray-400">
          Continuously iterate and improve until production-ready quality is achieved
        </p>
      </div>

      {/* Hardware Status */}
      {hardwareInfo && (
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-3">Hardware Status</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-gray-400 text-sm">CPU Usage</p>
              <p className="text-white text-xl font-bold">
                {(hardwareInfo.utilization.cpuUsage ?? 0).toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-gray-400 text-sm">Memory Usage</p>
              <p className="text-white text-xl font-bold">
                {(hardwareInfo.utilization.memoryUsage ?? 0).toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-gray-400 text-sm">Current Model</p>
              <p className="text-white text-sm font-mono">
                {hardwareInfo.recommendations.model}
              </p>
            </div>
            <div>
              <p className="text-gray-400 text-sm">Optimal Tokens</p>
              <p className="text-white text-xl font-bold">
                {hardwareInfo.recommendations.tokens}
              </p>
            </div>
          </div>
          {hardwareInfo.utilization.recommendation && hardwareInfo.utilization.recommendation !== "System running optimally" && (
            <div className="mt-3 p-2 bg-yellow-900/30 border border-yellow-700 rounded">
              <p className="text-yellow-300 text-sm">
                ⚠️ {hardwareInfo.utilization.recommendation}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Active Build Status */}
      {buildStatus && (
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-white">{buildStatus.config.projectName}</h3>
              <p className="text-gray-400 text-sm">{buildStatus.config.description}</p>
            </div>
            <div className="flex gap-2">
              {buildStatus.isPaused ? (
                <button
                  onClick={resumeBuild}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition"
                >
                  ▶️ Resume
                </button>
              ) : buildStatus.isRunning ? (
                <button
                  onClick={pauseBuild}
                  className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded transition"
                >
                  ⏸️ Pause
                </button>
              ) : null}
              <button
                onClick={stopBuild}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition"
              >
                ⏹️ Stop
              </button>
            </div>
          </div>

          {/* Progress */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400 text-sm">Quality Score</span>
              <span className="text-white font-bold text-lg">
                {buildStatus.latestQualityScore.toFixed(1)}% / {buildStatus.config.qualityThreshold}%
              </span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-4">
              <div
                className="bg-gradient-to-r from-blue-500 to-green-500 h-4 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, buildStatus.latestQualityScore)}%` }}
              />
            </div>
          </div>

          {/* Iteration Info */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="bg-gray-900 p-3 rounded">
              <p className="text-gray-400 text-xs">Iteration</p>
              <p className="text-white text-2xl font-bold">
                {buildStatus.currentIteration}/{buildStatus.config.maxIterations}
              </p>
            </div>
            <div className="bg-gray-900 p-3 rounded">
              <p className="text-gray-400 text-xs">Status</p>
              <p className="text-white text-sm font-semibold">
                {buildStatus.isPaused ? "⏸️ Paused" : buildStatus.isRunning ? "🔄 Running" : "✅ Complete"}
              </p>
            </div>
            <div className="bg-gray-900 p-3 rounded">
              <p className="text-gray-400 text-xs">Platforms</p>
              <p className="text-white text-xs">
                {buildStatus.config.targetPlatforms.join(", ")}
              </p>
            </div>
          </div>

          {/* Quality Metrics */}
          {buildStatus.iterations.length > 0 && (
            <div className="bg-gray-900 p-4 rounded">
              <h4 className="text-white font-semibold mb-3">Latest Metrics</h4>
              <div className="grid grid-cols-5 gap-3">
                {Object.entries(buildStatus.iterations[buildStatus.iterations.length - 1].metrics).map(([key, value]) => (
                  <div key={key} className="text-center">
                    <p className="text-gray-400 text-xs capitalize">{key}</p>
                    <p className="text-white text-lg font-bold">{value.toFixed(0)}%</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Iteration History */}
          {buildStatus.iterations.length > 0 && (
            <div className="mt-4">
              <h4 className="text-white font-semibold mb-2">Iteration History</h4>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {buildStatus.iterations.slice().reverse().map((iteration) => (
                  <div key={iteration.iteration} className="bg-gray-900 p-3 rounded flex items-center justify-between">
                    <div>
                      <span className="text-white font-semibold">#{iteration.iteration}</span>
                      <span className="text-gray-400 text-sm ml-3">{iteration.status}</span>
                    </div>
                    <div className="text-white font-bold">
                      {iteration.qualityScore.toFixed(1)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Start New Build Form */}
      {!buildStatus && (
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-4">Start New Autonomous Build</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-gray-400 text-sm mb-2">Project Name</label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full bg-gray-900 text-white px-4 py-2 rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
                placeholder="e.g., Unity Game Maker"
              />
            </div>

            <div>
              <label className="block text-gray-400 text-sm mb-2">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-gray-900 text-white px-4 py-2 rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
                rows={3}
                placeholder="Describe what you want to build..."
              />
            </div>

            <div>
              <label className="block text-gray-400 text-sm mb-2">Target Platforms</label>
              <div className="flex gap-3">
                {["windows", "macos", "linux", "web"].map((platform) => (
                  <label key={platform} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={platforms.includes(platform)}
                      onChange={() => togglePlatform(platform)}
                      className="w-4 h-4"
                    />
                    <span className="text-white capitalize">{platform}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-400 text-sm mb-2">
                  Quality Threshold: {qualityThreshold}%
                </label>
                <input
                  type="range"
                  min="60"
                  max="100"
                  value={qualityThreshold}
                  onChange={(e) => setQualityThreshold(Number(e.target.value))}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-gray-400 text-sm mb-2">
                  Max Iterations: {maxIterations}
                </label>
                <input
                  type="range"
                  min="10"
                  max="200"
                  value={maxIterations}
                  onChange={(e) => setMaxIterations(Number(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>

            <button
              onClick={startBuild}
              disabled={isStarting || !projectName || !description}
              className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-semibold rounded transition"
            >
              {isStarting ? "Starting..." : "🚀 Start Autonomous Build"}
            </button>
          </div>
        </div>
      )}

      {/* Active Builds List */}
      {activeBuilds && activeBuilds.builds.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-3">Active Builds ({activeBuilds.count})</h3>
          <div className="space-y-2">
            {activeBuilds.builds.map((build: any) => (
              <button
                key={build.buildId}
                onClick={() => setActiveBuildId(build.buildId)}
                className={`w-full text-left p-3 rounded transition ${
                  activeBuildId === build.buildId
                    ? "bg-blue-900 border border-blue-600"
                    : "bg-gray-900 hover:bg-gray-700"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white font-semibold">{build.projectName}</p>
                    <p className="text-gray-400 text-sm">
                      Iteration {build.currentIteration} • {build.qualityScore.toFixed(1)}%
                    </p>
                  </div>
                  <div className="text-sm">
                    {build.isPaused ? (
                      <span className="text-yellow-400">⏸️ Paused</span>
                    ) : build.isRunning ? (
                      <span className="text-green-400">🔄 Running</span>
                    ) : (
                      <span className="text-gray-400">✅ Complete</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AutonomousPanel;
