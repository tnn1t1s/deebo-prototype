# Full Implementation Plan for Agentic Debugging System (ADS)

## 1. System Architecture

### Core Components
- **Mother Agent**: Central orchestrator process
- **Scenario Agents**: Independent LLM agents as separate processes
- **MCP Tools**: Git MCP and File System MCP tools
- **Logging System**: Comprehensive logging for all operations
- **Reporting System**: Aggregation of individual agent reports

## 2. Technical Implementation

### Mother Agent Implementation
```typescript
// src/mother-agent.ts
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';

const SESSION_DIR = './sessions';

async function runMotherAgent(sessionId: string, error: string, context: string, repoPath: string) {
  // Create session directory for logs and reports
  const sessionDir = path.join(SESSION_DIR, sessionId);
  await fs.mkdir(sessionDir, { recursive: true });
  
  // Analyze error to determine appropriate scenario types
  const scenarioTypes = determineScenarioTypes(error, context);
  console.log(`[MOTHER] Selected scenarios: ${scenarioTypes.join(', ')}`);
  
  // Spawn a process for each scenario agent
  const scenarioProcesses = scenarioTypes.map(type => {
    const agentId = `${type}-${uuidv4().substring(0, 8)}`;
    const logFile = path.join(sessionDir, `${agentId}.log`);
    const reportFile = path.join(sessionDir, `${agentId}.report.json`);
    
    // Each agent is a separate process
    const process = spawn('node', [
      'build/scenario-agent.js',
      '--id', agentId,
      '--session', sessionId,
      '--type', type,
      '--error', error,
      '--repo', repoPath,
      '--log', logFile,
      '--report', reportFile
    ], { 
      stdio: 'pipe',
      detached: true // Allow agents to run independently
    });
    
    // Log process events
    process.stdout.on('data', data => {
      console.log(`[AGENT:${agentId}] ${data.toString().trim()}`);
    });
    
    process.stderr.on('data', data => {
      console.error(`[AGENT:${agentId}] ERROR: ${data.toString().trim()}`);
    });
    
    return {
      id: agentId,
      type,
      process,
      logFile,
      reportFile
    };
  });
  
  // Wait for all scenario agents to complete
  const results = await Promise.all(scenarioProcesses.map(scenario => 
    new Promise((resolve) => {
      scenario.process.on('exit', code => {
        console.log(`[MOTHER] Agent ${scenario.id} exited with code ${code}`);
        resolve({
          id: scenario.id,
          type: scenario.type,
          exitCode: code,
          reportFile: scenario.reportFile
        });
      });
    })
  ));
  
  // Aggregate reports
  const reports = await Promise.all(results.map(async result => {
    try {
      const reportContent = await fs.readFile(result.reportFile, 'utf-8');
      return JSON.parse(reportContent);
    } catch (error) {
      console.error(`Failed to read report for ${result.id}: ${error}`);
      return { id: result.id, success: false, error: `Failed to read report: ${error}` };
    }
  }));
  
  // Generate final aggregated report
  const finalReport = generateFinalReport(reports);
  await fs.writeFile(
    path.join(sessionDir, 'final-report.json'),
    JSON.stringify(finalReport, null, 2)
  );
  
  return finalReport;
}
```

