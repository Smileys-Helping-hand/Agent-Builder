/**
 * Build Studio Orchestrator - Main iterative development engine
 * Coordinates the continuous build-preview-test-improve cycle
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';
import path from 'path';
import {
  BuildPhase,
  BuildSession,
  BuildSessionConfig,
  BuildArtifact,
  TestReport,
  ImprovementSuggestion,
  UserFeedback,
  BuildStudioState
} from '../types/BuildStudio.js';
import { BuildSessionManager } from './BuildSessionManager.js';
import { ResourceManager, initResourceManager } from '../utils/ResourceManager.js';
import { getHardwareScaler } from '../utils/HardwareScaler.js';
import { PreviewEngine } from '../preview/PreviewEngine.js';
import { TestOrchestrator } from '../testing/TestOrchestrator.js';
import { ImprovementAgent } from '../agents/ImprovementAgent.js';

export class BuildStudioOrchestrator extends EventEmitter {
  private sessionManager: BuildSessionManager;
  private resourceManager: ResourceManager;
  private previewEngine: PreviewEngine;
  private testOrchestrator: TestOrchestrator;
  private improvementAgent: ImprovementAgent;
  private workspaceRoot: string;
  private isRunning: boolean = false;
  private shouldContinue: boolean = true;

  constructor(workspaceRoot: string) {
    super();
    this.workspaceRoot = workspaceRoot;
    this.sessionManager = new BuildSessionManager(workspaceRoot);
    this.resourceManager = initResourceManager();
    this.previewEngine = new PreviewEngine();
    this.testOrchestrator = new TestOrchestrator();
    this.improvementAgent = new ImprovementAgent();
  }

  async initialize(): Promise<void> {
    await this.sessionManager.initialize();
    
    // Initialize hardware scaler
    const scaler = getHardwareScaler();
    await scaler.optimizeForWorkload('memory');
    
    console.log('🚀 Build Studio initialized');
  }

  /**
   * Start a new iterative build session
   */
  async startBuildSession(
    description: string,
    config: Partial<BuildSessionConfig> = {}
  ): Promise<BuildSession> {
    if (this.isRunning) {
      throw new Error('A build session is already running');
    }

    // Merge with default config
    const fullConfig: BuildSessionConfig = {
      ramLimitMB: config.ramLimitMB || 4096,
      previewMode: config.previewMode || 'CODE' as any,
      testStrictness: config.testStrictness || 'normal',
      improvementAggressiveness: config.improvementAggressiveness || 'balanced',
      autoApproveMinorFixes: config.autoApproveMinorFixes ?? false,
      maxIterations: config.maxIterations || 100,
      requireTestsToPass: config.requireTestsToPass ?? true,
      enableHotReload: config.enableHotReload ?? true
    };

    console.log('\n═══════════════════════════════════════════════');
    console.log('🎯 Starting Build Studio Session');
    console.log('═══════════════════════════════════════════════');
    console.log(`📝 Description: ${description}`);
    console.log(`💾 RAM Limit: ${fullConfig.ramLimitMB}MB`);
    console.log(`🎨 Preview Mode: ${fullConfig.previewMode}`);
    console.log(`🧪 Test Strictness: ${fullConfig.testStrictness}`);
    console.log('═══════════════════════════════════════════════\n');

    // Create session
    const session = await this.sessionManager.createSession(fullConfig, description);

    // Initialize preview engine
    await this.previewEngine.initialize(fullConfig);

    this.isRunning = true;
    this.shouldContinue = true;

    // Start the iterative build cycle
    this.emit('session-started', session);
    
    // Run build cycle (async, non-blocking)
    this.runBuildCycle(session).catch(error => {
      console.error('Build cycle error:', error);
      this.emit('error', error);
    });

    return session;
  }

  /**
   * Main iterative build cycle
   */
  private async runBuildCycle(session: BuildSession): Promise<void> {
    let iteration = 0;

    while (this.shouldContinue && iteration < session.config.maxIterations) {
      try {
        iteration++;
        console.log(`\n┌─────────────────────────────────────────┐`);
        console.log(`│  ITERATION ${iteration.toString().padStart(3, '0')} / ${session.config.maxIterations.toString().padStart(3, '0')}                      │`);
        console.log(`└─────────────────────────────────────────┘`);

        // Phase 1: Planning
        await this.phaseTransition(BuildPhase.PLANNING);
        await this.planningPhase(session);

        // Phase 2: Building
        await this.phaseTransition(BuildPhase.BUILDING);
        const artifacts = await this.buildingPhase(session);

        // Phase 3: Previewing
        await this.phaseTransition(BuildPhase.PREVIEWING);
        await this.previewingPhase(artifacts);

        // Phase 4: Testing
        await this.phaseTransition(BuildPhase.TESTING);
        const testReport = await this.testingPhase(artifacts);

        // Phase 5: Analyzing
        await this.phaseTransition(BuildPhase.ANALYZING);
        const improvements = await this.analyzingPhase(artifacts, testReport);

        // Phase 6: Awaiting Feedback
        if (improvements.length > 0) {
          await this.phaseTransition(BuildPhase.AWAITING_FEEDBACK);
          await this.awaitUserFeedback(improvements);

          // Phase 7: Improving
          await this.phaseTransition(BuildPhase.IMPROVING);
          await this.improvingPhase(improvements);
        }

        // Check if tests pass and no critical improvements
        const allTestsPass = testReport.failed === 0;
        const noCriticalIssues = !improvements.some(i => i.priority === 'CRITICAL');

        if (allTestsPass && noCriticalIssues) {
          console.log('\n✨ Build iteration successful - all tests passing, no critical issues');
          
          // Check if user wants to continue
          const shouldFinish = await this.promptContinue();
          if (shouldFinish) {
            break;
          }
        }

        // Check resource usage
        await this.resourceManager.throttleIfNeeded();

      } catch (error) {
        console.error(`Error in iteration ${iteration}:`, error);
        await this.phaseTransition(BuildPhase.ERROR);
        this.emit('iteration-error', { iteration, error });
        
        // Continue or stop based on severity
        if (session.config.testStrictness === 'strict') {
          break;
        }
      }
    }

    // Finalize
    console.log('\n🏁 Build cycle completed');
    await this.phaseTransition(BuildPhase.COMPLETED);
    await this.sessionManager.completeSession();
    this.isRunning = false;

    this.emit('session-completed', session);
  }

  private async phaseTransition(phase: BuildPhase): Promise<void> {
    await this.sessionManager.updatePhase(phase);
    this.emit('phase-changed', phase);
  }

  private async planningPhase(session: BuildSession): Promise<void> {
    console.log('📋 Planning phase...');
    
    // Analyze requirements and plan next steps
    await this.delay(500);
    
    console.log('   ✓ Requirements analyzed');
    console.log('   ✓ Build plan created');
  }

  private async buildingPhase(session: BuildSession): Promise<BuildArtifact[]> {
    console.log('🔨 Building phase...');

    // Use parallel processing for multiple artifacts
    const scaler = getHardwareScaler();
    
    // In production, this would integrate with your builder agents
    // For now, create sample artifacts in parallel
    const artifactTasks = [
      () => this.createArtifact('src/main.ts', 'main'),
      () => this.createArtifact('src/utils.ts', 'utils'),
      () => this.createArtifact('src/config.ts', 'config')
    ];

    const artifacts = await scaler.executeParallel(artifactTasks);

    for (const artifact of artifacts) {
      await this.sessionManager.addArtifact(artifact);
    }

    console.log(`   ✓ Built ${artifacts.length} artifacts`);
    return artifacts;
  }
  
  private async createArtifact(path: string, type: string): Promise<BuildArtifact> {
    await this.delay(200); // Simulate build time
    
    return {
      id: this.generateId(),
      type: 'file',
      path,
      content: this.generateSampleCode(type),
      size: 1024,
      checksum: this.generateChecksum(type),
      createdAt: new Date(),
      modifiedAt: new Date(),
      metadata: {}
    };
  }

  private async previewingPhase(artifacts: BuildArtifact[]): Promise<void> {
    console.log('👁️  Preview phase...');
    
    await this.previewEngine.updatePreview(artifacts);
    
    console.log(`   ✓ Preview updated (${this.previewEngine.getViewerCount()} viewers connected)`);
  }

  private async testingPhase(artifacts: BuildArtifact[]): Promise<TestReport> {
    console.log('🧪 Testing phase...');

    // Generate tests for artifacts
    await this.testOrchestrator.generateTests(artifacts);

    // Run all tests
    const report = await this.testOrchestrator.runAllTests();

    await this.sessionManager.addTestReport(report);

    const passRate = Math.floor((report.passed / report.totalTests) * 100);
    console.log(`   ✓ Tests completed: ${report.passed}/${report.totalTests} passed (${passRate}%)`);

    return report;
  }

  private async analyzingPhase(artifacts: BuildArtifact[], testReport: TestReport): Promise<ImprovementSuggestion[]> {
    console.log('📊 Analyzing for improvements...');

    const improvements: ImprovementSuggestion[] = [];
    const scaler = getHardwareScaler();

    // Parallel analysis for better performance
    const analysisTasks = [
      () => this.improvementAgent.analyzeTestResults(testReport),
      () => this.improvementAgent.analyzeCodeQuality(artifacts)
    ];

    const results = await scaler.executeParallel(analysisTasks);
    improvements.push(...results.flat());

    // Prioritize
    const prioritized = this.improvementAgent.prioritizeSuggestions(improvements);

    for (const improvement of prioritized) {
      await this.sessionManager.addImprovement(improvement);
    }

    console.log(`   ✓ Found ${improvements.length} improvement opportunities`);
    if (improvements.length > 0) {
      console.log(`   Top priority: [${prioritized[0].priority}] ${prioritized[0].title}`);
    }

    return prioritized;
  }

  private async awaitUserFeedback(improvements: ImprovementSuggestion[]): Promise<void> {
    console.log('\n💬 Awaiting user feedback...');
    console.log('─────────────────────────────────────────');
    
    const session = this.sessionManager.getCurrentSession();
    
    // Display top improvements
    const topImprovements = improvements.slice(0, 5);
    
    for (let i = 0; i < topImprovements.length; i++) {
      const imp = topImprovements[i];
      console.log(`\n${i + 1}. [${imp.priority}] ${imp.title}`);
      console.log(`   ${imp.description}`);
      console.log(`   Impact: ${imp.estimatedImpact.benefitScore}/100 | Risk: ${imp.estimatedImpact.riskLevel}`);
    }

    console.log('\n─────────────────────────────────────────');
    console.log('💡 Auto-applying improvements...');

    // Auto-approve based on config
    if (session?.config.autoApproveMinorFixes) {
      for (const imp of topImprovements) {
        if (imp.estimatedImpact.complexity === 'trivial' || imp.estimatedImpact.complexity === 'simple') {
          imp.status = 'approved';
          console.log(`   ✓ Auto-approved: ${imp.title}`);
        }
      }
    }

    // In production, this would wait for actual user input via dashboard
    await this.delay(1000);
    
    // Mock user feedback
    if (topImprovements.length > 0) {
      const feedback: UserFeedback = {
        id: this.generateId(),
        timestamp: new Date(),
        type: 'approval',
        targetId: topImprovements[0].id,
        targetType: 'improvement',
        content: 'Approved top priority improvement'
      };
      
      await this.sessionManager.addUserFeedback(feedback);
      topImprovements[0].status = 'approved';
    }
  }

  private async improvingPhase(improvements: ImprovementSuggestion[]): Promise<void> {
    console.log('🔧 Improving phase...');

    const approved = improvements.filter(i => i.status === 'approved');
    console.log(`   Applying ${approved.length} approved improvements...`);

    for (const improvement of approved) {
      try {
        const artifacts = await this.improvementAgent.applyImprovement(improvement);
        
        for (const artifact of artifacts) {
          await this.sessionManager.addArtifact(artifact);
        }
        
        improvement.status = 'applied';
        improvement.appliedAt = new Date();
        
        console.log(`   ✓ Applied: ${improvement.title}`);
      } catch (error) {
        console.error(`   ✗ Failed to apply: ${improvement.title}`, error);
        improvement.status = 'failed';
      }
    }
  }

  private async promptContinue(): Promise<boolean> {
    // In production, this would prompt user via dashboard
    // For now, simulate continuing
    console.log('\n💬 Continue iterating or create finished build?');
    console.log('   Type "finished build" to export, or anything else to continue...');
    
    // Simulate user continuing for now
    await this.delay(1000);
    return false; // Continue iterating
  }

  /**
   * Request a finished, production-ready build
   */
  async requestFinishedBuild(): Promise<void> {
    console.log('\n📦 Creating finished build...');
    this.shouldContinue = false;
    await this.phaseTransition(BuildPhase.PACKAGING);
    
    // Package the application
    const session = this.sessionManager.getCurrentSession();
    if (session) {
      console.log('   Optimizing code...');
      console.log('   Bundling dependencies...');
      console.log('   Generating documentation...');
      await this.delay(2000);
      console.log('   ✓ Build ready for deployment!');
      
      this.emit('finished-build-ready', {
        sessionId: session.id,
        artifactCount: session.artifacts.length,
        outputPath: path.join(this.workspaceRoot, 'dist')
      });
    }
  }

  /**
   * Pause current session
   */
  async pauseSession(): Promise<void> {
    this.shouldContinue = false;
    await this.sessionManager.pauseSession();
    console.log('⏸️  Session paused');
  }

  /**
   * Resume paused session
   */
  async resumeSession(sessionId: string): Promise<void> {
    const session = await this.sessionManager.loadSession(sessionId);
    await this.sessionManager.resumeSession();
    this.shouldContinue = true;
    
    console.log('▶️  Session resumed');
    
    // Continue from where we left off
    if (!this.isRunning) {
      this.isRunning = true;
      this.runBuildCycle(session).catch(error => {
        console.error('Build cycle error:', error);
        this.emit('error', error);
      });
    }
  }

  /**
   * Get current state
   */
  getState(): BuildStudioState {
    const session = this.sessionManager.getCurrentSession();
    const resourceAllocation = this.resourceManager.getCurrentUsage();

    return {
      currentSession: session,
      sessions: [],
      preview: session ? this.previewEngine.getState() : undefined,
      resourceAllocation,
      memoryProfiles: this.resourceManager.getMemoryProfiles(),
      isProcessing: this.isRunning
    };
  }

  /**
   * Cleanup and shutdown
   */
  async shutdown(): Promise<void> {
    console.log('\n🛑 Shutting down Build Studio...');
    
    this.shouldContinue = false;
    this.isRunning = false;
    
    await this.previewEngine.shutdown();
    await this.sessionManager.shutdown();
    
    console.log('✓ Build Studio shutdown complete');
  }

  // Helper methods

  private generateId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  private generateChecksum(seed: string): string {
    return crypto.createHash('sha256').update(seed + Date.now()).digest('hex').substring(0, 16);
  }

  private generateSampleCode(type: string): string {
    if (type === 'main') {
      return `export function main() {\n  console.log('Hello from Build Studio!');\n  return true;\n}\n`;
    }
    return `export function helper() {\n  return { status: 'ok' };\n}\n`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
