/**
 * Prints how to connect a phone to this machine — as a QR code.
 *
 * Typing a 64-character key on a phone is miserable, so the launcher shows a QR
 * that already contains the address and the key. Scanning it opens the web app,
 * which stores both and drops them out of the address bar.
 *
 * The key is minted once and kept in data/phone-key.txt so the same QR keeps
 * working across restarts; delete that file to force a new one.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

import QRCode from "qrcode";

import { AgentKeyModel } from "../../src/models/AgentKeyModel.js";

const APP_URL = process.env.REMOTE_APP_URL ?? "https://builder.arpcloudsolutions.co.za";
const KEY_FILE = path.resolve("data/phone-key.txt");
const URL_FILE = path.resolve("data/remote-url.txt");

const keyForPhone = (): string => {
  if (fs.existsSync(KEY_FILE)) {
    const existing = fs.readFileSync(KEY_FILE, "utf8").replace(/^﻿/, "").trim();
    // Only reuse it if the server still recognises it (the key may have been
    // rotated or revoked since it was written).
    if (existing && AgentKeyModel.verify(existing)) return existing;
  }
  const { secret } = AgentKeyModel.issue("phone", ["read", "write", "execute"]);
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, secret, "utf8");
  return secret;
};

const address = (): string => {
  const fromArgument = process.argv.find((argument) => argument.startsWith("http"));
  if (fromArgument) return fromArgument.replace(/\/+$/, "");
  if (fs.existsSync(URL_FILE)) {
    const saved = fs.readFileSync(URL_FILE, "utf8").replace(/^﻿/, "").trim();
    if (saved.startsWith("http")) return saved.replace(/\/+$/, "");
  }
  return `http://127.0.0.1:${process.env.PORT ?? 4000}`;
};

const machine = address();
const secret = keyForPhone();
const link = `${APP_URL}/settings/?address=${encodeURIComponent(machine)}&key=${encodeURIComponent(secret)}`;

const qr = await QRCode.toString(link, { type: "terminal", small: true, errorCorrectionLevel: "L" });

console.log("");
console.log("  Scan this with your phone's camera to connect it:");
console.log("");
console.log(qr);
console.log(`  App:     ${APP_URL}`);
console.log(`  Machine: ${machine}`);
console.log(`  Key:     ${secret.slice(0, 12)}… (stored in data/phone-key.txt)`);
console.log("");
if (machine.includes("127.0.0.1")) {
  console.log("  Note: that is a local address — it only works on this PC.");
  console.log("  Start the launcher with a tunnel for an address that works anywhere.");
  console.log("");
}
