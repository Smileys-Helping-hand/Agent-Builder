declare module "react-speech-recognition" {
  export interface SpeechRecognitionHook {
    transcript: string;
    listening: boolean;
    resetTranscript: () => void;
    browserSupportsSpeechRecognition: boolean;
    isMicrophoneAvailable: boolean;
  }

  export function useSpeechRecognition(): SpeechRecognitionHook;
  export function startListening(options?: { continuous?: boolean; language?: string }): Promise<void>;
  export function stopListening(): void;
  const SpeechRecognition: {
    startListening: typeof startListening;
    stopListening: typeof stopListening;
    browserSupportsSpeechRecognition: () => boolean;
  };
  export default SpeechRecognition;
}

declare module "react-syntax-highlighter" {
  import { ComponentType } from "react";
  export interface SyntaxHighlighterProps {
    language?: string;
    style?: Record<string, unknown>;
    PreTag?: ComponentType<any> | string;
    className?: string;
    children?: string;
  }
  export const Prism: ComponentType<SyntaxHighlighterProps>;
}

declare module "react-syntax-highlighter/dist/cjs/styles/prism" {
  export const vscDarkPlus: Record<string, unknown>;
}

declare module "react-markdown" {
  import { ComponentType, ReactNode } from "react";
  export interface ReactMarkdownProps {
    children?: ReactNode;
    className?: string;
    remarkPlugins?: unknown[];
    rehypePlugins?: unknown[];
    linkTarget?: string | ((href: string, children: ReactNode) => string | undefined);
    components?: Record<string, ComponentType<any>>;
  }
  const ReactMarkdown: ComponentType<ReactMarkdownProps>;
  export default ReactMarkdown;
}

// Build Studio Types
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
  previewMode: string;
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

export interface TestReport {
  id: string;
  iteration: number;
  timestamp: Date;
  type: string;
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
  type: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  errorMessage?: string;
  stackTrace?: string;
  artifacts?: string[];
}

export interface ImprovementSuggestion {
  id: string;
  priority: string;
  category: 'bug' | 'performance' | 'security' | 'quality' | 'feature';
  title: string;
  description: string;
  rationale: string;
  affectedFiles: string[];
  proposedChanges: ProposedChange[];
  estimatedImpact: {
    complexity: 'trivial' | 'simple' | 'moderate' | 'complex';
    riskLevel: 'low' | 'medium' | 'high';
    benefitScore: number;
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
  targetId: string;
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
  processes: any[];
}

export interface BuildStudioState {
  currentSession?: BuildSession;
  sessions: BuildSession[];
  preview?: any;
  resourceAllocation: ResourceAllocation;
  memoryProfiles: MemoryProfile[];
  isProcessing: boolean;
  error?: Error;
}

declare module "remark-gfm" {
  const plugin: any;
  export default plugin;
}

declare module "recharts" {
  export const ResponsiveContainer: any;
  export const ScatterChart: any;
  export const Scatter: any;
  export const XAxis: any;
  export const YAxis: any;
  export const Tooltip: any;
  export default any;
}
