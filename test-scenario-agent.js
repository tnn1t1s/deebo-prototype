import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

async function testScenario() {
  try {
    // Set required environment variables
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.DEEBO_ROOT = process.cwd();

    // Initialize core
    const { initializeCore } = await import('./build/util/init.js');
    const { runScenarioAgent } = await import('./build/scenario-agent.js');
    
    // Create test server instance
    const server = new McpServer({
      name: "test-server",
      version: "1.0.0"
    });

    // Create and connect transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    await initializeCore(server);

    console.log('Running test scenario...');
    
    // Test scenario configuration
    const testConfig = {
      id: "test-scenario",
      session: "test-session", // Match the parameter name expected by scenario agent
      sessionId: "test-session",
      hypothesis: "Testing direct scenario agent execution",
      error: "Sample error for testing",
      context: "Test execution context",
      language: "typescript",
      repoPath: process.cwd()
    };

    // Run scenario agent
    await runScenarioAgent(testConfig);
    
  } catch (error) {
    console.error('Test scenario failed:', error);
    process.exit(1);
  } finally {
    console.log('Cleaning up...');
    if (transport) {
      await transport.close();
    }
    console.log('Cleanup complete');
  }
}

// Run the test
testScenario();