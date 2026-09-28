// bcryptjs rather than bcrypt: same algorithm and same $2a$/$2b$ hash format
// (existing stored hashes keep verifying), but pure JavaScript. The native
// bcrypt addon needs a compiler at install time and cannot be embedded into a
// single-file executable, which blocks packaging the API as a desktop sidecar.
import bcrypt from "bcryptjs";

export const Hash = {
  make(password: string) {
    return bcrypt.hashSync(password, 10);
  },

  verify(password: string, hash: string) {
    return bcrypt.compareSync(password, hash);
  }
};

export default Hash;
