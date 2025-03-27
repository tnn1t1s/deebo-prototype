import { z } from 'zod';

/**
 * Tool schema definitions using Zod for MCP tools
 * Used for validation and tool registration
 */

// Start debug session tool schema
export const startDebugSessionSchema = z.object({
  name: "start_debug_session",
  description: "Start a debugging session with an error and optional repository path",
  inputSchema: {
    type: "object",
    properties: {
      error_message: z.string()
        .min(1, "Error message is required")
        .describe("Error message from the code to debug"),
      code_context: z.string().optional()
        .describe("Code surrounding the error"),
      language: z.string().optional()
        .describe("Programming language"),
      file_path: z.string().optional()
        .describe("Path to the file with error"),
      repo_path: z.string().optional()
        .describe("Path to Git repository (recommended)")
    })
};

// Check debug status tool schema
export const checkDebugStatusSchema = z.object({
  name: "check_debug_status",
  description: "Check the status of a debugging session",
  inputSchema: {
    type: "object",
    properties: {
      session_id: z.string()
        .uuid("Invalid session ID format")
        .describe("ID of the debug session to check")
    })
};

// Cancel debug session tool schema
export const cancelDebugSessionSchema = z.object({
  name: "cancel_debug_session",
  description: "Cancel a running debugging session",
  inputSchema: {
    type: "object",
    properties: {
      session_id: z.string()
        .uuid("Invalid session ID format")
        .describe("ID of the debug session to cancel"),
      reason: z.string().optional()
        .describe("Optional reason for cancellation")
    })
};

/**
 * Common response schemas for type safety
 */
export const debugSessionResponseSchema = z.object({
  session_id: z.string().uuid(),
  status: z.enum(["pending", "running", "complete", "error", "cancelled"]),
  message: z.string(),
  result: z.any().nullable(),
  timestamp: z.string().datetime()
});

export const debugLogSchema = z.object({
  level: z.enum(["info", "warn", "error", "debug"]),
  message: z.string(),
  timestamp: z.string().datetime(),
  metadata: z.record(z.unknown()).optional()
});

// Get all tool schemas
export function getAllToolSchemas() {
  return [
    {
      name: "start_debug_session",
      description: "Start a debugging session with an error and optional repository path",
      schema: startDebugSessionSchema
    },
    {
      name: "check_debug_status",
      description: "Check the status of a debugging session",
      schema: checkDebugStatusSchema
    },
    {
      name: "cancel_debug_session",
      description: "Cancel a running debugging session",
      schema: cancelDebugSessionSchema
    }
  ];
}
