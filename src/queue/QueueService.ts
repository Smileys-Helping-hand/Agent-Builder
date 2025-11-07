import { EventEmitter } from "events";
import { Telemetry } from "../observability/Telemetry.js";
import { Logger } from "../utils/Logger.js";
import { QueueCluster, type ClusterNode } from "./QueueCluster.js";

export type QueueProvider = "redis" | "nats" | "rabbitmq" | "memory";

export type QueueMetrics = {
  provider: QueueProvider;
  connected: boolean;
  queueDepth: number;
  details?: Record<string, unknown>;
};

type Handler = (message: Record<string, unknown>) => void | Promise<void>;

export class QueueService {
  private static instance: QueueService | null = null;
  private provider: QueueProvider = "memory";
  private emitter = new EventEmitter();
  private memoryQueues = new Map<string, Record<string, unknown>[]>();
  private connected = false;
  private client: unknown;
  private cluster = QueueCluster.getInstance();

  static async getInstance() {
    if (!this.instance) {
      const service = new QueueService();
      await service.initialize();
      this.instance = service;
    }
    return this.instance;
  }

  private async initialize() {
    const provider = (process.env.QUEUE_PROVIDER as QueueProvider | undefined) ?? "memory";
    this.provider = provider;

    if (process.env.QUEUE_CLUSTER_MODE === "true") {
      const nodeId = process.env.QUEUE_CLUSTER_NODE_ID ?? `node-${Math.random().toString(36).slice(2, 8)}`;
      const host = process.env.QUEUE_CLUSTER_HOST ?? "localhost";
      const role = (process.env.QUEUE_CLUSTER_ROLE as ClusterNode["role"] | undefined) ?? "worker";
      this.cluster.register({ id: nodeId, host, role });
    }

    switch (provider) {
      case "redis": {
        try {
          const redis = await import("redis");
          const url = process.env.REDIS_URL ?? "redis://localhost:6379";
          const publisher = redis.createClient({ url });
          const subscriber = redis.createClient({ url });
          await publisher.connect();
          await subscriber.connect();
          subscriber.on("error", (error: unknown) => {
            Logger.error("Redis subscriber error", error);
          });
          this.client = { publisher, subscriber };
          this.connected = true;
        } catch (error) {
          Logger.warn("Falling back to in-memory queue (redis failure)", error);
          this.provider = "memory";
        }
        break;
      }
      case "nats": {
        try {
          const nats = await import("nats");
          const connection = await nats.connect({ servers: process.env.NATS_URL ?? "nats://localhost:4222" });
          this.client = connection;
          this.connected = true;
        } catch (error) {
          Logger.warn("Falling back to in-memory queue (nats failure)", error);
          this.provider = "memory";
        }
        break;
      }
      case "rabbitmq": {
        try {
          const amqp = await import("amqplib");
          const url = process.env.RABBITMQ_URL ?? "amqp://localhost";
          const connection = await amqp.connect(url);
          const channel = await connection.createChannel();
          this.client = { connection, channel };
          this.connected = true;
        } catch (error) {
          Logger.warn("Falling back to in-memory queue (rabbitmq failure)", error);
          this.provider = "memory";
        }
        break;
      }
      default: {
        this.provider = "memory";
        this.connected = true;
      }
    }
  }

  async publish(queueName: string, message: Record<string, unknown>) {
    Telemetry.adjustQueueDepth(queueName, 1);
    switch (this.provider) {
      case "redis": {
        const { publisher } = this.client as { publisher: any };
        await publisher.publish(queueName, JSON.stringify(message));
        break;
      }
      case "nats": {
        const connection = this.client as { publish: (subject: string, data: Uint8Array) => void };
        connection.publish(queueName, Buffer.from(JSON.stringify(message)));
        break;
      }
      case "rabbitmq": {
        const { channel } = this.client as { channel: any };
        await channel.assertQueue(queueName, { durable: false });
        channel.sendToQueue(queueName, Buffer.from(JSON.stringify(message)));
        break;
      }
      default: {
        const queue = this.memoryQueues.get(queueName) ?? [];
        queue.push(message);
        this.memoryQueues.set(queueName, queue);
        this.emitter.emit(queueName, message);
      }
    }
  }

  async subscribe(queueName: string, handler: Handler) {
    switch (this.provider) {
      case "redis": {
        const { subscriber } = this.client as { subscriber: any };
        await subscriber.subscribe(queueName, async (payload: string) => {
          const parsed = JSON.parse(payload) as Record<string, unknown>;
          await handler(parsed);
          Telemetry.adjustQueueDepth(queueName, -1);
        });
        break;
      }
      case "nats": {
        const connection = this.client as { subscribe: (subject: string) => AsyncIterableIterator<any> };
        const sub = connection.subscribe(queueName);
        (async () => {
          for await (const message of sub) {
            const data = message.data ? Buffer.from(message.data).toString() : "{}";
            await handler(JSON.parse(data));
            Telemetry.adjustQueueDepth(queueName, -1);
          }
        })().catch((error) => Logger.error("NATS subscription error", error));
        break;
      }
      case "rabbitmq": {
        const { channel } = this.client as { channel: any };
        await channel.assertQueue(queueName, { durable: false });
        await channel.consume(queueName, async (msg: any) => {
          if (!msg) return;
          await handler(JSON.parse(msg.content.toString()));
          channel.ack(msg);
          Telemetry.adjustQueueDepth(queueName, -1);
        });
        break;
      }
      default: {
        this.emitter.on(queueName, handler);
        const queue = this.memoryQueues.get(queueName) ?? [];
        while (queue.length > 0) {
          const item = queue.shift();
          if (item) {
            await handler(item);
            Telemetry.adjustQueueDepth(queueName, -1);
          }
        }
      }
    }
  }

  async getMetrics(): Promise<QueueMetrics> {
    let queueDepth = 0;
    if (this.provider === "memory") {
      for (const queue of this.memoryQueues.values()) {
        queueDepth += queue.length;
      }
    }
    return {
      provider: this.provider,
      connected: this.connected,
      queueDepth,
      details: { provider: this.provider }
    } satisfies QueueMetrics;
  }
}
