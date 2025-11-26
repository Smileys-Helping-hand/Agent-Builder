import fs from "fs";
import path from "path";
import { applySettingsToEnv, getSettings } from "../src/server/settings/SettingsStore.js";
import { Logger } from "../src/utils/Logger.js";

(async () => {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, "", "utf-8");
    Logger.log("Created missing .env file");
  }

  const settings = getSettings();
  applySettingsToEnv(settings);
  Logger.log("Environment regenerated from settings.json with defaults applied");
})();