### Scenario Agent Implementation
```typescript
// src/scenario-agent.ts
import { spawnSync } from 'child_process';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { runScenarioLLM } from './util/anthropic';

async function main() {
  // Parse command line arguments
  const args = parseArgs(process.argv.slice(2));
  
  // Initialize logging
  const logger = createLogger(args.logFile);
  logger.info(`Starting scenario agent ${args.id} for session ${args.session}`);
  
  // Initialize agent state
  const state = {
    id: args.id,
    sessionId: args.session,
    scenarioType: args.type,
    branchName: `deebo-${args.session}-${args.type}-${Date.now()}`,
    hypothesis: generateHypothesis(args.type, args.error),
    actions: [],
    success: false,
    confidence: 0,
    fix: '',
    explanation: ''
  };
  
  // Create a unique branch for this agent
  logger.info(`Creating branch: ${state.branchName}`);
  executeGitCommand(['checkout', '-b', state.branchName], args.repo, logger);
  
  try {
    // Get initial context
    const context = await getInitialContext(args.repo, args.error, logger);
    
    // Agent operation loop
    let iteration = 0;
    const MAX_ITERATIONS = 5;
    
    while (iteration < MAX_ITERATIONS) {
      logger.info(`Starting iteration ${iteration + 1}`);
      
      // Get next action from LLM
      const response = await runScenarioLLM(
        state.scenarioType,
        state.hypothesis,
        args.error,
        context,
        state.actions
      );
      
      // Parse LLM response for actions
      const action = parseAction(response);
      state.actions.push(action);
      
      // Execute the action
      logger.info(`Executing action: ${action.type}`);
      
      if (action.type === 'read_file') {
        const content = await executeReadFile(action.path, logger);
        context.files[action.path] = content;
      } else if (action.type === 'write_file') {
        await executeWriteFile(action.path, action.content, logger);
      } else if (action.type === 'execute_command') {
        const result = executeCommand(action.command, args.repo, logger);
        context.commandResults[action.command] = result;
      } else if (action.type === 'git_operation') {
        const result = executeGitCommand(action.args, args.repo, logger);
        context.gitResults[action.args.join(' ')] = result;
      } else if (action.type === 'complete') {
        // Agent has determined it's finished
        state.success = action.success;
        state.confidence = action.confidence;
        state.fix = action.fix;
        state.explanation = action.explanation;
        break;
      }
      
      iteration++;
    }
    
    // Write report
    logger.info('Writing final report');
    await fs.writeFile(
      args.reportFile,
      JSON.stringify(state, null, 2)
    );
    
    // Clean up - delete branch after we're done
    logger.info(`Cleaning up branch: ${state.branchName}`);
    executeGitCommand(['checkout', 'main'], args.repo, logger);
    executeGitCommand(['branch', '-D', state.branchName], args.repo, logger);
    
    logger.info('Agent completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error(`Agent failed: ${error}`);
    
    // Try to clean up even on failure
    try {
      executeGitCommand(['checkout', 'main'], args.repo, logger);
      executeGitCommand(['branch', '-D', state.branchName], args.repo, logger);
    } catch (cleanupError) {
      logger.error(`Cleanup failed: ${cleanupError}`);
    }
    
    // Write error report
    await fs.writeFile(
      args.reportFile,
      JSON.stringify({
        ...state,
        success: false,
        error: `${error}`
      }, null, 2)
    );
    
    process.exit(1);
  }
}

// Execute Git command using direct child_process to avoid shared clients
function executeGitCommand(args, repoPath, logger) {
  logger.info(`Git command: git ${args.join(' ')}`);
  const result = spawnSync('git', args, {
    cwd: repoPath,
    encoding: 'utf-8'
  });
  
  if (result.error) {
    logger.error(`Git error: ${result.error}`);
    throw result.error;
  }
  
  if (result.status !== 0) {
    logger.error(`Git command failed: ${result.stderr}`);
    throw new Error(`Git command failed: ${result.stderr}`);
  }
  
  logger.info(`Git result: ${result.stdout}`);
  return result.stdout;
}

// Direct file operations without shared clients
async function executeReadFile(filePath, logger) {
  logger.info(`Reading file: ${filePath}`);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    logger.info(`File read successful: ${filePath} (${content.length} bytes)`);
    return content;
  } catch (error) {
    logger.error(`File read error: ${error}`);
    throw error;
  }
}

// Main function to start the agent
main().catch(error => {
  console.error(`Fatal error: ${error}`);
  process.exit(1);
});
```

