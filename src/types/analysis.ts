// Analysis metrics for tracking scenario progress and results
export interface AnalysisMetrics {
  // Success probability (0-1)
  successProbability: number;
  
  // Complexity of the proposed fix (1-5)
  fixComplexity: number;
  
  // Risk of side effects (1-5)
  sideEffectRisk: number;
  
  // Progress metrics
  progress: {
    stepsCompleted: number;
    totalSteps: number;
    timeSpent: number;
    resourcesUsed: string[];
  };
  
  // Test results
  testing: {
    casesRun: number;
    casesPassed: number;
    coverage: number;
    validationSteps: string[];
  };
  
  // Self-correction data
  adaptation: {
    attemptNumber: number;
    previousApproaches: Array<{
      approach: string;
      success: boolean;
      reason?: string;
    }>;
    adjustments: string[];
  };
}

// Enhanced result type with metrics
export interface EnhancedResult {
  success: boolean;
  confidence: number;
  fix: string;
  explanation: string;
  metrics: AnalysisMetrics;
}

// Test case definition
export interface TestCase {
  name: string;
  setup: () => Promise<void>;
  execute: () => Promise<boolean>;
  cleanup: () => Promise<void>;
  expectedResult: string;
}

// Validation step
export interface ValidationStep {
  name: string;
  check: () => Promise<boolean>;
  rollback?: () => Promise<void>;
}

// OODA state tracking
export interface OODAState {
  // Current phase
  phase: 'observe' | 'orient' | 'decide' | 'act';
  
  // Iteration tracking
  currentIteration: number;
  maxIterations: number;
  
  // Time tracking
  startTime: number;
  lastUpdateTime: number;
  
  // Resource tracking
  resourcesUsed: Set<string>;
  
  // Analysis state
  currentHypothesis: string;
  alternativeHypotheses: string[];
  
  // Test tracking
  testCases: TestCase[];
  validationSteps: ValidationStep[];
  
  // Results
  metrics: AnalysisMetrics;
}
