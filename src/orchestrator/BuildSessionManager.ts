/**
 * Build Session Manager - Orchestrates the iterative build lifecycle
 * Manages state, coordinates phases, and persists sessions
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import {
  BuildSession,
  BuildSessionConfig,
  BuildPhase,
  BuildArtifact,
  TestReport,
  ImprovementSuggestion,
  UserFeedback,
  TimelineEvent,
  IBuildSessionManager,
  ResourceAllocation
} from '../types/BuildStudio.js';
import { getResourceManager } from '../utils/ResourceManager.js';

export class BuildSessionManager implements IBuildSessionManager {
  private currentSession?: BuildSession;
  private sessionsDir: string;
  private autoSaveInterval?: NodeJS.Timeout;

  constructor(workspaceRoot: string) {
    this.sessionsDir = path.join(workspaceRoot, 'data', 'build-sessions');
  }

  async initialize(): Promise<void> {
    // Ensure sessions directory exists
    await fs.mkdir(this.sessionsDir, { recursive: true });
    console.log(`Build Session Manager initialized. Sessions directory: ${this.sessionsDir}`);
  }

  async createSession(config: BuildSessionConfig, description: string): Promise<BuildSession> {
    const resourceManager = getResourceManager();
    
    // Set RAM allocation from config
    resourceManager.setAllocation(config.ramLimitMB);
    
    const session: BuildSession = {
      id: this.generateSessionId(),
      projectName: this.extractProjectName(description),
      description,
      phase: BuildPhase.PLANNING,
      startedAt: new Date(),
      lastActivityAt: new Date(),
      iterationCount: 0,
      resourceAllocation: resourceManager.getCurrentUsage(),
      artifacts: [],
      testResults: [],
      improvements: [],
      timeline: [{
        id: this.generateId(),
        timestamp: new Date(),
        phase: BuildPhase.PLANNING,
        type: 'phase_change',
        title: 'Session Created',
        description: description
      }],
      userFeedback: [],
      config,
      metadata: {}
    };

    this.currentSession = session;
    await this.saveSession(session);
    
    // Start auto-save
    this.startAutoSave();
    
    // Start resource monitoring
    resourceManager.startMonitoring();
    
    console.log(`✨ Created build session: ${session.id} - "${session.projectName}"`);
    console.log(`   RAM limit: ${config.ramLimitMB}MB | Preview: ${config.previewMode} | Test strictness: ${config.testStrictness}`);
    
    return session;
  }

  async loadSession(id: string): Promise<BuildSession> {
    const sessionPath = path.join(this.sessionsDir, `${id}.json`);
    
    try {
      const data = await fs.readFile(sessionPath, 'utf-8');
      const session = JSON.parse(data, (key, value) => {
        // Convert date strings back to Date objects
        if (key.endsWith('At') || key === 'timestamp') {
          return new Date(value);
        }
        return value;
      });
      
      this.currentSession = session;
      
      // Restore resource allocation
      const resourceManager = getResourceManager();
      resourceManager.setAllocation(session.config.ramLimitMB);
      resourceManager.startMonitoring();
      
      this.startAutoSave();
      
      console.log(`📂 Loaded session: ${session.id} - "${session.projectName}"`);
      console.log(`   Phase: ${session.phase} | Iteration: ${session.iterationCount} | Artifacts: ${session.artifacts.length}`);
      
      return session;
    } catch (error) {
      throw new Error(`Failed to load session ${id}: ${error}`);
    }
  }

  async saveSession(session: BuildSession): Promise<void> {
    const sessionPath = path.join(this.sessionsDir, `${session.id}.json`);
    
    session.lastActivityAt = new Date();
    
    await fs.writeFile(
      sessionPath,
      JSON.stringify(session, null, 2),
      'utf-8'
    );
  }

  async updatePhase(phase: BuildPhase): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    const previousPhase = this.currentSession.phase;
    this.currentSession.phase = phase;
    
    // Add timeline event
    const event: TimelineEvent = {
      id: this.generateId(),
      timestamp: new Date(),
      phase,
      type: 'phase_change',
      title: `Phase: ${previousPhase} → ${phase}`,
      description: `Transitioned from ${previousPhase} to ${phase}`
    };
    
    this.currentSession.timeline.push(event);
    
    // Update resource usage
    const resourceManager = getResourceManager();
    this.currentSession.resourceAllocation = resourceManager.getCurrentUsage();
    await resourceManager.profileMemory(phase);
    
    console.log(`🔄 Phase transition: ${previousPhase} → ${phase}`);
    
    await this.saveSession(this.currentSession);
  }

  async addArtifact(artifact: BuildArtifact): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    this.currentSession.artifacts.push(artifact);
    
    const event: TimelineEvent = {
      id: this.generateId(),
      timestamp: new Date(),
      phase: this.currentSession.phase,
      type: 'artifact_created',
      title: `Created: ${artifact.path}`,
      description: `${artifact.type} (${this.formatBytes(artifact.size)})`,
      metadata: { artifactId: artifact.id }
    };
    
    this.currentSession.timeline.push(event);
    
    console.log(`   📄 Artifact: ${artifact.path} (${this.formatBytes(artifact.size)})`);
    
    await this.saveSession(this.currentSession);
  }

  async addTestReport(report: TestReport): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    this.currentSession.testResults.push(report);
    
    const passRate = Math.floor((report.passed / report.totalTests) * 100);
    
    const event: TimelineEvent = {
      id: this.generateId(),
      timestamp: new Date(),
      phase: this.currentSession.phase,
      type: 'test_run',
      title: `Tests: ${report.passed}/${report.totalTests} passed (${passRate}%)`,
      description: report.summary,
      metadata: { reportId: report.id }
    };
    
    this.currentSession.timeline.push(event);
    
    console.log(`   🧪 Tests: ${report.passed}/${report.totalTests} passed | ${report.failed} failed | ${report.skipped} skipped`);
    
    await this.saveSession(this.currentSession);
  }

  async addImprovement(suggestion: ImprovementSuggestion): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    this.currentSession.improvements.push(suggestion);
    
    const event: TimelineEvent = {
      id: this.generateId(),
      timestamp: new Date(),
      phase: this.currentSession.phase,
      type: 'improvement_suggested',
      title: `💡 ${suggestion.title}`,
      description: `${suggestion.priority} priority ${suggestion.category}`,
      metadata: { improvementId: suggestion.id }
    };
    
    this.currentSession.timeline.push(event);
    
    console.log(`   💡 Improvement: [${suggestion.priority}] ${suggestion.title}`);
    
    await this.saveSession(this.currentSession);
  }

  async addUserFeedback(feedback: UserFeedback): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    this.currentSession.userFeedback.push(feedback);
    
    const event: TimelineEvent = {
      id: this.generateId(),
      timestamp: new Date(),
      phase: this.currentSession.phase,
      type: 'user_feedback',
      title: `User ${feedback.type}`,
      description: feedback.content,
      metadata: { feedbackId: feedback.id }
    };
    
    this.currentSession.timeline.push(event);
    
    console.log(`   👤 User ${feedback.type}: ${feedback.content}`);
    
    await this.saveSession(this.currentSession);
  }

  async pauseSession(): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    this.currentSession.pausedAt = new Date();
    
    const event: TimelineEvent = {
      id: this.generateId(),
      timestamp: new Date(),
      phase: this.currentSession.phase,
      type: 'milestone',
      title: '⏸️ Session Paused'
    };
    
    this.currentSession.timeline.push(event);
    
    this.stopAutoSave();
    getResourceManager().stopMonitoring();
    
    await this.saveSession(this.currentSession);
    
    console.log(`⏸️ Session paused: ${this.currentSession.id}`);
  }

  async resumeSession(): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    this.currentSession.pausedAt = undefined;
    
    const event: TimelineEvent = {
      id: this.generateId(),
      timestamp: new Date(),
      phase: this.currentSession.phase,
      type: 'milestone',
      title: '▶️ Session Resumed'
    };
    
    this.currentSession.timeline.push(event);
    
    this.startAutoSave();
    getResourceManager().startMonitoring();
    
    await this.saveSession(this.currentSession);
    
    console.log(`▶️ Session resumed: ${this.currentSession.id}`);
  }

  async completeSession(): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    this.currentSession.completedAt = new Date();
    this.currentSession.phase = BuildPhase.COMPLETED;
    
    const event: TimelineEvent = {
      id: this.generateId(),
      timestamp: new Date(),
      phase: BuildPhase.COMPLETED,
      type: 'milestone',
      title: '✅ Session Completed',
      description: `${this.currentSession.iterationCount} iterations | ${this.currentSession.artifacts.length} artifacts | ${this.currentSession.testResults.length} test runs`
    };
    
    this.currentSession.timeline.push(event);
    
    this.stopAutoSave();
    getResourceManager().stopMonitoring();
    
    await this.saveSession(this.currentSession);
    
    const duration = this.currentSession.completedAt.getTime() - this.currentSession.startedAt.getTime();
    console.log(`✅ Session completed: ${this.currentSession.id}`);
    console.log(`   Duration: ${this.formatDuration(duration)} | Iterations: ${this.currentSession.iterationCount}`);
    
    this.currentSession = undefined;
  }

  async rollback(toIteration: number): Promise<void> {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    if (toIteration >= this.currentSession.iterationCount) {
      throw new Error('Cannot rollback to future iteration');
    }

    // Filter artifacts, tests, and improvements to keep only those from before the target iteration
    this.currentSession.artifacts = this.currentSession.artifacts.filter(
      a => this.getIterationFromTimestamp(a.createdAt) <= toIteration
    );
    
    this.currentSession.testResults = this.currentSession.testResults.filter(
      t => t.iteration <= toIteration
    );
    
    this.currentSession.improvements = this.currentSession.improvements.filter(
      i => this.getIterationFromTimestamp(i.createdAt) <= toIteration
    );
    
    this.currentSession.iterationCount = toIteration;
    
    const event: TimelineEvent = {
      id: this.generateId(),
      timestamp: new Date(),
      phase: this.currentSession.phase,
      type: 'milestone',
      title: `⏪ Rolled back to iteration ${toIteration}`
    };
    
    this.currentSession.timeline.push(event);
    
    console.log(`⏪ Rolled back to iteration ${toIteration}`);
    
    await this.saveSession(this.currentSession);
  }

  getCurrentSession(): BuildSession | undefined {
    return this.currentSession;
  }

  async listSessions(): Promise<BuildSession[]> {
    try {
      const files = await fs.readdir(this.sessionsDir);
      const sessionFiles = files.filter(f => f.endsWith('.json'));
      
      const sessions: BuildSession[] = [];
      
      for (const file of sessionFiles) {
        try {
          const data = await fs.readFile(path.join(this.sessionsDir, file), 'utf-8');
          const session = JSON.parse(data, (key, value) => {
            if (key.endsWith('At') || key === 'timestamp') {
              return new Date(value);
            }
            return value;
          });
          sessions.push(session);
        } catch (error) {
          console.error(`Failed to load session ${file}:`, error);
        }
      }
      
      // Sort by last activity, most recent first
      sessions.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
      
      return sessions;
    } catch (error) {
      console.error('Failed to list sessions:', error);
      return [];
    }
  }

  // Private helper methods

  private generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(4).toString('hex');
    return `session-${timestamp}-${random}`;
  }

  private generateId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  private extractProjectName(description: string): string {
    // Extract a reasonable project name from description
    const words = description.split(/\s+/).slice(0, 4);
    return words.join('-').toLowerCase().replace(/[^a-z0-9-]/g, '');
  }

  private getIterationFromTimestamp(timestamp: Date): number {
    if (!this.currentSession) return 0;
    
    // Calculate which iteration this timestamp belongs to
    const sessionStart = this.currentSession.startedAt.getTime();
    const itemTime = timestamp.getTime();
    const elapsed = itemTime - sessionStart;
    
    // Rough estimate: each iteration ~5 minutes
    return Math.floor(elapsed / (5 * 60 * 1000));
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  private startAutoSave(): void {
    if (this.autoSaveInterval) return;
    
    this.autoSaveInterval = setInterval(async () => {
      if (this.currentSession && !this.currentSession.pausedAt) {
        await this.saveSession(this.currentSession);
      }
    }, 30000); // Auto-save every 30 seconds
  }

  private stopAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = undefined;
    }
  }

  async shutdown(): Promise<void> {
    this.stopAutoSave();
    
    if (this.currentSession && !this.currentSession.completedAt) {
      await this.pauseSession();
    }
    
    await getResourceManager().cleanup();
    
    console.log('Build Session Manager shutdown complete');
  }
}