### MCP Tool Integration
```typescript
// src/mcp-tool-runner.ts
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

// Function to run an MCP tool as a separate process
export function runMcpTool(toolName, args, logger) {
  return new Promise((resolve, reject) => {
    let command;
    let toolArgs = [];
    
    // Configure based on tool type
    if (toolName === 'git') {
      command = 'npx';
      toolArgs = ['-y', '@modelcontextprotocol/server-git', ...args];
    } else if (toolName === 'filesystem') {
      command = 'npx';
      toolArgs = ['-y', '@modelcontextprotocol/server-filesystem', ...args];
    } else {
      return reject(new Error(`Unknown MCP tool: ${toolName}`));
    }
    
    logger.info(`Running MCP tool: ${toolName} with args: ${args.join(' ')}`);
    
    // Each tool invocation gets its own process/server
    const toolProcess = spawn(command, toolArgs, {
      stdio: 'pipe',
      encoding: 'utf-8'
    });
    
    let stdout = '';
    let stderr = '';
    
    toolProcess.stdout.on('data', data => {
      stdout += data.toString();
      logger.debug(`${toolName} stdout: ${data.toString().trim()}`);
    });
    
    toolProcess.stderr.on('data', data => {
      stderr += data.toString();
      logger.debug(`${toolName} stderr: ${data.toString().trim()}`);
    });
    
    toolProcess.on('close', code => {
      if (code !== 0) {
        logger.error(`${toolName} exited with code: ${code}`);
        logger.error(stderr);
        reject(new Error(`Tool execution failed with code ${code}: ${stderr}`));
      } else {
        logger.info(`${toolName} completed successfully`);
        resolve(stdout);
      }
    });
  });
}
```

### Claude LLM Integration
```typescript
// src/util/anthropic.ts
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const SCENARIO_AGENT_PROMPT = `
You are an autonomous debugging agent with full control over your investigation process.
You operate independently to explore and fix a specific type of problem.

Your capabilities:
1. Git operations (status, diff, log) to analyze code changes
2. File system access to read and modify code
3. Command execution to run tests and experiments
4. Branch management for isolated testing

Investigation Process:
1. Analyze the error and context thoroughly
2. Form hypotheses about potential causes
3. Design and run targeted experiments
4. Make code changes to test fixes
5. Validate fixes in isolation
6. Document your findings and confidence level

Specify your next action using one of these formats:
- read_file: {path}
- write_file: {path} {content}
- execute_command: {command}
- git_operation: {args}
- complete: {success} {confidence} {fix} {explanation}

Each action should be specific, focused, and include rationale.
`;

export async function runScenarioLLM(
  scenarioType: string,
  hypothesis: string,
  errorMessage: string,
  context: any,
  previousActions: any[]
) {
  try {
    const actionsText = previousActions.length > 0
      ? `\n\nPrevious actions:\n${previousActions.map(
          (a, i) => `${i+1}. ${a.type}: ${JSON.stringify(a)}`
        ).join('\n')}`
      : '';
    
    const contextText = `
Error: ${errorMessage}
Scenario: ${scenarioType}
Hypothesis: ${hypothesis}
Repository: ${context.repository || 'Not specified'}

Files examined: ${Object.keys(context.files).length}
${Object.entries(context.files).map(([path, content]) => 
  `- ${path} (${(content as string).length} bytes)`
).join('\n')}

Commands executed: ${Object.keys(context.commandResults).length}
${Object.entries(context.commandResults).map(([cmd, result]) => 
  `- ${cmd}\n  Result: ${(result as string).substring(0, 100)}...`
).join('\n')}

Git operations: ${Object.keys(context.gitResults).length}
${Object.entries(context.gitResults).map(([op, result]) => 
  `- git ${op}\n  Result: ${(result as string).substring(0, 100)}...`
).join('\n')}
${actionsText}
`;

    const completion = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1500,
      temperature: 0.2,
      system: SCENARIO_AGENT_PROMPT,
      messages: [
        {
          role: 'user',
          content: `${contextText}\n\nWhat's your next action? Provide rationale first, then specify the exact action.`
        }
      ]
    });
    
    // Extract text from response
    if (completion.content && completion.content.length > 0) {
      const content = completion.content[0];
      if ('text' in content) {
        return content.text;
      }
    }
    
    return 'No valid response received';
  } catch (error) {
    console.error('Error calling Claude:', error);
    throw new Error(`Claude API error: ${error}`);
  }
}
```

## 3. Integration with MCP Server

```typescript
// src/index.ts - MCP Server entry point
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { runMotherAgent } from './mother-agent.js';

// Session storage
const sessions = new Map();

// Create MCP server
const server = new McpServer({
  name: "deebo-prototype",
  version: "0.1.0",
  capabilities: {
    tools: {},
  },
});

