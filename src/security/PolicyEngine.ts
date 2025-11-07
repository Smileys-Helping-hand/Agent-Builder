import fs from "fs";
import path from "path";
import YAML from "yaml";

export type PolicyRule = {
  id: string;
  description: string;
  action: string;
  effect: "allow" | "deny";
  conditions?: Record<string, unknown>;
};

type PolicyDocument = {
  revision: string;
  rules: PolicyRule[];
};

const DEFAULT_POLICY: PolicyDocument = {
  revision: "local",
  rules: [
    {
      id: "sandbox-default",
      description: "Allow read-only operations by default",
      action: "container.run",
      effect: "allow",
      conditions: { maxRuntimeSeconds: 300 }
    }
  ]
};

const POLICY_PATH = path.resolve("policy.yaml");

export class PolicyEngine {
  private static instance: PolicyEngine | null = null;
  private document: PolicyDocument = DEFAULT_POLICY;

  static async getInstance() {
    if (!this.instance) {
      const engine = new PolicyEngine();
      await engine.load();
      this.instance = engine;
    }
    return this.instance;
  }

  private async load() {
    try {
      const contents = await fs.promises.readFile(POLICY_PATH, "utf8");
      const parsed = YAML.parse(contents) as Partial<PolicyDocument> | undefined;
      if (parsed && Array.isArray(parsed.rules)) {
        this.document = {
          revision: parsed.revision ?? DEFAULT_POLICY.revision,
          rules: parsed.rules as PolicyRule[]
        };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      // Write default policy for first-time setup
      await fs.promises.writeFile(POLICY_PATH, YAML.stringify(DEFAULT_POLICY));
      this.document = DEFAULT_POLICY;
    }
  }

  getRevision() {
    return this.document.revision;
  }

  countRules() {
    return this.document.rules.length;
  }

  listRules() {
    return this.document.rules;
  }

  evaluate(action: string, context: Record<string, unknown> = {}) {
    const matching = this.document.rules.filter((rule) => rule.action === action);
    for (const rule of matching) {
      if (!rule.conditions) {
        return rule.effect;
      }
      const conditionEntries = Object.entries(rule.conditions);
      const satisfied = conditionEntries.every(([key, expected]) => {
        const actual = context[key];
        if (typeof expected === "number" && typeof actual === "number") {
          return actual <= expected;
        }
        if (Array.isArray(expected)) {
          if (Array.isArray(actual)) {
            return actual.every((value) => expected.includes(value));
          }
          return expected.includes(actual as string);
        }
        return expected === actual;
      });
      if (satisfied) {
        return rule.effect;
      }
    }
    return "allow";
  }
}
