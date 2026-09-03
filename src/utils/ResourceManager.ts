/**
 * Resource Manager - RAM and CPU allocation management
 * Monitors and controls resource usage during build process
 */

import os from 'os';
import {
  ResourceAllocation,
  IResourceManager,
  BuildPhase,
  MemoryProfile,
  ProcessMemory
} from '../types/BuildStudio.js';
import { getHardwareScaler } from './HardwareScaler.js';

export class ResourceManager implements IResourceManager {
  private maxRamMB: number;
  private throttleThreshold: number = 0.9; // 90% usage triggers throttling
  private checkInterval?: NodeJS.Timeout;
  private memoryProfiles: MemoryProfile[] = [];
  private isThrottled: boolean = false;

  constructor(maxRamMB?: number) {
    const totalSystemRamMB = os.totalmem() / (1024 * 1024);
    // Default to 70% of system RAM if not specified
    this.maxRamMB = maxRamMB || Math.floor(totalSystemRamMB * 0.7);
    
    console.log(`ResourceManager initialized with ${this.maxRamMB}MB limit (System: ${Math.floor(totalSystemRamMB)}MB)`);
  }

  setAllocation(maxRamMB: number): void {
    const totalSystemRamMB = os.totalmem() / (1024 * 1024);
    
    if (maxRamMB > totalSystemRamMB) {
      console.warn(`Requested ${maxRamMB}MB exceeds system RAM (${Math.floor(totalSystemRamMB)}MB). Capping at 90% of system RAM.`);
      this.maxRamMB = Math.floor(totalSystemRamMB * 0.9);
    } else {
      this.maxRamMB = maxRamMB;
    }
    
    console.log(`RAM allocation set to ${this.maxRamMB}MB`);
  }

  getCurrentUsage(): ResourceAllocation {
    const memUsage = process.memoryUsage();
    const totalSystemRam = os.totalmem();
    const freeSystemRam = os.freemem();
    const usedSystemRam = totalSystemRam - freeSystemRam;
    
    const currentRamMB = memUsage.rss / (1024 * 1024);
    const cpuUsage = this.getCpuUsage();
    
    return {
      maxRamMB: this.maxRamMB,
      currentRamMB: Math.floor(currentRamMB),
      cpuPercentage: cpuUsage,
      diskSpaceMB: this.getAvailableDiskSpace(),
      throttled: this.isThrottled
    };
  }

  checkAvailability(requiredMB: number): boolean {
    const current = this.getCurrentUsage();
    const available = this.maxRamMB - current.currentRamMB;
    
    return available >= requiredMB;
  }

  async profileMemory(stage: BuildPhase): Promise<MemoryProfile> {
    const memUsage = process.memoryUsage();
    
    const profile: MemoryProfile = {
      stage,
      timestamp: new Date(),
      heapUsedMB: Math.floor(memUsage.heapUsed / (1024 * 1024)),
      heapTotalMB: Math.floor(memUsage.heapTotal / (1024 * 1024)),
      externalMB: Math.floor(memUsage.external / (1024 * 1024)),
      rss: Math.floor(memUsage.rss / (1024 * 1024)),
      processes: await this.getProcessMemory()
    };
    
    this.memoryProfiles.push(profile);
    
    // Keep only last 100 profiles
    if (this.memoryProfiles.length > 100) {
      this.memoryProfiles = this.memoryProfiles.slice(-100);
    }
    
    console.log(`[${stage}] Memory: ${profile.rss}MB / ${this.maxRamMB}MB (${Math.floor((profile.rss / this.maxRamMB) * 100)}%)`);
    
    return profile;
  }

  async throttleIfNeeded(): Promise<boolean> {
    const current = this.getCurrentUsage();
    const usageRatio = current.currentRamMB / this.maxRamMB;
    
    if (usageRatio >= this.throttleThreshold) {
      if (!this.isThrottled) {
        console.warn(`⚠️ RAM usage at ${Math.floor(usageRatio * 100)}%. Throttling operations...`);
        this.isThrottled = true;
        
        // Auto-scale down workers
        const scaler = getHardwareScaler();
        await scaler.scaleDown();
      }
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      // Add delay to allow memory cleanup
      await this.delay(1000);
      
      return true;
    } else {
      if (this.isThrottled) {
        console.log(`✓ RAM usage normalized to ${Math.floor(usageRatio * 100)}%. Resuming normal operations.`);
        this.isThrottled = false;
        
        // Auto-scale up workers
        const scaler = getHardwareScaler();
        await scaler.scaleUp();
      }
      return false;
    }
  }

  async cleanup(): Promise<void> {
    console.log('Cleaning up resources...');
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
    
    // Force garbage collection
    if (global.gc) {
      global.gc();
    }
    
    // Clear memory profiles
    this.memoryProfiles = [];
    this.isThrottled = false;
    
    console.log('Resource cleanup completed');
  }

  // Start monitoring resource usage
  startMonitoring(intervalMs: number = 5000): void {
    if (this.checkInterval) {
      return;
    }
    
    this.checkInterval = setInterval(async () => {
      await this.throttleIfNeeded();
      
      const usage = this.getCurrentUsage();
      if (usage.currentRamMB > this.maxRamMB * 0.95) {
        console.error(`🚨 Critical: RAM usage at ${usage.currentRamMB}MB (${Math.floor((usage.currentRamMB / this.maxRamMB) * 100)}%)`);
      }
    }, intervalMs);
  }

  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
  }

  getMemoryProfiles(): MemoryProfile[] {
    return [...this.memoryProfiles];
  }

  // Private helper methods

  private getCpuUsage(): number {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    });
    
    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 100 - Math.floor((idle / total) * 100);
    
    return Math.max(0, Math.min(100, usage));
  }

  private getAvailableDiskSpace(): number {
    // Simplified - returns free memory as proxy
    // In production, use proper disk space checking library
    return Math.floor(os.freemem() / (1024 * 1024));
  }

  private async getProcessMemory(): Promise<ProcessMemory[]> {
    // Main process memory
    const main: ProcessMemory = {
      name: 'main',
      pid: process.pid,
      memoryMB: Math.floor(process.memoryUsage().rss / (1024 * 1024)),
      cpuPercent: this.getCpuUsage()
    };
    
    return [main];
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get resource statistics
  getStatistics(): {
    averageUsageMB: number;
    peakUsageMB: number;
    averageCpu: number;
    throttleCount: number;
  } {
    if (this.memoryProfiles.length === 0) {
      return {
        averageUsageMB: 0,
        peakUsageMB: 0,
        averageCpu: 0,
        throttleCount: 0
      };
    }
    
    const totalRss = this.memoryProfiles.reduce((sum, p) => sum + p.rss, 0);
    const peakRss = Math.max(...this.memoryProfiles.map(p => p.rss));
    
    return {
      averageUsageMB: Math.floor(totalRss / this.memoryProfiles.length),
      peakUsageMB: peakRss,
      averageCpu: this.getCpuUsage(),
      throttleCount: this.memoryProfiles.filter((_, i, arr) => 
        i > 0 && arr[i].rss / this.maxRamMB >= this.throttleThreshold
      ).length
    };
  }
}

// Singleton instance
let resourceManagerInstance: ResourceManager | null = null;

export function getResourceManager(): ResourceManager {
  if (!resourceManagerInstance) {
    resourceManagerInstance = new ResourceManager();
  }
  return resourceManagerInstance;
}

export function initResourceManager(maxRamMB?: number): ResourceManager {
  resourceManagerInstance = new ResourceManager(maxRamMB);
  return resourceManagerInstance;
}
