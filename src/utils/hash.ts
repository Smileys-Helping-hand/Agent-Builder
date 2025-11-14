import bcrypt from "bcrypt";

export const Hash = {
  make(password: string) {
    return bcrypt.hashSync(password, 10);
  },

  verify(password: string, hash: string) {
    return bcrypt.compareSync(password, hash);
  }
};

export default Hash;
