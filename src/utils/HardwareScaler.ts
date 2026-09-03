import * as os from "os";
import { Logger } from "../utils/Logger.js";

const logger = new Logger();

export interface HardwareSpecs {
  cpuCores: number;
  totalMemory: number;
  freeMemory: number;
  platform: string;
  arch: string;
  optimalConcurrency: number;
  recommendedModelSize: string;
}

export class HardwareScaler {
  public specs: HardwareSpecs;

  constructor() {
    this.specs = this.detectHardware();
  }

  /**
   * Detect system hardware capabilities
   */
  private detectHardware(): HardwareSpecs {
    const cpuCores = os.cpus().length;
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const platform = os.platform();
    const arch = os.arch();

    // Calculate optimal concurrency (leave some cores for system)
    const optimalConcurrency = Math.max(1, Math.floor(cpuCores * 0.75));

    // Recommend model size based on available memory
    const memoryGB = totalMemory / (1024 ** 3);
    let recommendedModelSize: string;

    if (memoryGB < 8) {
      recommendedModelSize = "qwen2.5-coder:1.5b";  // Lightweight model
    } else if (memoryGB < 16) {
      recommendedModelSize = "qwen2.5-coder:7b";    // Fast 7B model
    } else if (memoryGB < 32) {
      recommendedModelSize = "qwen2.5-coder:7b";    // Optimal 7B model
    } else {
      recommendedModelSize = "qwen2.5-coder:7b";    // High performance 7B model
    }

    return {
      cpuCores,
      totalMemory,
      freeMemory,
      platform,
      arch,
      optimalConcurrency,
      recommendedModelSize
    };
  }

  /**
   * Optimize system for current hardware
   */
  async optimize(): Promise<void> {
    Logger.log("Optimizing for hardware", {
      cores: this.specs.cpuCores,
      memoryGB: (this.specs.totalMemory / (1024 ** 3)).toFixed(2),
      recommendedModel: this.specs.recommendedModelSize
    });

    // Set environment variables for optimization
    process.env.UV_THREADPOOL_SIZE = String(this.specs.optimalConcurrency * 2);
    process.env.NODE_OPTIONS = `--max-old-space-size=${Math.floor(this.specs.totalMemory / (1024 ** 2) * 0.75)}`;

    // Update Ollama model if needed
    if (process.env.MODEL_PROVIDER === "ollama") {
      const currentModel = process.env.OLLAMA_MODEL || "";
      if (!currentModel || this.shouldSwitchModel(currentModel)) {
        Logger.log("Recommending model switch", {
          current: currentModel,
          recommended: this.specs.recommendedModelSize
        });
        process.env.OLLAMA_MODEL = this.specs.recommendedModelSize;
        process.env.MODEL = this.specs.recommendedModelSize;
      }
    }
  }

  /**
   * Get hardware capabilities for UI display
   */
  getCapabilities() {
    return {
      cpuCores: this.specs.cpuCores,
      totalMemoryGB: this.specs.totalMemory / (1024 ** 3),
      availableMemoryGB: this.specs.freeMemory / (1024 ** 3),
      canParallelize: this.specs.cpuCores > 1,
      recommendedWorkers: this.specs.optimalConcurrency,
      platform: this.specs.platform,
      arch: this.specs.arch
    };
  }

  /**
   * Execute tasks in parallel with optimal concurrency
   */
  async executeParallel<T>(tasks: (() => Promise<T>)[]): Promise<T[]> {
    const maxConcurrency = this.specs.optimalConcurrency;
    const results: T[] = [];
    
    for (let i = 0; i < tasks.length; i += maxConcurrency) {
      const batch = tasks.slice(i, i + maxConcurrency);
      const batchResults = await Promise.all(batch.map(task => task()));
      results.push(...batchResults);
    }
    
    return results;
  }

