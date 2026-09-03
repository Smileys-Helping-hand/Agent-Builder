/**
 * Build Studio Types - Iterative Development System
 * Core interfaces for the continuous build-preview-test-improve cycle
 */

export enum BuildPhase {
  IDLE = 'IDLE',
  PLANNING = 'PLANNING',
  BUILDING = 'BUILDING',
  PREVIEWING = 'PREVIEWING',
  TESTING = 'TESTING',
  ANALYZING = 'ANALYZING',
  IMPROVING = 'IMPROVING',
  AWAITING_FEEDBACK = 'AWAITING_FEEDBACK',
  PACKAGING = 'PACKAGING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export enum PreviewMode {
  CODE = 'CODE',
  UI = 'UI',
  ARCHITECTURE = 'ARCHITECTURE',
  HYBRID = 'HYBRID'
}

export enum TestType {
  UNIT = 'UNIT',
  INTEGRATION = 'INTEGRATION',
  FUNCTIONAL = 'FUNCTIONAL',
  REGRESSION = 'REGRESSION',
  PERFORMANCE = 'PERFORMANCE'
}

export enum ImprovementPriority {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  ENHANCEMENT = 'ENHANCEMENT'
}

export interface ResourceAllocation {
  maxRamMB: number;
  currentRamMB: number;
  cpuPercentage: number;
  diskSpaceMB: number;
  throttled: boolean;
}

export interface BuildSession {
  id: string;
  projectName: string;
  description: string;
  phase: BuildPhase;
  startedAt: Date;
  lastActivityAt: Date;
  pausedAt?: Date;
  completedAt?: Date;
  iterationCount: number;
  resourceAllocation: ResourceAllocation;
  artifacts: BuildArtifact[];
  testResults: TestReport[];
  improvements: ImprovementSuggestion[];
  timeline: TimelineEvent[];
  userFeedback: UserFeedback[];
  config: BuildSessionConfig;
  metadata: Record<string, any>;
}

export interface BuildSessionConfig {
  ramLimitMB: number;
  previewMode: PreviewMode;
  testStrictness: 'lenient' | 'normal' | 'strict';
  improvementAggressiveness: 'conservative' | 'balanced' | 'aggressive';
  autoApproveMinorFixes: boolean;
  maxIterations: number;
  requireTestsToPass: boolean;
  enableHotReload: boolean;
}

export interface BuildArtifact {
  id: string;
  type: 'file' | 'directory' | 'package' | 'asset';
  path: string;
  content?: string;
  size: number;
  checksum: string;
  createdAt: Date;
  modifiedAt: Date;
  metadata: Record<string, any>;
}

export interface PreviewState {
  mode: PreviewMode;
  artifacts: BuildArtifact[];
  liveUrl?: string;
  diffSinceLastIteration: FileDiff[];
  hotReloadEnabled: boolean;
  viewerConnections: number;
}

export interface FileDiff {
  path: string;
  operation: 'added' | 'modified' | 'deleted';
  oldContent?: string;
  newContent?: string;
  lineChanges: {
    added: number;
    removed: number;
    modified: number;
  };
}

export interface TestReport {
  id: string;
  iteration: number;
  timestamp: Date;
  type: TestType;
  duration: number;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  coverage?: number;
  results: TestResult[];
  summary: string;
}

export interface TestResult {
  name: string;
  type: TestType;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  errorMessage?: string;
  stackTrace?: string;
  artifacts?: string[];
}

export interface ImprovementSuggestion {
  id: string;
  priority: ImprovementPriority;
  category: 'bug' | 'performance' | 'security' | 'quality' | 'feature';
  title: string;
  description: string;
  rationale: string;
  affectedFiles: string[];
  proposedChanges: ProposedChange[];
  estimatedImpact: {
    complexity: 'trivial' | 'simple' | 'moderate' | 'complex';
    riskLevel: 'low' | 'medium' | 'high';
    benefitScore: number; // 0-100
  };
  status: 'pending' | 'approved' | 'rejected' | 'applied' | 'failed';
  userFeedback?: string;
  createdAt: Date;
  appliedAt?: Date;
}

