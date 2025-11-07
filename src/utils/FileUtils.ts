import fs from "fs";
import path from "path";

export class FileUtils {
  static ensureDir(dirPath: string) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  static writeFile(filePath: string, content: string) {
    this.ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, "utf8");
  }
}
