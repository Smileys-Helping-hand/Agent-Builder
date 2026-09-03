/**
 * Create or reset an owner-role account.
 *
 * Usage:
 *   tsx scripts/setupSuperAdmin.ts <email> <password>
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... tsx scripts/setupSuperAdmin.ts
 *
 * No credentials are hardcoded here — you must supply them explicitly.
 */
import { UserModel } from "../src/models/UserModel.js";
import { Hash } from "../src/utils/hash.js";

const [argEmail, argPassword] = process.argv.slice(2);
const email = argEmail ?? process.env.ADMIN_EMAIL;
const password = argPassword ?? process.env.ADMIN_PASSWORD;

if (!email || !password) {
  console.error(
    "Usage: tsx scripts/setupSuperAdmin.ts <email> <password>\n" +
    "  (or set ADMIN_EMAIL / ADMIN_PASSWORD in the environment)"
  );
  process.exit(1);
}

if (password.length < 12) {
  console.error("Refusing to set a password shorter than 12 characters.");
  process.exit(1);
}

const setupSuperAdmin = (targetEmail: string, targetPassword: string) => {
  const role = "owner";
  const passwordHash = Hash.make(targetPassword);

  const existing = UserModel.findByEmail(targetEmail);
  if (!existing) {
    UserModel.create(targetEmail, passwordHash, role);
    console.log(`Created owner account '${targetEmail}'`);
  } else {
    UserModel.updateCredentials(existing.id, { passwordHash, role });
    console.log(`Updated owner account '${targetEmail}'`);
  }
};

setupSuperAdmin(email, password);
