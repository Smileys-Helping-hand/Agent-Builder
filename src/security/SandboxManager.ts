import type { PolicyRule } from "./PolicyEngine.js";
import { PolicyEngine } from "./PolicyEngine.js";

export type SandboxRequest = {
  image: string;
  command?: string;
  privileged?: boolean;
  runtimeSeconds?: number;
};

export class SandboxManager {
  static async validate(request: SandboxRequest) {
    const engine = await PolicyEngine.getInstance();
    const effect = engine.evaluate("container.run", {
      image: request.image,
      privileged: Boolean(request.privileged),
      maxRuntimeSeconds: request.runtimeSeconds ?? 60
    });

    if (effect === "deny") {
      throw new Error(`Policy denied container run for image ${request.image}`);
    }

    return true;
  }

  static async listPolicies(): Promise<PolicyRule[]> {
    const engine = await PolicyEngine.getInstance();
    return engine.listRules();
  }
}
