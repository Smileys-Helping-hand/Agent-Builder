/**
 * The builder's own settings, from the app: which model writes and reviews
 * code, how orders are handled, where projects live. Each is a line in .env;
 * changing one here rewrites only that line and applies it to the running
 * process (see EnvFile), so almost nothing needs a restart.
 *
 *   GET /api/settings/builder   every setting with its current value and choices
 *   PUT /api/settings/builder   { values: { NAME: value, ... } }  (execute key)
 *
 * Only the names listed below can be read or written. Secrets (keys, tokens)
 * are never listed: this route can neither show nor change them.
 */
import fs from "fs";
import type { Express, Request, Response } from "express";

import { authenticateAgent, type AgentRequest } from "./agentAuth.js";
import { setEnvValues } from "../utils/EnvFile.js";
import { checkOllama } from "../utils/Ollama.js";
import { Logger } from "../utils/Logger.js";
import { OrderPipeline } from "../orders/OrderPipeline.js";

type Kind = "model" | "bool" | "number" | "text" | "choice";

interface Setting {
  name: string;
  group: "Models" | "Orders" | "Projects" | "Site";
  label: string;
  help: string;
  kind: Kind;
  fallback: string;
  choices?: string[];
  min?: number;
  max?: number;
  /** Read once at start, so a change needs the builder restarted. */
  restart?: boolean;
  /** Checked before saving; returns a reason when the value is not usable. */
  check?: (value: string) => string | null;
}

const needsKey = (value: string): string | null => {
  if (value === "anthropic" && !process.env.ANTHROPIC_API_KEY?.trim()) {
    return "Add ANTHROPIC_API_KEY=… to the .env file on the PC first (keys are never set from the app), then choose Claude.";
  }
  if (value === "openai" && !process.env.OPENAI_API_KEY?.trim()) {
    return "Add OPENAI_API_KEY=… to the .env file on the PC first, then choose OpenAI.";
  }
  return null;
};

const SETTINGS: Setting[] = [
  {
    name: "MODEL_PROVIDER",
    group: "Models",
    label: "Who writes the code",
    help: "ollama: the model on this PC (free, private, limited by its 8 GB graphics card). anthropic: Claude in the cloud — far stronger code, costs per build, needs ANTHROPIC_API_KEY in .env.",
    kind: "choice",
    choices: ["ollama", "anthropic", "openai"],
    fallback: "ollama",
    check: needsKey
  },
  {
    name: "ORDER_MODEL_PROVIDER",
    group: "Models",
    label: "Who writes customer orders",
    help: "Give paid client work the strongest model while your own builds stay on this PC. same: whatever writes everything else.",
    kind: "choice",
    choices: ["same", "anthropic", "openai", "ollama"],
    fallback: "same",
    check: needsKey
  },
  {
    name: "ANTHROPIC_MODEL",
    group: "Models",
    label: "Which Claude",
    help: "Sonnet: the best value for building apps. Opus: the strongest, slower and dearer. Haiku: quick and cheap.",
    kind: "choice",
    choices: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"],
    fallback: "claude-sonnet-5-5"
  },
  {
    name: "OLLAMA_MODEL",
    group: "Models",
    label: "Model that writes the code",
    help: "Every pass, repair and improvement. A bigger model writes better code but more slowly and needs more GPU memory.",
    kind: "model",
    fallback: "qwen2.5-coder:7b"
  },
  {
    name: "DEEP_REVIEW_MODEL",
    group: "Models",
    label: "Model that reviews a failure (Deep effort)",
    help: "Only in Deep builds: before each repair it explains what went wrong, in a few sentences, for the writer to act on.",
    kind: "model",
    fallback: "qwen2.5-coder:14b"
  },
  {
    name: "OLLAMA_KEEP_ALIVE",
    group: "Models",
    label: "Keep the model loaded for",
    help: "How long the model stays in GPU memory after it was last used. Longer is faster between passes; shorter frees the GPU sooner.",
    kind: "choice",
    choices: ["5m", "15m", "30m", "1h", "4h", "-1"],
    fallback: "30m"
  },
  {
    name: "OLLAMA_NUM_CTX",
    group: "Models",
    label: "How much the model can read at once (tokens)",
    help: "Build prompts run to about 10 000 tokens; anything past this limit is cut from the start, instructions first. Bigger needs more GPU memory.",
    kind: "choice",
    choices: ["8192", "16384", "32768"],
    fallback: "16384"
  },
  {
    name: "ORDERS_MODE",
    group: "Orders",
    label: "Taking orders",
    help: "Launching soon: the Consolidated Hub is told orders are not open yet (it shows your message instead of checkout), and no customer build starts by itself. You can still build any order by hand to test.",
    kind: "choice",
    choices: ["open", "launching-soon"],
    fallback: "open"
  },
  {
    name: "ORDERS_LAUNCH_MESSAGE",
    group: "Orders",
    label: "Launching-soon message",
    help: "What the Hub shows customers while orders are not open. Leave empty for its own wording.",
    kind: "text",
    fallback: ""
  },
  {
    name: "ORDER_AUTO_START",
    group: "Orders",
    label: "Start accepted orders by themselves",
    help: "Off: accepted orders wait until you press Build it now.",
    kind: "bool",
    fallback: "true"
  },
  {
    name: "ORDER_AUTO_ACCEPT_PAID",
    group: "Orders",
    label: "Queue orders paid for on the site",
    help: "A customer who has paid skips New and goes straight into the build queue.",
    kind: "bool",
    fallback: "true"
  },
  {
    name: "ORDER_AUTO_IMPROVE",
    group: "Orders",
    label: "Keep improving delivered work",
    help: "Every few hours the lowest-scoring delivered product gets another pass, when nothing else is waiting.",
    kind: "bool",
    fallback: "true"
  },
  {
    name: "ORDER_MAX_CONCURRENT_BUILDS",
    group: "Orders",
    label: "Customer builds at once",
    help: "One GPU does one build well. Raise it only with the memory to spare.",
    kind: "number",
    min: 1,
    max: 4,
    fallback: "1"
  },
  {
    name: "SITE_URL",
    group: "Site",
    label: "Ordering site",
    help: "Where customer orders come from and templates are published. Its key is set in .env on the PC, never here.",
    kind: "text",
    fallback: "https://arpcloudsolutions.co.za",
    check: (value) => (/^https:\/\/[\w.-]+(:\d+)?\/?$/.test(value) ? null : "Give the site's https address, like https://arpcloudsolutions.co.za")
  },
  {
    name: "ECOSYSTEM_ROOTS",
    group: "Projects",
    label: "Project folders",
    help: "Comma-separated folders scanned for projects (two levels deep). Clones land in the first one with \"Projects\" in its name.",
    kind: "text",
    fallback: "H:/ts,E:/Projects,K:/Projects",
    restart: true,
    check: (value) => {
      const roots = value.split(",").map((root) => root.trim()).filter(Boolean);
      if (roots.length === 0) return "Give at least one folder.";
      const missing = roots.filter((root) => !fs.existsSync(root));
      return missing.length === roots.length ? `None of those folders exist on this PC (${missing.join(", ")}).` : null;
    }
  }
];

