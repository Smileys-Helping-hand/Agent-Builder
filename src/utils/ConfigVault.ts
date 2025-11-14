import crypto from "crypto";
import fs from "fs";
import path from "path";

export type EncryptedConfig = {
  workspaceName: string;
  adminEmail: string;
  adminRole: "owner" | "admin";
  aiProvider: string;
  providerKey?: string;
  createdAt: string;
  passwordHash: string;
};

const CONFIG_PATH = path.resolve("data/config.json");
const ENCODING = "base64";

const resolveKey = () => {
  const secret = process.env.CONFIG_SECRET ?? "agent-builder-config";
  return crypto.createHash("sha256").update(secret).digest();
};

const ensureDirectory = () => {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
};

const encrypt = (payload: EncryptedConfig) => {
  const iv = crypto.randomBytes(12);
  const key = resolveKey();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const serialized = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(serialized), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString(ENCODING),
    tag: tag.toString(ENCODING),
    data: encrypted.toString(ENCODING)
  });
};

const decrypt = (raw: string): EncryptedConfig => {
  const parsed = JSON.parse(raw) as { iv: string; tag: string; data: string };
  const key = resolveKey();
  const iv = Buffer.from(parsed.iv, ENCODING);
  const tag = Buffer.from(parsed.tag, ENCODING);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsed.data, ENCODING)),
    decipher.final()
  ]);
  return JSON.parse(decrypted.toString("utf8")) as EncryptedConfig;
};

export const ConfigVault = {
  isConfigured(): boolean {
    return fs.existsSync(CONFIG_PATH);
  },

  load(): EncryptedConfig | null {
    try {
      if (!this.isConfigured()) {
        return null;
      }
      const raw = fs.readFileSync(CONFIG_PATH, "utf8");
      return decrypt(raw);
    } catch (error) {
      console.warn("Failed to load configuration:", error);
      return null;
    }
  },

  save(config: EncryptedConfig) {
    ensureDirectory();
    const payload = encrypt(config);
    fs.writeFileSync(CONFIG_PATH, payload, "utf8");
  }
};
