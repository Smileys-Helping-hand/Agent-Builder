/**
 * Mint (or rotate) an agent key.
 *
 *   npm run key:agent -- --name jarvis --scopes read,write,execute
 *
 * The key is printed once and only its hash is stored, so it cannot be
 * recovered later — rerun this command to rotate it, which invalidates the old
 * one immediately.
 */
import "dotenv/config";

import { AgentKeyModel, type AgentScope } from "../src/models/AgentKeyModel.js";

const args = process.argv.slice(2);
const valueFor = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const name = valueFor("--name") ?? "jarvis";
const requested = (valueFor("--scopes") ?? "read,write,execute")
  .split(",")
  .map((scope) => scope.trim())
  .filter(Boolean);

const valid: AgentScope[] = ["read", "write", "execute"];
const scopes = requested.filter((scope): scope is AgentScope => valid.includes(scope as AgentScope));

if (scopes.length !== requested.length) {
  console.error(`Unknown scope(s). Valid scopes: ${valid.join(", ")}`);
  process.exit(1);
}

if (args.includes("--list")) {
  console.table(AgentKeyModel.list());
  process.exit(0);
}

if (args.includes("--revoke")) {
  const revoked = AgentKeyModel.revoke(name);
  console.log(revoked ? `Revoked the key for "${name}".` : `No active key named "${name}".`);
  process.exit(revoked ? 0 : 1);
}

const { key, secret } = AgentKeyModel.issue(name, scopes);
const port = process.env.PORT ?? "4000";

console.log("");
console.log(`Agent key for "${key.name}" (scopes: ${key.scopes.join(", ")})`);
console.log("");
console.log(`  ${secret}`);
console.log("");
console.log("Shown once — it is stored only as a hash. Rerun this command to rotate it.");
console.log("");
console.log("Use it as a header against this machine's API:");
console.log("");
console.log(`  curl -H "x-agent-key: ${secret}" http://127.0.0.1:${port}/api/ecosystem/handoff?format=markdown`);
console.log("");