// Tool 1: Start Debug Session
server.tool(
  "start_debug_session",
  "Start a debugging session with an error and optional repository path",
  {
    error_message: z.string().describe("Error message from the code to debug"),
    code_context: z.string().optional().describe("Code surrounding the error"),
    language: z.string().optional().describe("Programming language"),
    file_path: z.string().optional().describe("Path to the file with error"),
    repo_path: z.string().optional().describe("Path to Git repository (recommended)")
  },
  async ({ error_message, code_context, language, file_path, repo_path }) => {
    const sessionId = uuidv4();
    
    try {
      // Create session
      const session = {
        id: sessionId,
        status: "running",
        logs: [
          "Deebo debugging session initialized",
          `Received error: ${error_message}`,
          `Language: ${language || "Not specified"}`,
          repo_path ? `Repository path: ${repo_path}` : "No repository path provided",
        ],
        startTime: Date.now(),
        lastChecked: Date.now(),
      };
      
      sessions.set(sessionId, session);
      
      // Launch mother agent as a separate process
      runMotherAgent(
        sessionId,
        error_message,
        code_context || '',
        repo_path || ''
      ).then(result => {
        session.status = "complete";
        session.finalResult = result;
        session.logs.push("Debug session completed successfully");
      }).catch(error => {
        session.status = "error";
        session.error = `${error}`;
        session.logs.push(`Error: ${error}`);
      });
      
      return {
        content: [{ type: "text", text: JSON.stringify({ session_id: sessionId, message: "Debug session started successfully" }) }],
      };
    } catch (error) {
      console.error("Error starting debug session:", error);
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ error: `Failed to start debug session: ${error}` }) }],
      };
    }
  }
);

// Tool 2: Check Debug Status - kept mostly the same as existing implementation
// Tool 3: List Debugging Scenarios - kept mostly the same as existing implementation

// Start server
async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Deebo prototype MCP Server running on stdio");
  } catch (error) {
    console.error("Error initializing server:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
```

## 4. Comprehensive Logging System

```typescript
// src/util/logger.ts
import fs from 'fs/promises';
import { createWriteStream } from 'fs';

export function createLogger(logFilePath) {
  // Create a file write stream
  const logStream = createWriteStream(logFilePath, { flags: 'a' });
  
  function formatMessage(level, message) {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
  }
  
  return {
    info: (message) => {
      const formatted = formatMessage('info', message);
      console.log(formatted.trim());
      logStream.write(formatted);
    },
    error: (message) => {
      const formatted = formatMessage('error', message);
      console.error(formatted.trim());
      logStream.write(formatted);
    },
    debug: (message) => {
      const formatted = formatMessage('debug', message);
      logStream.write(formatted);
    },
    warn: (message) => {
      const formatted = formatMessage('warn', message);
      console.warn(formatted.trim());
      logStream.write(formatted);
    },
    close: () => {
      logStream.end();
    }
  };
}
```

## 5. Implementation Steps

1. **Setup Project Structure**
   - Reorganize the codebase according to the new architecture
   - Create separate files for mother-agent, scenario-agent, and utilities

2. **Implement Process Management**
   - Develop the mother agent to spawn scenario agents as separate processes
   - Create the scenario agent as a standalone executable

3. **Develop Agent Communication**
   - Implement file-based reporting between agents
   - Set up session directory structure for logging and reports

4. **Add Direct MCP Tool Execution**
   - Implement direct MCP tool execution without shared clients
   - Ensure proper process isolation for each tool invocation

5. **Enhance Error Handling**
   - Add comprehensive error handling for process failures
   - Implement clean branch deletion even after errors

6. **Improve Logging System**
   - Create a robust logging system that captures all operations
   - Implement log aggregation in the mother agent

7. **Integrate with MCP Server**
   - Update the MCP server to work with the new architecture
   - Modify the start_debug_session and check_debug_status tools

8. **Test and Refine**
   - Test with various debugging scenarios
   - Refine based on results

## 6. Conclusion

This implementation plan provides a detailed roadmap for transforming the current prototype into a full-featured ADS that follows your vision. It leverages natural process isolation without unnecessary complexity, using separate Node processes to run agents and MCP tools.

The system maintains the same logical architecture while simplifying the implementation, eliminating the need for containers, async frameworks, or message queues. Each component has a clear responsibility, and the overall system is more robust and easier to understand.
