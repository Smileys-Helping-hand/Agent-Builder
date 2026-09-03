/**
 * Improvement Agent - AI-powered code improvement analyzer
 * Analyzes test results, code quality, and performance to suggest improvements
 */

import crypto from 'crypto';
import { BaseAgent } from './BaseAgent.js';
import { Task } from '../orchestrator/types.js';
import {
  BuildArtifact,
  TestReport,
  TestResult,
  ImprovementSuggestion,
  ImprovementPriority,
  ProposedChange,
  IImprovementAnalyzer
} from '../types/BuildStudio.js';

export class ImprovementAgent extends BaseAgent implements IImprovementAnalyzer {
  constructor() {
    super('improvement');
  }

  canHandle(task: Task): boolean {
    return task.agentType === 'improvement' || task.agentType === 'analyze';
  }

  protected async execute(task: Task): Promise<any> {
    const { artifacts, testReport, metrics } = (task.metadata || {}) as any;

    const suggestions: ImprovementSuggestion[] = [];

    if (testReport && typeof testReport === 'object' && testReport.results) {
      suggestions.push(...await this.analyzeTestResults(testReport));
    }

    if (artifacts && Array.isArray(artifacts)) {
      suggestions.push(...await this.analyzeCodeQuality(artifacts));
    }

    if (metrics) {
      suggestions.push(...await this.analyzePerformance(metrics));
    }

    return this.prioritizeSuggestions(suggestions);
  }

  async analyzeTestResults(report: TestReport): Promise<ImprovementSuggestion[]> {
    console.log(`🔍 Analyzing test results: ${report.failed} failures...`);

    const suggestions: ImprovementSuggestion[] = [];

    // Analyze failed tests
    for (const failedTest of report.results.filter(r => r.status === 'failed')) {
      const suggestion = await this.createSuggestionFromFailedTest(failedTest);
      suggestions.push(suggestion);
    }

    // Check coverage
    if (report.coverage !== undefined && report.coverage < 70) {
      suggestions.push({
        id: this.generateId(),
        priority: ImprovementPriority.MEDIUM,
        category: 'quality',
        title: 'Increase test coverage',
        description: `Current coverage is ${report.coverage.toFixed(1)}%. Recommend adding tests for uncovered paths.`,
        rationale: 'Low test coverage increases risk of undetected bugs and makes refactoring more difficult.',
        affectedFiles: [],
        proposedChanges: [],
        estimatedImpact: {
          complexity: 'moderate',
          riskLevel: 'low',
          benefitScore: 75
        },
        status: 'pending',
        createdAt: new Date()
      });
    }

    console.log(`   Found ${suggestions.length} improvement opportunities from tests`);
    return suggestions;
  }

  async analyzeCodeQuality(artifacts: BuildArtifact[]): Promise<ImprovementSuggestion[]> {
    console.log(`🔍 Analyzing code quality for ${artifacts.length} artifacts...`);

    const suggestions: ImprovementSuggestion[] = [];

    for (const artifact of artifacts) {
      if (artifact.type === 'file' && artifact.content) {
        suggestions.push(...await this.analyzeFileQuality(artifact));
      }
    }

    console.log(`   Found ${suggestions.length} code quality improvements`);
    return suggestions;
  }

