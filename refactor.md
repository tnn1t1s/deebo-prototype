MCP Refactoring Plan

This document outlines our refactoring roadmap for Deebo's MCP-based architecture. It captures progress made so far, areas requiring improvement, and our next critical steps. Our aim is to achieve a production-ready, robust, and elegantly modular debugging system that leverages OS-level process isolation while providing comprehensive logging and standardized error handling.

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

✅ Resource Implementation (src/resources/index.ts)
	•	Resource API Migration:
Successfully migrated to the new resource API with proper templates.
	•	Type Definitions:
Updated type definitions with proper TypeScript types and Zod schemas.
	•	Change Notifications:
Implemented standardized change notifications using McpServer's notification system.
	•	Session Management:
Added robust session tracking with proper lifecycle management.

✅ Tool Implementation (src/tools/index.ts)
	•	Tool API Migration:
Completed migration to new tool API with standardized interfaces.
	•	Schema Validation:
Fully integrated Zod for parameter validation with comprehensive schemas.
	•	Response Standardization:
Implemented consistent response types using debugSessionResponseSchema.
	•	Error Handling:
Enhanced error handling with proper error types and logging.

✅ Transport Layer (src/transports/)
	•	Standardized Transports:
Successfully using standard SDK transports (StdioServerTransport and SSEServerTransport).
	•	Connection Lifecycle:
Implemented robust connection state management with initialization, monitoring, and cleanup.
	•	Reconnection Support:
Added comprehensive reconnection logic with state tracking and proper error handling.
	•	Cleanup Handlers:
Implemented thorough cleanup routines for transport lifecycle management.

✅ Client Implementation (src/util/mcp.ts)
	•	Client State Management:
Added centralized client management with proper state tracking.
	•	Error Handling & Monitoring:
Implemented comprehensive error handling with detailed context and logging.
	•	Connection Lifecycle:
Added robust connection management with initialization checks and cleanup.
	•	Capability Validation:
Added thorough capability validation for all MCP connections.
	•	Integration Updates:
Updated scenario agent and mother agent to work with improved client implementation.

⸻

Remaining Work

4. Comprehensive Testing
	•	Unit Tests:
Write tests for each MCP component, ensuring that resource handling, tool execution, and transport lifecycle are thoroughly validated.
	•	Integration Tests:
Test end-to-end scenarios, including error cases and reconnection scenarios.
	•	Test Protocols:
Follow the guidelines specified in .clinerules to simulate real-world debugging sessions.

5. Final Documentation
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
	1.	Testing Infrastructure
	•	Set up testing framework
	•	Write unit and integration tests
	•	Create test scenarios
	•	Estimate: ~4-5 hours

	2.	Documentation & Final Review
	•	Complete JSDoc annotations
	•	Write API documentation
	•	Create troubleshooting guide
	•	Estimate: ~2-3 hours

⸻

Final Notes
	•	TypeScript Best Practices:
Use strict typing throughout and keep code clean and modular.
	•	Logging & Error Recovery:
Comprehensive logging and error handling are essential for production stability.
	•	Testing & Security:
Thorough testing and security practices must be integrated before deployment.