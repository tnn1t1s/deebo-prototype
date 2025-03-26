import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { initializeDirectories } from './util/init.js';
import dotenv from "dotenv";

// Configure environment
dotenv.config();

// Initialize directories synchronously before any imports that might need them
try {
  // Set DEEBO_ROOT to current working directory as default
  process.env.DEEBO_ROOT = process.cwd();
  initializeDirectories();
} catch (error) {
  console.error('Failed to initialize directories:', error);
  process.exit(1);
}

// Now that directories are initialized and DEEBO_ROOT is set, we can import modules that need logging
import { createLogger, Logger } from './util/logger.js';
import { createTransport } from './transports/base.js';

// Create main logger
let logger: Logger;
try {
  logger = createLogger('server', 'mcp-server');
} catch (error) {
  console.error('Failed to create logger:', error);
  process.exit(1);
}

/**
 * Server configuration
 * These can be set by environment variables
 */
const CONFIG = {
  // Server info
  name: process.env.SERVER_NAME || "deebo-prototype",
  version: process.env.SERVER_VERSION || "0.1.0",
  
  // Transport configuration
  transport: {
    type: (process.env.TRANSPORT_TYPE || "stdio") as "stdio" | "sse",
    port: parseInt(process.env.TRANSPORT_PORT || "3000", 10),
    path: process.env.TRANSPORT_PATH || "/mcp"
  }
};

/**
 * Initialize and start the MCP server
 */
async function startServer() {
  logger.info('Starting Deebo MCP server', { 
    name: CONFIG.name,
    version: CONFIG.version,
    transport: CONFIG.transport.type,
    cwd: process.cwd()
  });
  
  try {
    // Create the MCP server
    const server = new Server({
      name: CONFIG.name,
      version: CONFIG.version,
    }, {
      capabilities: {
        resources: {},
        tools: {}
      }
    });
    
    // Dynamically import modules
    const { initializeResources, activeSessions, setInitialized: setResourcesInitialized } = await import('./resources/index.js');
    const { initializeTools } = await import('./tools/index.js');
    const { setInitialized: setProtocolInitialized } = await import('./protocol/index.js');
    const { initializeAgents, setInitialized: setAgentsInitialized } = await import('./agents/index.js');
    const { initializeTransports, setInitialized: setTransportsInitialized } = await import('./transports/index.js');
    
    // Mark system as initialized so modules can create loggers
    setResourcesInitialized();
    setProtocolInitialized();
    setAgentsInitialized();
    setTransportsInitialized();
    
    // Set up resources
    await initializeResources(server);
    logger.info('Resources initialized');
    
    // Set up tools
    await initializeTools(server);
    logger.info('Tools initialized');
    
    // Set up agents
    await initializeAgents(server);
    logger.info('Agents initialized');
    
    // Set up transports
    await initializeTransports(server);
    logger.info('Transports initialized');
    
    // Set up error handler
    server.onerror = (error: any) => {
      logger.error('Server error', { 
        message: error.message,
        code: error instanceof McpError ? error.code : ErrorCode.InternalError
      });
    };
    
    // Get the appropriate transport
    const transport = await createTransport(CONFIG.transport.type, {
      port: CONFIG.transport.port,
      path: CONFIG.transport.path
    });
    
    // Connect to transport
    await server.connect(transport);
    logger.info(`Server connected to ${CONFIG.transport.type} transport`);
    
    // Log successful startup
    logger.info('Deebo MCP server running', { 
      transport: CONFIG.transport.type,
      port: CONFIG.transport.type === 'sse' ? CONFIG.transport.port : undefined
    });
    
    // Set up cleanup handlers
    process.on('SIGINT', () => {
      logger.info('Server shutting down');
      
      // Close active sessions
      for (const [sessionId, session] of activeSessions.entries()) {
        logger.info('Cleaning up session', { sessionId });
        session.status = 'error';
        session.error = 'Server shutdown';
        session.logs.push('Session terminated due to server shutdown');
      }
      
      logger.info('Cleanup complete');
      logger.close();
      process.exit(0);
    });

    process.on('uncaughtException', (error: any) => {
      logger.error('Uncaught exception', { error: error.message, stack: error.stack });
      logger.close();
      process.exit(1);
    });
    
    return server;
  } catch (error: any) {
    logger.error('Failed to start server', { error: error.message });
    throw error;
  }
}

// Start the server
startServer().catch((error: any) => {
  console.error('Fatal error starting server:', error);
  process.exit(1);
});
