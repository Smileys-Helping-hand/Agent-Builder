import { EventEmitter } from "events";
import { Logger } from "../utils/Logger.js";

export type ClusterNode = {
  id: string;
  host: string;
  role: "leader" | "worker";
  connectedAt: string;
};

export class QueueCluster extends EventEmitter {
  private static instance: QueueCluster | null = null;
  private nodes = new Map<string, ClusterNode>();
  private leaderId: string | null = null;

  static getInstance(): QueueCluster {
    if (!this.instance) {
      this.instance = new QueueCluster();
    }
    return this.instance;
  }

  register(node: Omit<ClusterNode, "connectedAt">): ClusterNode {
    const connectedAt = new Date().toISOString();
    const record: ClusterNode = { ...node, connectedAt };
    this.nodes.set(node.id, record);
    if (node.role === "leader") {
      this.leaderId = node.id;
      this.emit("leader", record);
    }
    Logger.log("QueueCluster", `registered node ${node.id} (${node.role})`);
    this.emit("join", record);
    return record;
  }

  unregister(nodeId: string) {
    if (this.nodes.has(nodeId)) {
      const record = this.nodes.get(nodeId)!;
      this.nodes.delete(nodeId);
      this.emit("leave", record);
      if (this.leaderId === nodeId) {
        this.leaderId = null;
        this.emit("leader", null);
      }
    }
  }

  getNodes(): ClusterNode[] {
    return Array.from(this.nodes.values());
  }

  getLeader(): ClusterNode | null {
    if (!this.leaderId) {
      return null;
    }
    return this.nodes.get(this.leaderId) ?? null;
  }
}