  /**
   * Execute tasks in batches with transformation
   */
  async executeBatched<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    batchSize?: number
  ): Promise<R[]> {
    const size = batchSize || this.specs.optimalConcurrency;
    const results: R[] = [];
    
    for (let i = 0; i < items.length; i += size) {
      const batch = items.slice(i, i + size);
      const batchResults = await Promise.all(batch.map(processor));
      results.push(...batchResults);
    }
    
    return results;
  }

  /**
   * Auto-scale concurrency based on system load
   */
  async autoScale(currentLoad: number): Promise<number> {
    const cpuUsage = this.getCpuUsage();
    const memoryUsage = (this.specs.totalMemory - os.freemem()) / this.specs.totalMemory;
    
    // Scale down if high resource usage
    if (cpuUsage > 80 || memoryUsage > 0.85) {
      return Math.max(1, Math.floor(this.specs.optimalConcurrency * 0.5));
    }
    
    // Scale up if low resource usage
    if (cpuUsage < 40 && memoryUsage < 0.6) {
      return Math.min(this.specs.cpuCores, Math.ceil(this.specs.optimalConcurrency * 1.5));
    }
    
    return this.specs.optimalConcurrency;
  }

  /**
   * Optimize workload distribution
   */
  optimizeForWorkload(workloadType: 'cpu' | 'memory' | 'io'): number {
    switch (workloadType) {
      case 'cpu':
        return this.specs.cpuCores;
      case 'memory':
        return Math.max(1, Math.floor(this.specs.optimalConcurrency * 0.75));
      case 'io':
        return this.specs.optimalConcurrency * 2; // IO can handle more concurrency
      default:
        return this.specs.optimalConcurrency;
    }
  }

  /**
   * Get current utilization metrics
   */
  async getUtilizationMetrics() {
    const cpuUsage = this.getCpuUsage();
    const memoryUsage = (this.specs.totalMemory - os.freemem()) / this.specs.totalMemory * 100;
    
    return {
      cpuUsage,
      memoryUsage,
      availableWorkers: this.specs.optimalConcurrency,
      totalCores: this.specs.cpuCores,
      freeMemoryGB: os.freemem() / (1024 ** 3)
    };
  }

  /**
   * Scale up resources
   */
  async scaleUp(): Promise<void> {
    // Increase optimal concurrency if resources allow
    const metrics = await this.getUtilizationMetrics();
    if (metrics.cpuUsage < 60 && metrics.memoryUsage < 70) {
      this.specs.optimalConcurrency = Math.min(
        this.specs.cpuCores,
        this.specs.optimalConcurrency + 2
      );
    }
  }

  /**
   * Scale down resources
   */
  async scaleDown(): Promise<void> {
    // Decrease optimal concurrency to save resources
    this.specs.optimalConcurrency = Math.max(1, this.specs.optimalConcurrency - 2);
  }

  /**
   * Check if we should switch to a different model size
   */
  private shouldSwitchModel(currentModel: string): boolean {
    const memoryUsagePercent = (this.specs.totalMemory - this.specs.freeMemory) / this.specs.totalMemory;
    
    // If using >85% memory, recommend smaller model
    if (memoryUsagePercent > 0.85) {
      const currentSize = this.estimateModelSize(currentModel);
      const recommendedSize = this.estimateModelSize(this.specs.recommendedModelSize);
      return recommendedSize < currentSize;
    }

    return false;
  }

  /**
   * Estimate model size in GB
   */
  private estimateModelSize(modelName: string): number {
    if (modelName.includes("1b")) return 1;
    if (modelName.includes("3b")) return 3;
    if (modelName.includes("7b") || modelName.includes("8b")) return 8;
    if (modelName.includes("13b")) return 13;
    if (modelName.includes("70b")) return 70;
    return 8; // default
  }

  /**
   * Get optimal number of tokens for current hardware
   */
  getOptimalTokens(): number {
    const memoryGB = this.specs.totalMemory / (1024 ** 3);
    
    if (memoryGB < 8) return 512;
    if (memoryGB < 16) return 1024;
    if (memoryGB < 32) return 2048;
    return 4096;
  }

  /**
   * Get optimal delay between iterations based on hardware load
   */
  getOptimalDelay(): number {
    const freeMemoryPercent = this.specs.freeMemory / this.specs.totalMemory;
    
    if (freeMemoryPercent < 0.2) return 5000;  // High load, wait 5s
    if (freeMemoryPercent < 0.4) return 2000;  // Medium load, wait 2s
    return 500;  // Low load, wait 0.5s
  }

  /**
   * Get current hardware specs
   */
  async getSpecs(): Promise<HardwareSpecs> {
    // Refresh free memory
    this.specs.freeMemory = os.freemem();
    return this.specs;
  }

  /**
   * Get optimal batch size for parallel processing
   */
  getOptimalBatchSize(): number {
    return Math.max(1, Math.floor(this.specs.optimalConcurrency / 2));
  }

  /**
   * Check if hardware can handle the workload
   */
  canHandleWorkload(estimatedMemoryGB: number): boolean {
    const availableGB = this.specs.freeMemory / (1024 ** 3);
    return availableGB > estimatedMemoryGB * 1.5; // Need 50% buffer
  }

  /**
   * Get resource utilization report
   */
  getUtilization(): {
    cpuUsage: number;
    memoryUsage: number;
    freeMemory: number;
    recommendation: string;
  } {
    const memoryUsage = ((this.specs.totalMemory - this.specs.freeMemory) / this.specs.totalMemory) * 100;
    const freeMemoryGB = this.specs.freeMemory / (1024 ** 3);

    let recommendation = "System running optimally";
    
    if (memoryUsage > 90) {
      recommendation = "Critical: Memory usage very high. Consider using smaller model.";
    } else if (memoryUsage > 80) {
      recommendation = "Warning: Memory usage high. Monitor performance.";
    } else if (freeMemoryGB < 2) {
      recommendation = "Low free memory. Close other applications for better performance.";
    }

    return {
      cpuUsage: this.getCpuUsage(),
      memoryUsage,
      freeMemory: freeMemoryGB,
      recommendation
    };
  }

  /**
   * Estimate CPU usage (simplified)
   */
  private getCpuUsage(): number {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    }

    return 100 - (totalIdle / totalTick * 100);
  }
}

// Singleton instance
let hardwareScalerInstance: HardwareScaler | null = null;

export function getHardwareScaler(): HardwareScaler {
  if (!hardwareScalerInstance) {
    hardwareScalerInstance = new HardwareScaler();
  }
  return hardwareScalerInstance;
}
