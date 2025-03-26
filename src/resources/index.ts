import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { 
  ErrorCode, 
  ListResourcesRequestSchema, 
  ReadResourceRequestSchema, 
  McpError 
} from "@modelcontextprotocol/sdk/types.js";

// Track active sessions for resource access
// Will be updated by the main server code
export const activeSessions = new Map<string, any>();

// Ensure initialization is complete before creating logger
let isInitialized = false;
let logger: any; // Type will be set when logger is created

export function setInitialized() {
  isInitialized = true;
}

async function getLogger() {
  if (!isInitialized) {
    throw new Error('Cannot create logger - system not initialized');
  }
  
  if (!logger) {
    const { createLogger } = await import("../util/logger.js");
    logger = createLogger('server', 'resources');
  }
  return logger;
}

// Handler for listing available resources
async function handleListResources() {
  const log = await getLogger();
  log.debug('Processing resources/list request');
  
  const resources = [];
  
  // Add static resources
  resources.push({
    uri: 'deebo://system/status',
    name: 'System Status',
    description: 'Current status of the Deebo debugging system',
    mimeType: 'application/json'
  });
  
  // Add dynamic resources for active sessions
  for (const [sessionId, session] of activeSessions.entries()) {
    resources.push({
      uri: `deebo://sessions/${sessionId}/status`,
      name: `Session ${sessionId} Status`,
      description: 'Current status of this debugging session',
      mimeType: 'application/json'
    });
    
    resources.push({
      uri: `deebo://sessions/${sessionId}/logs`,
      name: `Session ${sessionId} Logs`,
      description: 'Logs from this debugging session',
      mimeType: 'application/json'
    });
  }
  
  log.info(`Listed ${resources.length} resources`);
  return { resources };
}

// Handler for reading resources
async function handleReadResource(request: { params: { uri: string } }) {
  const { uri } = request.params;
  const log = await getLogger();
  log.info('Processing resources/read request', { uri });
  
  try {
    // System status resource
    if (uri === 'deebo://system/status') {
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            status: 'online',
            version: '0.1.0',
            activeSessions: Array.from(activeSessions.keys()),
            timestamp: new Date().toISOString()
          }, null, 2)
        }]
      };
    }
    
    // Session resources
    const sessionMatch = uri.match(/^deebo:\/\/sessions\/([^/]+)\/([^/]+)$/);
    if (sessionMatch) {
      const [_, sessionId, resourceType] = sessionMatch;
      
      // Check if session exists
      const session = activeSessions.get(sessionId);
      if (!session) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Session not found: ${sessionId}`
        );
      }
      
      if (resourceType === 'status') {
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              id: session.id,
              status: session.status,
              startTime: new Date(session.startTime).toISOString(),
              lastChecked: new Date(session.lastChecked).toISOString(),
              scenarioCount: session.scenarioResults.length,
              error: session.error || null
            }, null, 2)
          }]
        };
      }
      
      if (resourceType === 'logs') {
        return {
          contents: [{
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              id: session.id,
              logs: session.logs,
              timestamp: new Date().toISOString()
            }, null, 2)
          }]
        };
      }
    }
    
    // Resource not found
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Resource not found: ${uri}`
    );
  } catch (error) {
    log.error('Error processing resource request', { 
      uri, 
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * Initialize resource capabilities for the MCP server
 * @param server The MCP server instance
 */
export async function initializeResources(server: Server) {
  const log = await getLogger();
  log.info('Initializing resource handlers');

  // Set up request handlers
  server.setRequestHandler(ListResourcesRequestSchema, handleListResources);
  server.setRequestHandler(ReadResourceRequestSchema, handleReadResource);
  
  log.info('Resource handlers initialized');
}
