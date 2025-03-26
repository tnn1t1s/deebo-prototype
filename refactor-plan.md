# Deebo Prototype MCP Server Refactoring Plan

## Overview

This refactoring plan outlines the steps to update the Deebo prototype MCP server to fully align with the Model Context Protocol (MCP) specifications and improve production readiness. The plan is optimized for minimum engineering effort while maximizing robustness.

## Current State Analysis

The current implementation has:

- Basic MCP SDK integration
- Three tools: `start_debug_session`, `check_debug_status`, `cancel_debug_session`
- Resource system with deebo:// URI scheme
- Protocol layer with JSON-RPC 2.0 support
- Stdio transport only
- Basic logging throughout codebase
- Mother agent and scenario agent architecture

## Implementation Priorities

### 🥇 Tier 1 – Critical for Reliability (Must-Have)

1. Zod Validation of Claude Output
- Why: Prevent crashes from malformed LLM output
- Location: scenario-agent.ts
- Implementation:
```typescript
const ActionSchema = z.object({
  tool: z.enum(['git-mcp', 'desktop-commander']),
  name: z.string(),
  args: z.record(z.unknown())
});

const ClaudeResponseSchema = z.object({
  actions: z.array(ActionSchema),
  complete: z.boolean(),
  success: z.boolean().optional(),
  explanation: z.string().optional()
});
```

2. Timeout Wrapping for MCP Tool Calls
- Why: Prevent hung agents from blocking sessions
- Location: scenario-agent.ts
- Implementation:
```typescript
const timeoutPromise = <T>(promise: Promise<T>, ms: number, operation: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Operation '${operation}' timed out after ${ms}ms`)), ms)
    )
  ]) as Promise<T>;
};
```

3. Structured Logs with Timestamps
- Why: Enable real-time log inspection and better debugging
- Location: All agent files
- Implementation:
```typescript
interface LogEvent {
  timestamp: string;
  agent: string;
  event: string;
  status: string;
  metadata?: Record<string, unknown>;
}
```

### 🥈 Tier 2 – Resilience and Scaling

4. Retry Logic for Claude and Tool Calls
- Why: Handle transient failures gracefully
- Location: scenario-agent.ts, mother-agent.ts
- Implementation:
```typescript
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 500
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, baseDelay * Math.pow(2, i)));
    }
  }
  throw new Error('Unreachable');
}
```

5. Concurrency Limit (Mother Agent Worker Pool)
- Why: Prevent resource exhaustion with many scenarios
- Location: mother-agent.ts
- Implementation:
```typescript
import pLimit from 'p-limit';
const limit = pLimit(10);
await Promise.all(prompts.map(p => limit(() => runScenario(p))));
```

### 🥉 Tier 3 – Flexibility and UX

6. Configurable Tool Mapping
- Why: Avoid hardcoding tool paths in agents
- Location: scenario-agent.ts
- Implementation: JSON config file for tool paths

7. Scenario Agent Micro-OODA Loop
- Why: Enable intelligent, self-prompting agents
- Location: scenario-agent.ts
- Implementation: Enhanced loop with result analysis

8. Mother Agent Macro-OODA Loop
- Why: Enable adaptive strategy planning
- Location: mother-agent.ts
- Implementation: Strategy adjustment based on results

### 🧊 Optional/Stretch Goals

9. Session Persistence
- Why: Survive MCP server restarts
- Implementation: JSON file storage or Redis integration

10. Live Log Streaming
- Why: Real-time feedback to clients
- Implementation: New MCP tool for log events

## Implementation Plan

### Phase 1: Core Reliability (Days 1-2)
1. Implement Zod validation
2. Add timeout wrapping
3. Enhance logging structure

### Phase 2: Resilience (Days 3-4)
1. Implement retry logic
2. Add concurrency control
3. Configure tool mapping

### Phase 3: Intelligence (Days 5-7)
1. Enhance OODA loops
2. Improve agent coordination
3. Add persistence if time permits

## Success Metrics

The refactoring will be considered successful when:
1. All Tier 1 items are implemented and tested
2. No crashes occur from malformed LLM output
3. Agents handle failures gracefully
4. System scales efficiently with multiple scenarios
5. Logs provide clear debugging insights

## Testing Strategy

For each component:
1. Unit test core functionality
2. Integration test with other components
3. Load test with multiple concurrent sessions
4. Error injection to verify handling
5. Log analysis to verify observability