  async analyzePerformance(metrics: any): Promise<ImprovementSuggestion[]> {
    console.log('🔍 Analyzing performance metrics...');

    const suggestions: ImprovementSuggestion[] = [];

    // Analyze response times
    if (metrics.avgResponseTime && metrics.avgResponseTime > 500) {
      suggestions.push({
        id: this.generateId(),
        priority: ImprovementPriority.HIGH,
        category: 'performance',
        title: 'Optimize response time',
        description: `Average response time is ${metrics.avgResponseTime}ms, exceeding 500ms threshold.`,
        rationale: 'Slow response times negatively impact user experience and may cause timeouts.',
        affectedFiles: metrics.slowEndpoints || [],
        proposedChanges: [{
          file: 'server/handlers.ts',
          operation: 'modify',
          description: 'Add caching layer and optimize database queries'
        }],
        estimatedImpact: {
          complexity: 'moderate',
          riskLevel: 'medium',
          benefitScore: 85
        },
        status: 'pending',
        createdAt: new Date()
      });
    }

    // Analyze memory usage
    if (metrics.memoryUsageMB && metrics.memoryUsageMB > 1000) {
      suggestions.push({
        id: this.generateId(),
        priority: ImprovementPriority.MEDIUM,
        category: 'performance',
        title: 'Reduce memory consumption',
        description: `Memory usage at ${metrics.memoryUsageMB}MB. Consider optimizing data structures.`,
        rationale: 'High memory usage can lead to out-of-memory errors and poor scalability.',
        affectedFiles: [],
        proposedChanges: [],
        estimatedImpact: {
          complexity: 'moderate',
          riskLevel: 'medium',
          benefitScore: 70
        },
        status: 'pending',
        createdAt: new Date()
      });
    }

    console.log(`   Found ${suggestions.length} performance improvements`);
    return suggestions;
  }

  prioritizeSuggestions(suggestions: ImprovementSuggestion[]): ImprovementSuggestion[] {
    // Sort by priority and benefit score
    const priorityOrder = {
      [ImprovementPriority.CRITICAL]: 5,
      [ImprovementPriority.HIGH]: 4,
      [ImprovementPriority.MEDIUM]: 3,
      [ImprovementPriority.LOW]: 2,
      [ImprovementPriority.ENHANCEMENT]: 1
    };

    return suggestions.sort((a, b) => {
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;

      // If same priority, sort by benefit score
      return b.estimatedImpact.benefitScore - a.estimatedImpact.benefitScore;
    });
  }

  async applyImprovement(suggestion: ImprovementSuggestion): Promise<BuildArtifact[]> {
    console.log(`🔧 Applying improvement: ${suggestion.title}`);

    const modifiedArtifacts: BuildArtifact[] = [];

    for (const change of suggestion.proposedChanges) {
      try {
        const artifact = await this.applyChange(change);
        modifiedArtifacts.push(artifact);
        console.log(`   ✓ Applied change to ${change.file}`);
      } catch (error) {
        console.error(`   ✗ Failed to apply change to ${change.file}:`, error);
      }
    }

    return modifiedArtifacts;
  }

  // Private helper methods

  private async createSuggestionFromFailedTest(test: TestResult): Promise<ImprovementSuggestion> {
    const isErrorHandling = test.errorMessage?.includes('error') || test.errorMessage?.includes('exception');
    const isValidation = test.errorMessage?.includes('invalid') || test.errorMessage?.includes('validation');

    let priority = ImprovementPriority.HIGH;
    let category: 'bug' | 'performance' | 'security' | 'quality' | 'feature' = 'bug';

    if (test.errorMessage?.toLowerCase().includes('security')) {
      priority = ImprovementPriority.CRITICAL;
      category = 'security';
    }

    return {
      id: this.generateId(),
      priority,
      category,
      title: `Fix failing test: ${test.name}`,
      description: test.errorMessage || 'Test failed without error message',
      rationale: 'Failing tests indicate bugs or incorrect behavior that must be fixed.',
      affectedFiles: test.artifacts || [],
      proposedChanges: [{
        file: test.artifacts?.[0] || 'unknown',
        operation: 'modify',
        description: isErrorHandling
          ? 'Add proper error handling and validation'
          : isValidation
          ? 'Fix validation logic'
          : 'Fix test failure'
      }],
      estimatedImpact: {
        complexity: 'simple',
        riskLevel: 'low',
        benefitScore: 90
      },
      status: 'pending',
      createdAt: new Date()
    };
  }