export interface ProposedChange {
  file: string;
  operation: 'create' | 'modify' | 'delete';
  oldContent?: string;
  newContent?: string;
  description: string;
}

export interface TimelineEvent {
  id: string;
  timestamp: Date;
  phase: BuildPhase;
  type: 'phase_change' | 'artifact_created' | 'test_run' | 'improvement_suggested' | 'improvement_applied' | 'user_feedback' | 'error' | 'milestone';
  title: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface UserFeedback {
  id: string;
  timestamp: Date;
  type: 'approval' | 'rejection' | 'modification' | 'comment';
  targetId: string; // ID of improvement or other entity
  targetType: 'improvement' | 'test' | 'artifact';
  content: string;
  metadata?: Record<string, any>;
}

export interface MemoryProfile {
  stage: BuildPhase;
  timestamp: Date;
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
  rss: number;
  processes: ProcessMemory[];
}

export interface ProcessMemory {
  name: string;
  pid: number;
  memoryMB: number;
  cpuPercent: number;
}

export interface BuildStudioState {
  currentSession?: BuildSession;
  sessions: BuildSession[];
  preview?: PreviewState;
  resourceAllocation: ResourceAllocation;
  memoryProfiles: MemoryProfile[];
  isProcessing: boolean;
  error?: Error;
}

// Manager Interfaces

export interface IResourceManager {
  setAllocation(maxRamMB: number): void;
  getCurrentUsage(): ResourceAllocation;
  checkAvailability(requiredMB: number): boolean;
  profileMemory(stage: BuildPhase): Promise<MemoryProfile>;
  throttleIfNeeded(): Promise<boolean>;
  cleanup(): Promise<void>;
}

export interface IPreviewManager {
  initialize(config: BuildSessionConfig): Promise<void>;
  updatePreview(artifacts: BuildArtifact[]): Promise<void>;
  setMode(mode: PreviewMode): void;
  generateDiff(previous: BuildArtifact[], current: BuildArtifact[]): FileDiff[];
  enableHotReload(): void;
  disableHotReload(): void;
  getViewerCount(): number;
  shutdown(): Promise<void>;
}

export interface ITestRunner {
  generateTests(artifacts: BuildArtifact[]): Promise<TestResult[]>;
  runTests(type: TestType): Promise<TestReport>;
  runAllTests(): Promise<TestReport>;
  analyzeCoverage(): Promise<number>;
  identifyRegressions(previous: TestReport, current: TestReport): TestResult[];
}

export interface IImprovementAnalyzer {
  analyzeTestResults(report: TestReport): Promise<ImprovementSuggestion[]>;
  analyzeCodeQuality(artifacts: BuildArtifact[]): Promise<ImprovementSuggestion[]>;
  analyzePerformance(metrics: any): Promise<ImprovementSuggestion[]>;
  prioritizeSuggestions(suggestions: ImprovementSuggestion[]): ImprovementSuggestion[];
  applyImprovement(suggestion: ImprovementSuggestion): Promise<BuildArtifact[]>;
}

export interface IBuildSessionManager {
  createSession(config: BuildSessionConfig, description: string): Promise<BuildSession>;
  loadSession(id: string): Promise<BuildSession>;
  saveSession(session: BuildSession): Promise<void>;
  updatePhase(phase: BuildPhase): Promise<void>;
  addArtifact(artifact: BuildArtifact): Promise<void>;
  addTestReport(report: TestReport): Promise<void>;
  addImprovement(suggestion: ImprovementSuggestion): Promise<void>;
  addUserFeedback(feedback: UserFeedback): Promise<void>;
  pauseSession(): Promise<void>;
  resumeSession(): Promise<void>;
  completeSession(): Promise<void>;
  rollback(toIteration: number): Promise<void>;
  getCurrentSession(): BuildSession | undefined;
  listSessions(): Promise<BuildSession[]>;
}
