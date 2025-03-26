import { OODAState, AnalysisMetrics } from '../types/analysis.js';
import { createLogger } from '../util/logger.js';

interface ScenarioInsight {
  scenarioType: string;
  success: boolean;
  confidence: number;
  insights: string[];
  relatedScenarios: string[];
  metrics: AnalysisMetrics;
}

interface AggregatedResult {
  success: boolean;
  confidence: number;
  primaryFix: string;
  supportingFixes: string[];
  conflicts: Array<{
    scenarios: string[];
    reason: string;
  }>;
  metrics: AnalysisMetrics;
}

export class MacroOODALoop {
  private insights: Map<string, ScenarioInsight>;
  private successPatterns: Map<string, number>;
  private logger: any;
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.insights = new Map();
    this.successPatterns = new Map();
    this.logger = createLogger(sessionId, 'macro-ooda');
  }

  // Strategy coordination
  async recordScenarioInsight(
    scenarioType: string,
    result: any,
    metrics: AnalysisMetrics
  ) {
    const insight: ScenarioInsight = {
      scenarioType,
      success: result.success,
      confidence: result.confidence,
      insights: this.extractInsights(result),
      relatedScenarios: this.findRelatedScenarios(scenarioType, result),
      metrics
    };

    this.insights.set(scenarioType, insight);
    
    if (result.success) {
      this.updateSuccessPattern(scenarioType, result);
    }

    this.logger.debug('Recorded scenario insight', { 
      scenarioType,
      insight 
    });

    return insight;
  }

  private extractInsights(result: any): string[] {
    const insights: string[] = [];
    
    // Extract key findings from the result
    if (result.explanation && typeof result.explanation === 'string') {
      insights.push(`Main finding: ${String(result.explanation)}`);
    }
    
    // Extract insights from metrics
    if (result.metrics?.adaptation?.adjustments) {
      const adjustments = result.metrics.adaptation.adjustments;
      if (Array.isArray(adjustments)) {
        insights.push(...adjustments.map(adj => String(adj)));
      }
    }
    
    // Extract insights from failed approaches
    if (result.metrics?.adaptation?.previousApproaches) {
      result.metrics.adaptation.previousApproaches
        .filter((a: any) => !a.success && typeof a.approach === 'string')
        .forEach((a: any) => {
          insights.push(`Failed approach: ${String(a.approach)} - ${String(a.reason || 'Unknown reason')}`);
        });
    }

    return insights;
  }

  private findRelatedScenarios(
    currentType: string,
    result: any
  ): string[] {
    const related = new Set<string>();
    
    // Check for related error types
    const errorPatterns: Record<string, RegExp[]> = {
      async: [/timing|race|condition|concurrent|parallel/i],
      cache: [/stale|invalid|outdated|sync/i],
      dependency: [/missing|version|incompatible|require/i],
      environment: [/config|env|setting|path/i]
    };

    // Check result explanation against patterns
    const explanation = typeof result.explanation === 'string' ? result.explanation : '';
    for (const [type, patterns] of Object.entries(errorPatterns)) {
      if (type !== currentType && patterns.some(p => p.test(explanation))) {
        related.add(type);
      }
    }

    // Check for resource overlap with other scenarios
    for (const [type, insight] of this.insights.entries()) {
      if (type !== currentType) {
        const currentResources = new Set(result.metrics?.progress?.resourcesUsed || []);
        const otherResources = new Set(insight.metrics?.progress?.resourcesUsed || []);
        
        // If scenarios touch the same resources, they might be related
        const overlap = [...currentResources].some(r => 
          typeof r === 'string' && otherResources.has(r)
        );
        if (overlap) {
          related.add(type);
        }
      }
    }

    return Array.from(related);
  }

  private updateSuccessPattern(scenarioType: string, result: any) {
    // Increment success count for this pattern
    const currentCount = this.successPatterns.get(scenarioType) || 0;
    this.successPatterns.set(scenarioType, currentCount + 1);
    
    this.logger.debug('Updated success pattern', {
      scenarioType,
      successCount: currentCount + 1
    });
  }

  // Result aggregation
  async aggregateResults(): Promise<AggregatedResult> {
    const successfulScenarios = Array.from(this.insights.values())
      .filter(i => i.success)
      .sort((a, b) => b.confidence - a.confidence);

    if (successfulScenarios.length === 0) {
      return this.createFailureResult();
    }

    // Find the best primary solution
    const primary = successfulScenarios[0];
    const supporting = successfulScenarios.slice(1);
    
    // Check for conflicts between solutions
    const conflicts = this.findSolutionConflicts(primary, supporting);
    
    // Aggregate metrics
    const metrics = this.aggregateMetrics(successfulScenarios);

    // Calculate overall confidence
    const confidence = this.calculateAggregatedConfidence(
      primary,
      supporting,
      conflicts
    );

    return {
      success: true,
      confidence,
      primaryFix: primary.insights[0] || 'Unknown fix',
      supportingFixes: supporting.map(s => s.insights[0] || 'Unknown fix'),
      conflicts,
      metrics
    };
  }

  private createFailureResult(): AggregatedResult {
    return {
      success: false,
      confidence: 0,
      primaryFix: 'No successful fixes found',
      supportingFixes: [],
      conflicts: [],
      metrics: {
        successProbability: 0,
        fixComplexity: 5,
        sideEffectRisk: 5,
        progress: {
          stepsCompleted: 0,
          totalSteps: 0,
          timeSpent: 0,
          resourcesUsed: []
        },
        testing: {
          casesRun: 0,
          casesPassed: 0,
          coverage: 0,
          validationSteps: []
        },
        adaptation: {
          attemptNumber: 0,
          previousApproaches: [],
          adjustments: []
        }
      }
    };
  }

  private findSolutionConflicts(
    primary: ScenarioInsight,
    supporting: ScenarioInsight[]
  ) {
    const conflicts: AggregatedResult['conflicts'] = [];
    
    // Check for resource conflicts
    const resourceMap = new Map<string, string[]>();
    
    // Helper to add resource usage
    const addResources = (scenario: ScenarioInsight, resources: string[]) => {
      resources.forEach(resource => {
        const users = resourceMap.get(resource) || [];
        users.push(scenario.scenarioType);
        resourceMap.set(resource, users);
      });
    };
    
    // Add primary scenario resources
    const primaryMetrics = primary.metrics as AnalysisMetrics;
    if (primaryMetrics?.progress?.resourcesUsed) {
      addResources(primary, primaryMetrics.progress.resourcesUsed);
    }
    
    // Check supporting scenarios for conflicts
    supporting.forEach(scenario => {
      const metrics = scenario.metrics as AnalysisMetrics;
      if (metrics?.progress?.resourcesUsed) {
        const resources = metrics.progress.resourcesUsed;
        
        resources.forEach(resource => {
          const users = resourceMap.get(resource);
          if (users && users.length > 0) {
            conflicts.push({
              scenarios: [...users, scenario.scenarioType],
              reason: `Multiple scenarios modifying resource: ${resource}`
            });
          }
        });
        
        addResources(scenario, resources);
      }
    });
    
    return conflicts;
  }

  private aggregateMetrics(scenarios: ScenarioInsight[]): AnalysisMetrics {
    // Start with empty metrics
    const aggregated: AnalysisMetrics = {
      successProbability: 0,
      fixComplexity: 0,
      sideEffectRisk: 0,
      progress: {
        stepsCompleted: 0,
        totalSteps: 0,
        timeSpent: 0,
        resourcesUsed: []
      },
      testing: {
        casesRun: 0,
        casesPassed: 0,
        coverage: 0,
        validationSteps: []
      },
      adaptation: {
        attemptNumber: 0,
        previousApproaches: [],
        adjustments: []
      }
    };

    // Combine metrics from all scenarios
    scenarios.forEach(scenario => {
      const metrics = scenario.metrics as AnalysisMetrics;
      if (!metrics) return;

      // Aggregate success probability (weighted by confidence)
      aggregated.successProbability += (metrics.successProbability * scenario.confidence);
      
      // Take max of complexity and risk
      aggregated.fixComplexity = Math.max(aggregated.fixComplexity, metrics.fixComplexity);
      aggregated.sideEffectRisk = Math.max(aggregated.sideEffectRisk, metrics.sideEffectRisk);
      
      // Sum progress metrics
      aggregated.progress.stepsCompleted += metrics.progress.stepsCompleted;
      aggregated.progress.totalSteps += metrics.progress.totalSteps;
      aggregated.progress.timeSpent += metrics.progress.timeSpent;
      
      // Combine unique resources
      const resourceSet = new Set([
        ...aggregated.progress.resourcesUsed,
        ...metrics.progress.resourcesUsed
      ]);
      aggregated.progress.resourcesUsed = Array.from(resourceSet);
      
      // Sum test metrics
      aggregated.testing.casesRun += metrics.testing.casesRun;
      aggregated.testing.casesPassed += metrics.testing.casesPassed;
      
      // Average coverage
      if (metrics.testing.coverage > 0) {
        aggregated.testing.coverage = (
          aggregated.testing.coverage + metrics.testing.coverage
        ) / 2;
      }
      
      // Combine validation steps
      aggregated.testing.validationSteps = [
        ...aggregated.testing.validationSteps,
        ...metrics.testing.validationSteps
      ];
      
      // Combine adaptation data
      aggregated.adaptation.attemptNumber = Math.max(
        aggregated.adaptation.attemptNumber,
        metrics.adaptation.attemptNumber
      );
      aggregated.adaptation.previousApproaches = [
        ...aggregated.adaptation.previousApproaches,
        ...metrics.adaptation.previousApproaches
      ];
      aggregated.adaptation.adjustments = [
        ...aggregated.adaptation.adjustments,
        ...metrics.adaptation.adjustments
      ];
    });

    // Normalize success probability
    aggregated.successProbability /= scenarios.length;

    return aggregated;
  }

  private calculateAggregatedConfidence(
    primary: ScenarioInsight,
    supporting: ScenarioInsight[],
    conflicts: AggregatedResult['conflicts']
  ): number {
    // Start with primary confidence
    let confidence = primary.confidence;
    
    // Boost confidence based on supporting scenarios
    supporting.forEach(scenario => {
      // Add diminishing returns for each supporting scenario
      confidence += (scenario.confidence * 0.1);
    });
    
    // Reduce confidence based on conflicts
    conflicts.forEach(() => {
      confidence *= 0.8; // 20% reduction per conflict
    });
    
    // Consider historical success patterns
    const historicalSuccess = this.successPatterns.get(primary.scenarioType) || 0;
    if (historicalSuccess > 0) {
      confidence *= (1 + (historicalSuccess * 0.05)); // 5% boost per historical success
    }
    
    // Ensure confidence stays in 0-1 range
    return Math.min(Math.max(confidence, 0), 1);
  }

  // Scenario selection enhancement
  getPrioritizedScenarios(errorType: string): string[] {
    const priorities = new Map<string, number>();
    
    // Consider historical success rates
    for (const [type, successes] of this.successPatterns.entries()) {
      priorities.set(type, successes);
    }
    
    // Consider error type patterns
    const errorPatterns: Record<string, RegExp> = {
      async: /timing|race|condition|concurrent|parallel/i,
      cache: /stale|invalid|outdated|sync/i,
      dependency: /missing|version|incompatible|require/i,
      environment: /config|env|setting|path/i
    };
    
    for (const [type, pattern] of Object.entries(errorPatterns)) {
      if (pattern.test(errorType)) {
        const currentPriority = priorities.get(type) || 0;
        priorities.set(type, currentPriority + 2); // Boost matching patterns
      }
    }
    
    // Sort scenarios by priority
    return Array.from(priorities.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([type]) => type);
  }
}
