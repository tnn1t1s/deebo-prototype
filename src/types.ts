import { ChildProcess } from 'child_process';
import Docker from 'dockerode';

// Session initialization state interface
export interface SessionInitState {
  directoriesReady: boolean;
  environmentValid: boolean;
  toolsInitialized: boolean;
  timeInitialized?: number;
  failedChecks: string[];
}

// Debug Session Interface
export interface DebugSession {
  id: string;
  status: "initializing" | "running" | "complete" | "error";
  error?: string;
  logs: string[];
  startTime: number;
  lastChecked: number;
  request: DebugRequest;
  container?: Docker.Container;
  process?: ChildProcess;
  scenarioResults: ScenarioResult[];
  finalResult?: DebugResult;
  initState: SessionInitState;
  processInfo?: {
    pid: number;
    startTime: number;
    isolatedRoot: string;
    gitBranch: string;
  };
  validationState: {
    lastValidation: number;
    errors: string[];
    requiredPaths: string[];
  };
}

// Debug Request Interface with validation
export interface DebugRequest {
  error: string;
  logs?: string;
  context?: string;
  codebase?: CodebaseReference;
  environment: {
    deeboRoot: string;
    processIsolation: boolean;
    gitAvailable: boolean;
    validatedPaths: string[];
  };
  initRequirements: {
    requiredDirs: string[];
    requiredTools: string[];
    requiredCapabilities: string[];
  };
  validation: {
    environmentChecked: boolean;
    pathsValidated: boolean;
    toolsValidated: boolean;
    errors: string[];
  };
}

// Codebase Reference Interface
export interface CodebaseReference {
  repoPath?: string;  // Made optional to match usage
  branch?: string;
  filePath?: string;
  lineNumber?: number;
}

// Codebase Info Interface for Agent Config
export interface CodebaseInfo {
  filePath?: string;
  repoPath?: string;
}

// Base Agent Configuration Interface
export interface BaseAgentConfig {
  id: string;
  sessionId: string;
  startTime: number;
}

// Complete Agent Configuration Interface
export interface AgentConfig extends BaseAgentConfig {
  branchName?: string;
  hypothesis: string;
  error: string;
  context: string;
  codebase?: CodebaseInfo;
  scenarioType: string;
  debugRequest: DebugRequest;
}

// Scenario Result Interface
export interface ScenarioResult {
  id: string;
  scenarioType: string;
  hypothesis: string;
  fixAttempted: string;
  testResults: string;
  success: boolean;
  confidence: number;
  explanation: string;
  branchName?: string;
  gitDiff?: string;
}

// Debug Result Interface
export interface DebugResult {
  fixDescription: string;
  confidence: number;
  explanation: string;
  changesRequired: Change[];
  estimatedTimeToFix: string;
  recommendation: string;
}

// Change Interface
export interface Change {
  type: "dependency" | "code" | "environment" | "cache" | "async" | "other";
  description: string;
  file?: string;
  priority: "high" | "medium" | "low";
  diff?: string;
}

// Scenario Agent Configuration Interface
export interface ScenarioConfig extends BaseAgentConfig {
  scenarioType: string;
  branchName?: string;
  hypothesis: string;
  debugRequest: DebugRequest;
  timeout?: number;
}

// Mother Agent Interface
export interface MotherAgentContext {
  sessionId: string;
  debugRequest: DebugRequest;
  availableScenarios: string[];
  maxScenarios?: number;
  timeout?: number;
}

// Original DebugSession interface for backward compatibility
export interface OriginalDebugSession {
  id: string;
  process: ChildProcess;
  logs: string[];
  status: "running" | "complete" | "error";
  result: any | null;
  lastChecked: number;
}
