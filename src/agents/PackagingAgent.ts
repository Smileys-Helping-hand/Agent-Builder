import { Logger } from "../utils/Logger.js";
import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface PackageOptions {
  buildId: string;
  artifacts: string[];
  platforms: string[];
  outputDir: string;
}

export interface Package {
  platform: string;
  path: string;
  size: number;
  type: string;
}

export class PackagingAgent {
  
  /**
   * Package application for multiple platforms
   */
  async package(options: PackageOptions): Promise<Package[]> {
    Logger.log("Starting packaging process", { 
      buildId: options.buildId,
      platforms: options.platforms 
    });

    const packages: Package[] = [];

    for (const platform of options.platforms) {
      try {
        const pkg = await this.packageForPlatform(platform, options);
        packages.push(pkg);
      } catch (error: any) {
        Logger.error(`Failed to package for ${platform}`, { error: error.message });
      }
    }

    Logger.log("Packaging complete", { 
      packageCount: packages.length,
      totalSize: packages.reduce((sum, p) => sum + p.size, 0) 
    });

    return packages;
  }

  /**
   * Package for specific platform
   */
  private async packageForPlatform(
    platform: string,
    options: PackageOptions
  ): Promise<Package> {
    
    Logger.log(`Packaging for ${platform}`);

    switch (platform.toLowerCase()) {
      case "windows":
        return this.packageWindows(options);
      case "macos":
      case "mac":
        return this.packageMac(options);
      case "linux":
        return this.packageLinux(options);
      case "web":
        return this.packageWeb(options);
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  /**
   * Create Windows executable
   */
  private async packageWindows(options: PackageOptions): Promise<Package> {
    const outputPath = path.join(options.outputDir, "windows");
    await fs.mkdir(outputPath, { recursive: true });

    // Create package.json if not exists
    await this.ensurePackageJson(options.outputDir);

    // Bundle with pkg for Windows
    const exePath = path.join(outputPath, `${options.buildId}.exe`);
    
    try {
      // Try using pkg if available. cwd is the generated project's own
      // directory — `pkg .` without it runs in Agent-Builder's own cwd and
      // packages Agent-Builder itself instead of the generated app.
      await execAsync(`npx pkg . --targets node18-win-x64 --output "${exePath}"`, { cwd: options.outputDir });
    } catch (error) {
      // Fallback: Create a portable package with node
      Logger.warn("pkg not available, creating portable package");
      await this.createPortablePackage(options.outputDir, outputPath, "win");
    }

    const stats = await fs.stat(exePath);

    return {
      platform: "windows",
      path: exePath,
      size: stats.size,
      type: "exe"
    };
  }

  /**
   * Create macOS application bundle
   */
  private async packageMac(options: PackageOptions): Promise<Package> {
    const outputPath = path.join(options.outputDir, "macos");
    await fs.mkdir(outputPath, { recursive: true });

    await this.ensurePackageJson(options.outputDir);

    const appPath = path.join(outputPath, `${options.buildId}.app`);
    
    try {
      // Try using pkg for macOS
      const binPath = path.join(outputPath, options.buildId);
      await execAsync(`npx pkg . --targets node18-macos-x64 --output "${binPath}"`, { cwd: options.outputDir });

      // Create .app bundle structure
      await this.createMacAppBundle(binPath, appPath, options.buildId);
    } catch (error) {
      Logger.warn("pkg not available, creating portable package");
      await this.createPortablePackage(options.outputDir, outputPath, "macos");
    }

    const stats = await this.getDirectorySize(appPath);

    return {
      platform: "macos",
      path: appPath,
      size: stats,
      type: "app"
    };
  }

  /**
   * Create Linux packages (deb and AppImage)
   */
  private async packageLinux(options: PackageOptions): Promise<Package> {
    const outputPath = path.join(options.outputDir, "linux");
    await fs.mkdir(outputPath, { recursive: true });

    await this.ensurePackageJson(options.outputDir);

    const binPath = path.join(outputPath, options.buildId);
    
    try {
      await execAsync(`npx pkg . --targets node18-linux-x64 --output "${binPath}"`, { cwd: options.outputDir });
    } catch (error) {
      Logger.warn("pkg not available, creating portable package");
      await this.createPortablePackage(options.outputDir, outputPath, "linux");
    }

    const stats = await fs.stat(binPath);

    return {
      platform: "linux",
      path: binPath,
      size: stats.size,
      type: "binary"
    };
  }

  /**
   * Create web deployment package
   */
  private async packageWeb(options: PackageOptions): Promise<Package> {
    const outputPath = path.join(options.outputDir, "web");
    await fs.mkdir(outputPath, { recursive: true });

    // Copy all web assets
    const webFiles = options.artifacts.filter(f => 
      f.endsWith(".html") || 
      f.endsWith(".css") || 
      f.endsWith(".js") ||
      f.startsWith("public/")
    );

    for (const file of webFiles) {
      const dest = path.join(outputPath, file);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(
        path.join(options.outputDir, file),
        dest
      );
    }

    // Create deployment manifest
    const manifest = {
      name: options.buildId,
      version: "1.0.0",
      entryPoint: "index.html",
      files: webFiles
    };

    await fs.writeFile(
      path.join(outputPath, "manifest.json"),
      JSON.stringify(manifest, null, 2)
    );

    const size = await this.getDirectorySize(outputPath);

    return {
      platform: "web",
      path: outputPath,
      size,
      type: "web"
    };
  }

  /**
   * Ensure package.json exists for packaging
   */
  private async ensurePackageJson(dir: string): Promise<void> {
    const pkgPath = path.join(dir, "package.json");
    
    try {
      await fs.access(pkgPath);
    } catch {
      // Create minimal package.json
      const pkg = {
        name: "agent-builder-app",
        version: "1.0.0",
        main: "index.js",
        bin: "index.js",
        pkg: {
          assets: ["**/*"],
          outputPath: "dist"
        }
      };

      await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2));
    }
  }