  private async analyzeFileQuality(artifact: BuildArtifact): Promise<ImprovementSuggestion[]> {
    const suggestions: ImprovementSuggestion[] = [];
    const content = artifact.content || '';

    // Check file size
    if (content.length > 50000) {
      suggestions.push({
        id: this.generateId(),
        priority: ImprovementPriority.MEDIUM,
        category: 'quality',
        title: `Refactor large file: ${artifact.path}`,
        description: `File is ${Math.floor(content.length / 1000)}KB. Consider splitting into smaller modules.`,
        rationale: 'Large files are harder to maintain and understand.',
        affectedFiles: [artifact.path],
        proposedChanges: [{
          file: artifact.path,
          operation: 'modify',
          description: 'Split into smaller, focused modules'
        }],
        estimatedImpact: {
          complexity: 'moderate',
          riskLevel: 'medium',
          benefitScore: 60
        },
        status: 'pending',
        createdAt: new Date()
      });
    }

    // Check for console.log (potential debug code)
    if (content.includes('console.log') && !artifact.path.includes('test')) {
      suggestions.push({
        id: this.generateId(),
        priority: ImprovementPriority.LOW,
        category: 'quality',
        title: `Remove debug logging: ${artifact.path}`,
        description: 'Found console.log statements that should be removed or replaced with proper logging.',
        rationale: 'Debug logging in production code can expose sensitive information and clutter logs.',
        affectedFiles: [artifact.path],
        proposedChanges: [{
          file: artifact.path,
          operation: 'modify',
          description: 'Replace console.log with proper logger or remove'
        }],
        estimatedImpact: {
          complexity: 'trivial',
          riskLevel: 'low',
          benefitScore: 40
        },
        status: 'pending',
        createdAt: new Date()
      });
    }

    // Check for TODO comments
    const todoMatches = content.match(/\/\/\s*TODO:/gi);
    if (todoMatches && todoMatches.length > 3) {
      suggestions.push({
        id: this.generateId(),
        priority: ImprovementPriority.LOW,
        category: 'quality',
        title: `Address TODO items: ${artifact.path}`,
        description: `Found ${todoMatches.length} TODO comments that should be addressed.`,
        rationale: 'TODO comments indicate incomplete or temporary code.',
        affectedFiles: [artifact.path],
        proposedChanges: [],
        estimatedImpact: {
          complexity: 'simple',
          riskLevel: 'low',
          benefitScore: 50
        },
        status: 'pending',
        createdAt: new Date()
      });
    }

    // Check for error handling
    const tryBlocks = (content.match(/try\s*{/g) || []).length;
    const catchBlocks = (content.match(/catch\s*\(/g) || []).length;
    if (tryBlocks > 0 && catchBlocks === 0) {
      suggestions.push({
        id: this.generateId(),
        priority: ImprovementPriority.HIGH,
        category: 'bug',
        title: `Add error handling: ${artifact.path}`,
        description: 'Found try blocks without corresponding catch blocks.',
        rationale: 'Missing error handling can cause uncaught exceptions and crashes.',
        affectedFiles: [artifact.path],
        proposedChanges: [{
          file: artifact.path,
          operation: 'modify',
          description: 'Add proper error handling with catch blocks'
        }],
        estimatedImpact: {
          complexity: 'simple',
          riskLevel: 'low',
          benefitScore: 85
        },
        status: 'pending',
        createdAt: new Date()
      });
    }

    return suggestions;
  }

  private async applyChange(change: ProposedChange): Promise<BuildArtifact> {
    // In production, this would actually modify the file
    // For now, return a mock artifact
    return {
      id: this.generateId(),
      type: 'file',
      path: change.file,
      content: change.newContent || change.oldContent || '',
      size: (change.newContent || change.oldContent || '').length,
      checksum: this.generateChecksum(change.newContent || change.oldContent || ''),
      createdAt: new Date(),
      modifiedAt: new Date(),
      metadata: {
        improvement: change.description
      }
    };
  }

  private generateId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  private generateChecksum(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }
}
