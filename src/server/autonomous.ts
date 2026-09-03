import type { Express, Request, Response } from "express";
import { AutonomousOrchestrator, type AutonomousConfig, type BuildIteration } from "../orchestrator/AutonomousOrchestrator.js";
import { authenticate, authorizeRoles } from "./auth.js";
import { Logger } from "../utils/Logger.js";

// Store active orchestrator instances
const activeOrchestrators = new Map<string, AutonomousOrchestrator>();

export const registerAutonomousRoutes = (app: Express) => {
  
  /**
   * Start a new autonomous build
   * POST /api/autonomous/start
   * Body: {
   *   projectName: string,
   *   description: string,
   *   targetPlatforms: string[],
   *   qualityThreshold?: number,
   *   maxIterations?: number,
   *   enableContinuousLearning?: boolean,
   *   hardwareOptimization?: boolean,
   *   autoPackaging?: boolean
   * }
   */
  app.post(
    "/api/autonomous/start",
    authenticate,
    authorizeRoles(["editor", "admin", "owner"]),
    async (req: Request, res: Response) => {
      try {
        const config = req.body as Partial<AutonomousConfig>;

        // Validate required fields
        if (!config.projectName || !config.description) {
          return res.status(400).json({
            error: "Missing required fields: projectName, description"
          });
        }

        // Set defaults
        const fullConfig: AutonomousConfig = {
          projectName: config.projectName,
          description: config.description,
          targetPlatforms: config.targetPlatforms || ["windows", "macos", "linux"],
          qualityThreshold: config.qualityThreshold || 90,
          maxIterations: config.maxIterations || 100,
          enableContinuousLearning: config.enableContinuousLearning !== false,
          hardwareOptimization: config.hardwareOptimization !== false,
          autoPackaging: config.autoPackaging !== false
        };

        const orchestrator = new AutonomousOrchestrator(fullConfig);
        const buildId = (orchestrator as any).buildId;

        // Store orchestrator instance
        activeOrchestrators.set(buildId, orchestrator);

        // Set up event listeners for logging
        orchestrator.on("started", () => {
          Logger.log("Autonomous build started", { buildId, projectName: fullConfig.projectName });
        });

        orchestrator.on("iteration-complete", (iteration: BuildIteration) => {
          Logger.log("Iteration complete", {
            buildId,
            iteration: iteration.iteration,
            qualityScore: iteration.qualityScore
          });
        });

        orchestrator.on("completed", ({ finalQuality }) => {
          Logger.log("Autonomous build completed", { buildId, finalQuality });
          // Clean up after completion
          setTimeout(() => activeOrchestrators.delete(buildId), 60000); // Keep for 1 min
        });

        orchestrator.on("error", (error: Error) => {
          Logger.error("Autonomous build error", { buildId, error: error.message });
        });

        orchestrator.on("stopped", () => {
          Logger.log("Autonomous build stopped by user", { buildId });
          activeOrchestrators.delete(buildId);
        });

        // Start the autonomous process (non-blocking)
        orchestrator.start().catch((error) => {
          Logger.error("Autonomous orchestration failed", { buildId, error: error.message });
        });

        res.json({
          success: true,
          buildId,
          message: "Autonomous build started",
          config: fullConfig
        });

      } catch (error: any) {
        Logger.error("Failed to start autonomous build", { error: error.message });
        res.status(500).json({
          error: "Failed to start autonomous build",
          details: error.message
        });
      }
    }
  );

  /**
   * Pause an active autonomous build
   * POST /api/autonomous/:buildId/pause
   */
  app.post(
    "/api/autonomous/:buildId/pause",
    authenticate,
    authorizeRoles(["editor", "admin", "owner"]),
    (req: Request, res: Response) => {
      try {
        const { buildId } = req.params;
        const orchestrator = activeOrchestrators.get(buildId);

        if (!orchestrator) {
          return res.status(404).json({
            error: "Build not found or already completed"
          });
        }

        orchestrator.pause();

        res.json({
          success: true,
          message: "Build paused",
          buildId
        });

      } catch (error: any) {
        Logger.error("Failed to pause build", { error: error.message });
        res.status(500).json({
          error: "Failed to pause build",
          details: error.message
        });
      }
    }
  );

  /**
   * Resume a paused autonomous build
   * POST /api/autonomous/:buildId/resume
   */
  app.post(
    "/api/autonomous/:buildId/resume",
    authenticate,
    authorizeRoles(["editor", "admin", "owner"]),
    (req: Request, res: Response) => {
      try {
        const { buildId } = req.params;
        const orchestrator = activeOrchestrators.get(buildId);

        if (!orchestrator) {
          return res.status(404).json({
            error: "Build not found or already completed"
          });
        }

        orchestrator.resume();

        res.json({
          success: true,
          message: "Build resumed",
          buildId
        });

      } catch (error: any) {
        Logger.error("Failed to resume build", { error: error.message });
        res.status(500).json({
          error: "Failed to resume build",
          details: error.message
        });
      }
    }
  );

  /**
   * Stop an autonomous build completely
   * POST /api/autonomous/:buildId/stop
   */
  app.post(
    "/api/autonomous/:buildId/stop",
    authenticate,
    authorizeRoles(["editor", "admin", "owner"]),
    (req: Request, res: Response) => {
      try {
        const { buildId } = req.params;
        const orchestrator = activeOrchestrators.get(buildId);

        if (!orchestrator) {
          return res.status(404).json({
            error: "Build not found or already completed"
          });
        }

        orchestrator.stop();
        activeOrchestrators.delete(buildId);

        res.json({
          success: true,
          message: "Build stopped",
          buildId
        });

      } catch (error: any) {
        Logger.error("Failed to stop build", { error: error.message });
        res.status(500).json({
          error: "Failed to stop build",
          details: error.message
        });
      }
    }
  );

  /**
   * Get status of an autonomous build
   * GET /api/autonomous/:buildId/status
   */
  app.get(
    "/api/autonomous/:buildId/status",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    (req: Request, res: Response) => {
      try {
        const { buildId } = req.params;
        const orchestrator = activeOrchestrators.get(buildId);

        if (!orchestrator) {
          return res.status(404).json({
            error: "Build not found or already completed"
          });
        }

        const status = {
          buildId,
          isRunning: (orchestrator as any).isRunning,
          isPaused: (orchestrator as any).isPaused,
          currentIteration: (orchestrator as any).currentIteration,
          config: (orchestrator as any).config,
          iterations: (orchestrator as any).iterations || [],
          startTime: (orchestrator as any).startTime,
          latestQualityScore: (orchestrator as any).iterations?.[(orchestrator as any).iterations.length - 1]?.qualityScore || 0
        };

        res.json(status);

      } catch (error: any) {
        Logger.error("Failed to get build status", { error: error.message });
        res.status(500).json({
          error: "Failed to get build status",
          details: error.message
        });
      }
    }
  );

  /**
   * List all active autonomous builds
   * GET /api/autonomous/active
   */
  app.get(
    "/api/autonomous/active",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    (_req: Request, res: Response) => {
      try {
        const activeBuildIds = Array.from(activeOrchestrators.keys());
        
        const builds = activeBuildIds.map(buildId => {
          const orchestrator = activeOrchestrators.get(buildId);
          if (!orchestrator) return null;

          return {
            buildId,
            projectName: (orchestrator as any).config.projectName,
            isRunning: (orchestrator as any).isRunning,
            isPaused: (orchestrator as any).isPaused,
            currentIteration: (orchestrator as any).currentIteration,
            qualityScore: (orchestrator as any).iterations?.[(orchestrator as any).iterations.length - 1]?.qualityScore || 0
          };
        }).filter(Boolean);

        res.json({
          count: builds.length,
          builds
        });

      } catch (error: any) {
        Logger.error("Failed to list active builds", { error: error.message });
        res.status(500).json({
          error: "Failed to list active builds",
          details: error.message
        });
      }
    }
  );

  /**
   * Get detailed iteration history for a build
   * GET /api/autonomous/:buildId/iterations
   */
  app.get(
    "/api/autonomous/:buildId/iterations",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    (req: Request, res: Response) => {
      try {
        const { buildId } = req.params;
        const orchestrator = activeOrchestrators.get(buildId);

        if (!orchestrator) {
          return res.status(404).json({
            error: "Build not found or already completed"
          });
        }

        const iterations = (orchestrator as any).iterations || [];

        res.json({
          buildId,
          totalIterations: iterations.length,
          iterations
        });

      } catch (error: any) {
        Logger.error("Failed to get iterations", { error: error.message });
        res.status(500).json({
          error: "Failed to get iterations",
          details: error.message
        });
      }
    }
  );

  /**
   * Get hardware status and recommendations
   * GET /api/autonomous/hardware
   */
  app.get(
    "/api/autonomous/hardware",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    async (_req: Request, res: Response) => {
      try {
        const { HardwareScaler } = await import("../utils/HardwareScaler.js");
        const scaler = new HardwareScaler();
        
        const utilization = await scaler.getUtilization();
        
        res.json({
          specs: scaler.specs,
          utilization,
          recommendations: {
            model: scaler.specs.recommendedModelSize,
            tokens: scaler.getOptimalTokens(),
            delay: scaler.getOptimalDelay(),
            batchSize: scaler.getOptimalBatchSize()
          }
        });

      } catch (error: any) {
        Logger.error("Failed to get hardware info", { error: error.message });
        res.status(500).json({
          error: "Failed to get hardware info",
          details: error.message
        });
      }
    }
  );

  Logger.log("Autonomous orchestration routes registered");
};