  /**
   * Create portable package (node + source)
   */
  private async createPortablePackage(
    sourceDir: string,
    outputDir: string,
    platform: string
  ): Promise<void> {
    
    // Copy all source files
    await this.copyDirectory(sourceDir, path.join(outputDir, "app"));

    // Create run script
    const runScript = platform === "win"
      ? `@echo off\nnode app/index.js %*`
      : `#!/bin/bash\nnode app/index.js "$@"`;

    const scriptName = platform === "win" ? "run.bat" : "run.sh";
    const scriptPath = path.join(outputDir, scriptName);
    
    await fs.writeFile(scriptPath, runScript);
    
    if (platform !== "win") {
      await fs.chmod(scriptPath, 0o755);
    }

    // Create README
    const readme = `# Application Package

## Running the Application

${platform === "win" ? "Run: run.bat" : "Run: ./run.sh"}

## Requirements

- Node.js 18 or higher

## Installation

1. Ensure Node.js is installed
2. Run the application using the script above
`;

    await fs.writeFile(path.join(outputDir, "README.txt"), readme);
  }

  /**
   * Create macOS .app bundle
   */
  private async createMacAppBundle(
    binPath: string,
    appPath: string,
    appName: string
  ): Promise<void> {
    
    const contentsDir = path.join(appPath, "Contents");
    const macOSDir = path.join(contentsDir, "MacOS");
    const resourcesDir = path.join(contentsDir, "Resources");

    await fs.mkdir(macOSDir, { recursive: true });
    await fs.mkdir(resourcesDir, { recursive: true });

    // Move binary
    await fs.rename(binPath, path.join(macOSDir, appName));

    // Create Info.plist
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>${appName}</string>
  <key>CFBundleIdentifier</key>
  <string>com.agentbuilder.${appName}</string>
  <key>CFBundleName</key>
  <string>${appName}</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
</dict>
</plist>`;

    await fs.writeFile(path.join(contentsDir, "Info.plist"), plist);
  }

  /**
   * Copy directory recursively
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * Get total size of directory
   */
  private async getDirectorySize(dir: string): Promise<number> {
    let size = 0;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          size += await this.getDirectorySize(fullPath);
        } else {
          const stats = await fs.stat(fullPath);
          size += stats.size;
        }
      }
    } catch (error) {
      // Directory might not exist yet
    }

    return size;
  }
}
