import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

/**
 * Validates that a log entry can be properly stringified and parsed as JSON
 * @param entry The log entry object to validate
 * @returns The stringified log entry
 * @throws Error if the entry cannot be properly stringified and parsed
 */
export function validateAndStringifyLog(entry: unknown): string {
  const stringified = JSON.stringify(entry);
  try {
    // Verify the stringified entry can be parsed back
    JSON.parse(stringified);
    return stringified;
  } catch (error) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid log entry: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Creates a standardized log entry object
 * @param type The type of log entry
 * @param message The log message
 * @param data Additional data to include
 * @returns Stringified log entry
 */
export function createLogEntry(
  type: string,
  message: string,
  data?: Record<string, unknown>
): string {
  return validateAndStringifyLog({
    timestamp: new Date().toISOString(),
    type,
    message,
    data
  });
}
