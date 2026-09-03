import { UserModel } from "../src/models/UserModel.js";
import { Hash } from "../src/utils/hash.js";

const setupSuperAdmin = () => {
  const username = "mraaziqp";
  const email = "mraaziqp@gmail.com";
  const password = "114477";
  const role = "owner";
  const passwordHash = Hash.make(password);

  // Create or update username record
  const user1 = UserModel.findByEmail(username);
  if (!user1) {
    UserModel.create(username, passwordHash, role);
    console.log(`Created super admin user '${username}'`);
  } else {
    UserModel.updateCredentials(user1.id, { passwordHash, role });
    console.log(`Updated super admin user '${username}'`);
  }

  // Create or update email record
  const user2 = UserModel.findByEmail(email);
  if (!user2) {
    UserModel.create(email, passwordHash, role);
    console.log(`Created super admin user '${email}'`);
  } else {
    UserModel.updateCredentials(user2.id, { passwordHash, role });
    console.log(`Updated super admin user '${email}'`);
  }

  console.log("All users in DB:", UserModel.getAll());
};

setupSuperAdmin();
