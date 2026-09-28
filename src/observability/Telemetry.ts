import { diag, DiagConsoleLogger, DiagLogLevel, metrics, type Counter, type UpDownCounter } from "@opentelemetry/api";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { Resource } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { Logger } from "../utils/Logger.js";
import { findAvailablePort } from "../utils/Ports.js";

const healthStates = new Map<string, number>();
let telemetryStarted = false;
let exporter: PrometheusExporter | null = null;

let taskCounter: Counter | null = null;
let taskFailureCounter: Counter | null = null;
let activeTasks: UpDownCounter | null = null;
let queueDepthGauge: UpDownCounter | null = null;
let observersInitialized = false;

const ensureInstruments = () => {
  if (taskCounter && taskFailureCounter && activeTasks && queueDepthGauge && observersInitialized) {
    return;
  }

  const meter = metrics.getMeter("agent-builder");
  taskCounter = meter.createCounter("agent_tasks_total", {
    description: "Total number of tasks executed by the orchestrator"
  });

  taskFailureCounter = meter.createCounter("agent_tasks_failed_total", {
    description: "Total number of failed tasks"
  });

  activeTasks = meter.createUpDownCounter("agent_tasks_active", {
    description: "Number of tasks currently running"
  });

  queueDepthGauge = meter.createUpDownCounter("agent_queue_depth", {
    description: "Approximate number of messages queued"
  });

  if (!observersInitialized) {
    meter.createObservableGauge("agent_health_status", {
      description: "Component health status where 1=healthy,0=degraded,-1=down"
    }).addCallback((observable) => {
      for (const [component, value] of healthStates.entries()) {
        observable.observe(value, { component });
      }
    });
    observersInitialized = true;
  }
};

export const initializeTelemetry = async () => {
  if (telemetryStarted) {
    return;
  }

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

  // Metrics are optional, so a busy port must not take the API down with it.
  // Two instances on one machine (the desktop app started while a dev API runs)
  // both want 9464, and the exporter's EADDRINUSE was fatal.
  const preferredPort = Number(process.env.METRICS_PORT ?? 9464);
  const metricsPort = await findAvailablePort(preferredPort);
  if (metricsPort === null) {
    Logger.log("Metrics disabled: no free port available", { preferredPort });
    telemetryStarted = true;
    return;
  }

  const exporterOptions = {
    port: metricsPort,
    endpoint: process.env.METRICS_ENDPOINT ?? "/metrics"
  } as const;

  exporter = new PrometheusExporter(exporterOptions, () => {
    Logger.log("Prometheus exporter ready", exporterOptions);
  });

  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: "agent-builder",
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version ?? "dev"
    }),
    metricReader: exporter
  });

  await sdk.start();
  telemetryStarted = true;
  ensureInstruments();
  Logger.log("Telemetry initialized");
};

export const Telemetry = {
  recordTaskStart(agentType: string) {
    ensureInstruments();
    activeTasks?.add(1, { agentType });
  },
  recordTaskEnd(agentType: string, success: boolean) {
    ensureInstruments();
    activeTasks?.add(-1, { agentType });
    if (success) {
      taskCounter?.add(1, { agentType });
    } else {
      taskFailureCounter?.add(1, { agentType });
    }
  },
  adjustQueueDepth(queueName: string, delta: number) {
    ensureInstruments();
    queueDepthGauge?.add(delta, { queue: queueName });
  },
  setHealth(component: string, status: "ok" | "degraded" | "down") {
    const value = status === "ok" ? 1 : status === "degraded" ? 0 : -1;
    healthStates.set(component, value);
  }
};
