/**
 * Jarvis Ecosystem Bridge for Agent-Builder
 * Connects Agent-Builder to Second-Brain (Jarvis):
 * - Auto-registration & heartbeat reporting with hardware specs
 * - Security events forwarded to Jarvis's incident feed
 *
 * Research knowledge is delivered separately by SecondBrainClient, through
 * Second-Brain's knowledge ingest endpoint rather than this bridge.
 */

import { eventBus, type ServerEvent } from "../server/eventBus.js";
import { getHardwareScaler } from "../utils/HardwareScaler.js";
import { Logger } from "../utils/Logger.js";

export interface JarvisBridgeConfig {
  jarvisHost?: string;
  apiKey?: string;
  appName?: string;
  appSlug?: string;
  heartbeatIntervalMs?: number;
  enableLogForwarding?: boolean;
}

const originOf = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

export class JarvisBridge {
  private static instance: JarvisBridge | null = null;
  private jarvisHost: string;
  private apiKey: string;
  private appName: string;
  private appSlug: string;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private registered: boolean = false;
  private isConnecting: boolean = false;
  private eventBusHooked: boolean = false;

  private constructor(config: JarvisBridgeConfig = {}) {
    this.jarvisHost = (config.jarvisHost || process.env.JARVIS_HOST || "http://localhost:3000").replace(/\/$/, "");
    this.apiKey = config.apiKey || process.env.JARVIS_API_KEY || "";
    this.appName = config.appName || "Agent-Builder";
    this.appSlug = config.appSlug || "agent-builder";
  }

  public static getInstance(config?: JarvisBridgeConfig): JarvisBridge {
    if (!JarvisBridge.instance) {
      JarvisBridge.instance = new JarvisBridge(config);
    }
    return JarvisBridge.instance;
  }

  /**
   * Initialize bridge: register if needed, start heartbeats, hook event bus
   */
  public async initialize(): Promise<void> {
    if (this.isConnecting) return;
    this.isConnecting = true;

    // Second-Brain and the Agent-Builder dashboard both default to port 3000.
    // When the host points at the dashboard, every call below would land on the
    // wrong app and fail in confusing ways, so say so plainly.
    const dashboardOrigin = originOf(process.env.DASHBOARD_URL ?? "http://localhost:3000");
    if (originOf(this.jarvisHost) === dashboardOrigin) {
      Logger.warn(
        "JARVIS_HOST is the same address as the Agent-Builder dashboard. Run Second-Brain on another port " +
          "(e.g. PORT=3100) and set JARVIS_HOST / SECOND_BRAIN_HOST to it.",
        { jarvisHost: this.jarvisHost }
      );
    }

    try {
      if (!this.apiKey) {
        await this.attemptAutoRegister();
      } else {
        await this.sendPing();
      }

      this.startHeartbeatLoop();
      this.hookEventBus();
      Logger.log("Jarvis Bridge initialized", { host: this.jarvisHost, connected: this.registered });
    } catch (err: any) {
      Logger.warn("Jarvis Bridge initialization failed (failing open, will retry)", { error: err.message });
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Attempt auto-registration with Second-Brain
   */
  private async attemptAutoRegister(): Promise<void> {
    try {
      const response = await fetch(`${this.jarvisHost}/api/ecosystem/integrations/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appName: this.appName,
          appSlug: this.appSlug,
          userId: process.env.JARVIS_USER_ID || "admin",
          permissions: ["read_telemetry", "enforce_security", "hot_patch", "execute_actions", "read_logs", "ingest_events", "create_tasks"],
          baseUrl: process.env.AGENT_BUILDER_API_URL || "http://localhost:4000"
        })
      });

      if (response.ok) {
        const data = (await response.json()) as { apiKey?: string };
        if (data.apiKey) {
          this.apiKey = data.apiKey;
          process.env.JARVIS_API_KEY = data.apiKey;
          this.registered = true;
          Logger.log("Agent-Builder registered with Jarvis successfully");
        }
      }
    } catch (err: any) {
      // Non-blocking: will retry during heartbeat
      Logger.warn("Jarvis auto-registration deferred", { error: err.message });
    }
  }

  /**
   * Send heartbeat to Jarvis with local hardware metrics
   */
  public async sendPing(): Promise<void> {
    const scaler = getHardwareScaler();
    const utilization = scaler.getUtilization();
    const caps = scaler.getCapabilities();

    try {
      const response = await fetch(`${this.jarvisHost}/api/ecosystem/integrations/ping`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Jarvis-Api-Key": this.apiKey || "anonymous"
        },
        body: JSON.stringify({
          status: "healthy",
          appName: this.appName,
          appSlug: this.appSlug,
          version: "1.0.0",
          metrics: {
            cpuUsage: utilization.cpuUsage,
            memoryUsage: utilization.memoryUsage,
            freeMemoryGB: utilization.freeMemory,
            cpuCores: caps.cpuCores,
            recommendedWorkers: caps.recommendedWorkers,
            platform: caps.platform
          }
        })
      });

      this.registered = response.ok;
    } catch {
      this.registered = false;
    }
  }

  /**
   * Start recurring heartbeat loop
   */
  private startHeartbeatLoop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(async () => {
      if (!this.apiKey && !this.registered) {
        await this.attemptAutoRegister();
      }
      await this.sendPing();
    }, 45_000);
    this.heartbeatTimer.unref();
  }

  /**
   * Forward security events to Jarvis.
   *
   * This used to forward log, task, build and feedback events too — all posted
   * to /api/security/incidents with the event type as the "threatType", which
   * filed every build step in Second-Brain's security feed as an incident.
   * Only genuine security events belong there.
   */
  private hookEventBus(): void {
    if (this.eventBusHooked) return;
    this.eventBusHooked = true;
    eventBus.on("event", async (event: ServerEvent) => {
      if (event.type === "security") {
        await this.forwardSecurityEvent(event);
      }
    });
  }

  public async forwardSecurityEvent(event: ServerEvent): Promise<void> {
    if (!this.apiKey || event.type !== "security") return;

    try {
      await fetch(`${this.jarvisHost}/api/security/incidents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Jarvis-Api-Key": this.apiKey
        },
        body: JSON.stringify({
          endpoint: "/api/agent/events",
          threatType: "security",
          severity: "info",
          details: event.payload
        })
      }).catch(() => undefined);
    } catch {
      // Fail-open
    }
  }

  public getStatus() {
    return {
      connected: this.registered,
      jarvisHost: this.jarvisHost,
      hasApiKey: !!this.apiKey
    };
  }
}
