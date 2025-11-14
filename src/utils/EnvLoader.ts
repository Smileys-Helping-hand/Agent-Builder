import fs from "fs";
import path from "path";

const DYNAMIC_ENV_PATH = path.resolve(".env.dynamic");

type EnvMap = Record<string, string>;

export const loadDynamicEnv = (): EnvMap => {
  if (!fs.existsSync(DYNAMIC_ENV_PATH)) {
    return {};
  }
  const raw = fs.readFileSync(DYNAMIC_ENV_PATH, "utf8");
  return Object.fromEntries(
    raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => {
        const [key, ...rest] = line.split("=");
        return [key, rest.join("=")];
      })
  );
};

export const syncDynamicEnv = () => {
  const values = loadDynamicEnv();
  for (const [key, value] of Object.entries(values)) {
    if (typeof process.env[key] === "undefined") {
      process.env[key] = value;
    }
  }
};