const BY_NAME = new Map(SETTINGS.map((setting) => [setting.name, setting]));

const normalise = (setting: Setting, raw: unknown, models: string[]): { value?: string; error?: string } => {
  const text = typeof raw === "boolean" || typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  switch (setting.kind) {
    case "bool":
      if (!/^(true|false)$/.test(text)) return { error: `${setting.label}: on or off.` };
      return { value: text };
    case "number": {
      const n = Number(text);
      if (!Number.isInteger(n) || n < (setting.min ?? -Infinity) || n > (setting.max ?? Infinity)) {
        return { error: `${setting.label}: a whole number from ${setting.min} to ${setting.max}.` };
      }
      return { value: String(n) };
    }
    case "choice":
      return setting.choices?.includes(text) ? { value: text } : { error: `${setting.label}: one of ${setting.choices?.join(", ")}.` };
    case "model":
      // A model that is not installed would fail every build; refuse it here.
      if (models.length > 0 && !models.includes(text)) return { error: `${setting.label}: ${text} is not installed (ollama pull ${text}).` };
      return text ? { value: text } : { error: `${setting.label}: pick a model.` };
    default: {
      if (!text) return { error: `${setting.label}: cannot be empty.` };
      const reason = setting.check?.(text);
      return reason ? { error: reason } : { value: text };
    }
  }
};

export const registerBuilderSettingsRoutes = (app: Express) => {
  app.get("/api/settings/builder", authenticateAgent("read"), async (_req: Request, res: Response) => {
    const { models, state } = await checkOllama();
    res.json({
      models,
      ollama: state,
      settings: SETTINGS.map(({ check: _check, ...setting }) => ({
        ...setting,
        value: process.env[setting.name]?.trim() || setting.fallback,
        isDefault: !process.env[setting.name]?.trim()
      }))
    });
  });

  app.put("/api/settings/builder", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const incoming = (req.body?.values ?? {}) as Record<string, unknown>;
    const names = Object.keys(incoming);
    if (names.length === 0) return res.status(400).json({ error: "Nothing to change." });

    const { models } = await checkOllama();
    const values: Record<string, string> = {};
    const errors: string[] = [];
    for (const name of names) {
      const setting = BY_NAME.get(name);
      if (!setting) {
        errors.push(`${name} cannot be changed from the app.`);
        continue;
      }
      const { value, error } = normalise(setting, incoming[name], models);
      if (error) errors.push(error);
      else if (value !== undefined) values[name] = value;
    }
    if (errors.length) return res.status(400).json({ error: errors.join(" ") });

    try {
      setEnvValues(values);
    } catch (error) {
      return res.status(500).json({ error: `Could not save .env: ${error instanceof Error ? error.message : String(error)}` });
    }
    Logger.log("Builder settings changed", { by: (req as AgentRequest).actor ?? "app", changed: Object.keys(values) });
    // The Hub shows "launching soon" from the check-in, so tell it now rather
    // than at the next one, minutes away.
    if ("ORDERS_MODE" in values || "ORDERS_LAUNCH_MESSAGE" in values) void OrderPipeline.publish().catch(() => undefined);
    const needsRestart = Object.keys(values).filter((name) => BY_NAME.get(name)?.restart);
    res.json({
      success: true,
      changed: Object.keys(values),
      message: needsRestart.length
        ? `Saved. ${needsRestart.map((name) => BY_NAME.get(name)!.label).join(", ")} takes effect after the builder restarts.`
        : "Saved, and in effect now."
    });
  });
};
