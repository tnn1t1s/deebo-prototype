import { ChildProcess } from 'child_process';
import Docker from 'dockerode';

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
}

// Debug Request Interface
export interface DebugRequest {
  error: string;
  logs?: string;
  context?: string;
  codebase?: CodebaseReference;
}

// Codebase Reference Interface
export interface CodebaseReference {
  repoPath: string;
  branch?: string;
  filePath?: string;
  lineNumber?: number;
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
export interface ScenarioConfig {
  id: string;
  sessionId: string;
  scenarioType: string;
  branchName?: string;
  hypothesis: string;
  debugRequest: DebugRequest;
  timeout?: number;
  startTime: number;
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
