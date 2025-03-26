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

## Implementation Status

### ✅ Completed: Tier 1 – Critical for Reliability

1. Zod Validation of Claude Output
- Implemented in scenario-agent.ts
- Added ActionSchema and ClaudeResponseSchema
- Validates all Claude responses before processing
- Provides detailed error messages for invalid responses

2. Timeout Wrapping for MCP Tool Calls
- Implemented in scenario-agent.ts
- Added timeoutPromise utility
- 10s timeout for MCP tool calls
- 30s timeout for Claude API calls
- Prevents hung operations

3. Structured Logs with Timestamps
- Implemented across all components
- Added LogEvent interface
- JSON-formatted logs with timestamps
- Consistent metadata structure
- Operation tracking and status levels

### ✅ Completed: Tier 2 – Resilience and Scaling

4. Retry Logic for Claude and Tool Calls
- Implemented withRetry utility with exponential backoff
- Added retry logic to:
  - Claude API calls (30s timeout, 3 retries)
  - Git tool operations (10s timeout, 3 retries)
  - Desktop tool operations (10s timeout, 3 retries)
- Added comprehensive retry logging
- Implemented proper error handling

5. Concurrency Limit (Mother Agent Worker Pool)
- Added p-limit dependency
- Implemented worker pool with 3 concurrent slots
- Added worker status logging
- Improved resource management

### 🔄 In Progress: Tier 3 – Flexibility and UX

6. ✅ Configurable Tool Mapping
- Created tools-config.json schema with validation
- Implemented ToolConfigManager with:
  - Config loading and validation
  - Hot reloading support
  - Action allowlist enforcement
  - Retry/timeout configuration
- Updated tool resolution to use config
- Added comprehensive error handling

7. ✅ Scenario Agent Micro-OODA Loop
- Added comprehensive metrics tracking:
  - Success probability calculation
  - Fix complexity assessment
  - Side effect risk evaluation
- Implemented self-correction:
  - Failed attempt detection and logging
  - Approach adjustment based on failures
  - Alternative solution exploration
- Added detailed progress tracking:
  - Step completion monitoring
  - Time tracking
  - Resource usage tracking
- Enhanced testing framework:
  - Default test case generation
  - Validation step management
  - Rollback capabilities
- Improved error handling and recovery

8. ✅ Mother Agent Macro-OODA Loop
- Implemented comprehensive strategy coordination:
  - Insight sharing between agents
  - Resource overlap detection
  - Pattern-based scenario relationships
- Added sophisticated result aggregation:
  - Confidence-weighted solution combining
  - Conflict detection and resolution
  - Resource usage tracking
- Enhanced scenario selection:
  - Historical success pattern learning
  - Error pattern matching
  - Dynamic priority adjustment
- Added metrics aggregation:
  - Combined success probabilities
  - Risk and complexity assessment
  - Resource usage tracking
  - Test coverage analysis

### 🎯 Next Phase: Optional Goals

### 🎯 Optional Goals

9. Session Persistence
- Design storage schema
- Implement file-based storage
- Add recovery logic
- Handle state restoration

10. Live Log Streaming
- Design streaming interface
- Implement log forwarding
- Add real-time updates
- Create log viewer tool

## Next Steps

1. Immediate (Next 24 Hours):
- Implement retry logic with exponential backoff
- Add concurrency control to mother agent
- Create basic tool configuration system

2. Short Term (Week 1):
- Complete all Tier 2 items
- Begin Tier 3 implementation
- Add comprehensive tests

3. Medium Term (Week 2):
- Complete Tier 3 items
- Begin optional goals
- Add performance monitoring

## Success Metrics

1. Reliability:
- Zero crashes from malformed LLM output
- All operations properly timeout
- Comprehensive error logs

2. Scalability:
- Successfully handle 10+ concurrent scenarios
- Proper resource management
- No memory leaks

3. Maintainability:
- Clear logging structure
- Configurable components
- Well-documented code

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
