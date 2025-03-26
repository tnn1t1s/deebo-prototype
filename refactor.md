MCP Refactoring Plan

This document outlines our refactoring roadmap for Deebo’s MCP-based architecture. It captures progress made so far, areas requiring improvement, and our next critical steps. Our aim is to achieve a production-ready, robust, and elegantly modular debugging system that leverages OS-level process isolation while providing comprehensive logging and standardized error handling.

⸻

Progress So Far

✅ Server Initialization (src/index.ts)
	•	McpServer Migration:
Replaced legacy Server class with McpServer from the SDK.
	•	Capability Declarations:
Standardized tool and resource capability definitions.
	•	Error Handling & Logging:
Structured logging has been added (using our internal logger modules) and error handling improved.
	•	Transport:
The server now uses the standard StdioServerTransport.

✅ Logging & Protocols
	•	Structured Logging:
Logging has been refactored to use timestamped, structured log entries. Logs are aggregated at the mother agent level, and each tool call is recorded in JSON format (NDJSON is planned for further improvements).
	•	Error Codes:
Preliminary standardization is in place, with error codes and context information provided in log events.

🚧 Resource Implementation (src/resources/index.ts)
	•	Resource API Migration:
Switched to the new resource API.
	•	Issues Remaining:
	•	Resource template definitions need refinement (e.g., URI template parameters for {sessionId} and {resourceType}).
	•	Type definitions for resources require updates.
	•	Change notifications for resource updates are pending implementation.

🚧 Tool Implementation (src/tools/index.ts)
	•	Tool API Migration:
Started migrating to the new tool API.
	•	Schema Validation:
Integration of Zod for parameter validation is underway.
	•	Tool Change Notifications:
Not yet fully implemented; progress reporting for long-running tool calls needs work.
	•	Error Handling:
Error handling is basic and will be enhanced with timeout management and retry logic.

🚧 Transport Layer (src/transports/)
	•	Custom Transport Removal:
Legacy transport code is being phased out in favor of standard SDK transports.
	•	Connection Lifecycle:
Work is in progress to add proper connection initialization, monitoring, and cleanup.

🚧 Client Implementation (src/util/mcp.ts)
	•	Client Initialization:
Updated to use the new McpClient API with proper capability checks.
	•	Error Handling & Connection Management:
Improvements in error handling and lifecycle management are pending.

⸻

Remaining Work

1. Fix Resource Implementation
	•	Template Refinement:
Update resource templates with proper URI parameterization. For example:

const sessionTemplate: ResourceTemplate = {
  name: "Session Resources",
  uriTemplate: "deebo://sessions/{sessionId}/{resourceType}",
  mimeType: "application/json",
  description: "Access session status and logs"
};


	•	Type Definitions:
Complete type annotations for resource objects.
	•	Change Notifications:
Implement notifications for resource changes to enable live updates in client dashboards.

2. Complete Tool Implementation (src/tools/index.ts)
	•	Tool API Migration:
Fully migrate tool registrations to the new API.
	•	Schema Validation:
Use Zod to validate all incoming parameters.
	•	Progress Reporting:
Add mechanisms for tools to report progress (and timeouts, e.g., maximum 30 seconds per tool).
	•	Error Handling:
Enhance with retries (exponential backoff) and proper error logging.

3. Finalize Transport Layer (src/transports/)
	•	Standardize Transports:
Remove legacy code and adopt the standard transports provided by the SDK.
	•	Connection Lifecycle:
Implement connection state monitoring, proper initialization, and cleanup handlers.
	•	Reconnection Logic:
Add reconnection support if connections drop unexpectedly.

4. Refine Client Implementation (src/util/mcp.ts)
	•	Proper Initialization:
Ensure the MCP client is initialized with full capability checks.
	•	Error Handling:
Improve error management and ensure that all operations report meaningful error context.
	•	Connection Management:
Enhance lifecycle handling (open, monitor, close) and integrate with the logging system.

5. Enhanced Error Handling
	•	Standardize Error Codes:
Define a consistent set of error codes (e.g., using an enum) and include contextual information with every error.
	•	Error Recovery:
Where possible, add fallback strategies for transient failures.
	•	Centralized Error Logging:
Use the logger to capture and report errors in a structured way:

try {
  // Operation
} catch (error) {
  if (error instanceof McpError) {
    logger.error('MCP error', {
      code: error.code,
      message: error.message
    });
  }
  throw error;
}



6. Comprehensive Testing
	•	Unit Tests:
Write tests for each MCP component, ensuring that resource handling, tool execution, and transport lifecycle are thoroughly validated.
	•	Integration Tests:
Test end-to-end scenarios, including error cases and reconnection scenarios.
	•	Test Protocols:
Follow the guidelines specified in .clinerules to simulate real-world debugging sessions.

7. Final Documentation
	•	JSDoc Comments:
Add detailed JSDoc annotations across the codebase.
	•	API Documentation:
Document MCP capabilities, error codes, resource URIs, and usage examples.
	•	Troubleshooting Guide:
Write a maintainer guide detailing common issues and their resolutions.
	•	Test Results:
Publish a summary of testing outcomes and user feedback for each phase.

⸻

MCP Best Practices to Follow
	1.	Resource Management
	•	Use URI templates accurately.
	•	Include comprehensive metadata.
	•	Handle errors gracefully and support change notifications.
	2.	Tool Implementation
	•	Employ strict schema validation.
	•	Document tool parameters and expected responses.
	•	Implement progress reporting and timeout handling.
	3.	Transport Layer
	•	Rely on standard SDK transports.
	•	Implement full connection lifecycle management with cleanup and reconnection support.
	4.	Error Handling
	•	Use standardized error codes and include full context in logs.
	•	Ensure all operations are wrapped with proper error recovery mechanisms.
	5.	Security
	•	Validate and sanitize all inputs.
	•	Check permissions rigorously.
	•	Encrypt sensitive data and follow best practices for environment variable management.

⸻

Next Steps (Critical Path)
	1.	Resource Template Implementation (High Priority)
	•	Update and validate URI templates.
	•	Implement change notification mechanisms.
	•	Estimate: ~2–3 hours.
	2.	Tool API Completion
	•	Fully migrate to new tool API with Zod validation.
	•	Implement progress reporting and timeout handling.
	•	Estimate: ~3–4 hours.
	3.	Transport Layer Finalization
	•	Remove legacy transport code.
	•	Implement connection state monitoring and cleanup.
	•	Estimate: ~2–3 hours.
	4.	Client Implementation Refinement
	•	Ensure full MCP client capability checks.
	•	Improve error handling and connection lifecycle.
	•	Estimate: ~2 hours.
	5.	Enhanced Error Handling & Logging
	•	Standardize error codes.
	•	Integrate structured NDJSON logging for real-time insights.
	•	Implement retry logic with exponential backoff.
	•	Estimate: ~2–3 hours.
	6.	Comprehensive Testing
	•	Write and execute unit/integration tests.
	•	Validate scenarios, error conditions, and recovery paths.
	•	Estimate: ~3–4 hours.
	7.	Final Documentation
	•	Update API docs, error codes, and usage examples.
	•	Publish a troubleshooting guide.
	•	Estimate: ~2 hours.

⸻

Final Notes
	•	TypeScript Best Practices:
Use strict typing throughout and keep code clean and modular.
	•	Logging & Error Recovery:
Comprehensive logging and error handling are essential for production stability.
	•	Testing & Security:
Thorough testing and security practices must be integrated before deployment.