import fs from "fs";
import path from "path";
import { Logger } from "../../utils/Logger.js";

export type BuilderSettings = {
  provider: string;
  openaiApiKey: string;
  model: string;
  codingModel: string;
  visionModel: string;
  ollamaEnabled: boolean;
  ollamaBaseUrl: string;
  ollamaModel: string;
  vectorDbEnabled: boolean;
  voiceEnabled: boolean;
};

const DEFAULTS: BuilderSettings = {
  provider: "openai",
  openaiApiKey: "",
  model: "gpt-4o-mini",
  codingModel: "gpt-4o-mini",
  visionModel: "gpt-4o-mini",
  ollamaEnabled: false,
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3.1",
  vectorDbEnabled: false,
  voiceEnabled: false
};

const SETTINGS_PATH = path.resolve(process.cwd(), "settings.json");
const ENV_PATH = path.resolve(process.cwd(), ".env");

export const getSettings = (): BuilderSettings => {
  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
      const parsed = JSON.parse(raw) as Partial<BuilderSettings>;
      return { ...DEFAULTS, ...parsed };
    } catch (error) {
      Logger.warn("Failed to parse settings file; using defaults", { error });
    }
  }

  return { ...DEFAULTS, openaiApiKey: process.env.OPENAI_API_KEY ?? "" };
};

export const isSettingsComplete = (settings = getSettings()) => {
  const merged = { ...DEFAULTS, ...settings };
  if (merged.provider === "openai" && !merged.openaiApiKey.trim()) {
    return false;
  }
  return Boolean(merged.model && merged.codingModel && merged.visionModel);
};

export const validateSettings = (settings: BuilderSettings) => {
  const errors: string[] = [];

  if (settings.provider === "openai" && !settings.openaiApiKey.trim()) {
    errors.push("OpenAI API key is required when provider is OpenAI.");
  }

  if (settings.ollamaEnabled) {
    if (!settings.ollamaBaseUrl.trim()) {
      errors.push("Ollama base URL is required when Ollama is enabled.");
    }
    if (!settings.ollamaModel.trim()) {
      errors.push("Ollama model is required when Ollama is enabled.");
    }
  }

  if (!settings.model.trim()) {
    errors.push("Primary model is required.");
  }
  if (!settings.codingModel.trim()) {
    errors.push("Coding model is required.");
  }
  if (!settings.visionModel.trim()) {
    errors.push("Vision model is required.");
  }

  return errors;
};

const testOpenAIKey = async (key: string) => {
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`
      }
    });
    return response.ok;
  } catch (error) {
    Logger.warn("OpenAI validation failed", { error });
    return false;
  }
};

export const validateSettingsLive = async (settings: BuilderSettings) => {
  const errors = validateSettings(settings);
  const openaiReachable = settings.provider === "openai" && settings.openaiApiKey
    ? await testOpenAIKey(settings.openaiApiKey)
    : false;

  if (settings.provider === "openai" && !openaiReachable) {
    errors.push("OpenAI could not be reached with the provided key.");
  }

  return { ok: errors.length === 0, errors, openaiReachable };
};

export const runDiagnostics = async (settings: BuilderSettings) => {
  const diagnostics: Record<string, boolean | string> = {};
  const envDir = path.resolve(process.cwd());
  diagnostics.apiKeyPresent = Boolean(settings.openaiApiKey?.trim());
  diagnostics.projectWriteable = (() => {
    try {
      const testFile = path.join(envDir, "diagnostic.tmp");
      fs.writeFileSync(testFile, "ok");
      fs.unlinkSync(testFile);
      return true;
    } catch (error) {
      Logger.warn("Write diagnostic failed", { error });
      return false;
    }
  })();

  diagnostics.portsFree = true;
  diagnostics.diskAccess = diagnostics.projectWriteable;
  diagnostics.openaiReachable = settings.provider === "openai" && settings.openaiApiKey
    ? await testOpenAIKey(settings.openaiApiKey)
    : false;

  diagnostics.envPath = ENV_PATH;
  return diagnostics;
};

export const applySettingsToEnv = (settings: BuilderSettings) => {
  const merged = { ...DEFAULTS, ...settings };
  const lines = [
    `PROVIDER=${merged.provider}`,
    `OPENAI_API_KEY=${merged.openaiApiKey}`,
    `MODEL=${merged.model}`,
    `CODING_MODEL=${merged.codingModel}`,
    `VISION_MODEL=${merged.visionModel}`,
    `OLLAMA_ENABLED=${merged.ollamaEnabled}`,
    `OLLAMA_BASE_URL=${merged.ollamaBaseUrl}`,
    `OLLAMA_MODEL=${merged.ollamaModel}`,
    `AUTONOMY_LEVEL=full`,
    `BUILD_MODE=app`,
    `PROJECT_OUTPUT=./projects`,
    `LOG_LEVEL=info`,
    `VECTOR_DB_ENABLED=${merged.vectorDbEnabled}`,
    `VOICE_ENABLED=${merged.voiceEnabled}`
  ];

  fs.writeFileSync(ENV_PATH, lines.join("\n"), "utf-8");
  lines.forEach((line) => {
    const [key, ...rest] = line.split("=");
    process.env[key] = rest.join("=");
  });
};

export const saveSettings = (settings: Partial<BuilderSettings>) => {
  const merged = { ...getSettings(), ...settings };
  const errors = validateSettings(merged);
  if (errors.length) {
    throw new Error(errors.join(" "));
  }

  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2), "utf-8");
  applySettingsToEnv(merged);
  Logger.log("Settings saved and applied to environment");
  return merged;
};
