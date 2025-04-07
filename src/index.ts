import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, mkdir, readdir, access, writeFile } from 'fs/promises';
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { runMotherAgent } from './mother-agent.js';
import { getProjectId } from './util/sanitize.js';
import { writeObservation } from './util/observations.js';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);


// Load environment variables from .env file
config();

// Validate required environment variables
if (!process.env.OPENROUTER_API_KEY) {
  throw new Error('OPENROUTER_API_KEY environment variable is required');
}
if (!process.env.MOTHER_MODEL) {
  throw new Error('MOTHER_MODEL environment variable is required');
}
if (!process.env.SCENARIO_MODEL) {
  throw new Error('SCENARIO_MODEL environment variable is required');
}


// Set up basic directories
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const DEEBO_ROOT = join(__dirname, '..');

// Create required directories
await mkdir(join(DEEBO_ROOT, 'memory-bank'), { recursive: true });

// Create MCP server
const server = new McpServer({
  name: "Deebo",
  version: "1.0.0"
});

// Register start tool - begins a debug session
server.tool(
  "start",
  {
    error: z.string(),
    repoPath: z.string(),
    context: z.string().optional(),
    language: z.string().optional(),
    filePath: z.string().optional()
  },
  async ({ error, repoPath, context, language, filePath }) => {
    const projectId = getProjectId(repoPath);
    const sessionId = `session-${Date.now()}`;
    await mkdir(join(DEEBO_ROOT, 'memory-bank', projectId, 'sessions', sessionId, 'logs'), { recursive: true });
    await mkdir(join(DEEBO_ROOT, 'memory-bank', projectId, 'sessions', sessionId, 'reports'), { recursive: true });
    // Run mother agent in background
    runMotherAgent(
      sessionId,
      error,
      context ?? "",
      language ?? "typescript",
      filePath ?? "",
      repoPath
    ).catch(err => console.error('Debug session failed:', err));

    // Return session ID immediately
    return {
      content: [{
        type: "text",
        text: sessionId
      }]
    };
  }
);

// Register check tool - gets status of a debug session
server.tool(
  "check",
  {
    sessionId: z.string()
  },
  async ({ sessionId }) => {
    try {
      const sessionDir = await findSessionDir(sessionId);
      if (!sessionDir) {
        return {
          content: [{ 
            type: "text",
            text: `Session ${sessionId} not found`
          }]
        };
      }

      // Get time metrics and mother status
      const logsDir = join(sessionDir, 'logs');
      const motherLogPath = join(logsDir, 'mother.log');
      const motherLog = await readFile(motherLogPath, 'utf8');
      const motherLines = motherLog.split('\n').filter(Boolean);
      
      if (!motherLines.length) return { content: [{ type: "text", text: 'Session initializing' }] };

      const firstEvent = JSON.parse(motherLines[0]);
      const lastEvent = JSON.parse(motherLines[motherLines.length - 1]);
      const durationMs = Date.now() - new Date(firstEvent.timestamp).getTime();
      const status = lastEvent.level === 'error' ? 'failed' :
                    lastEvent.message?.includes('solution found') ? 'completed' : 'in_progress';

      // Count scenario statuses
      const reportsDir = join(sessionDir, 'reports');
      const scenarioLogs = await readdir(logsDir);
      const reportFiles = await readdir(reportsDir);
      
      const totalScenarios = scenarioLogs.filter(f => f.startsWith('scenario-')).length;
      const reportedScenarios = reportFiles.length;

      // Build the pulse
      let pulse = `=== Deebo Session Pulse: ${sessionId} ===\n`;
      pulse += `Timestamp: ${new Date().toISOString()}\n`;
      pulse += `Overall Status: ${status}\n`;
      pulse += `Session Duration: ${Math.floor(durationMs / 1000)}s\n\n`;

      pulse += `--- Mother Agent ---\n`;
      pulse += `Status: ${status === 'in_progress' ? 'working' : status}\n`;
      pulse += `Last Activity: ${lastEvent.timestamp}\n`;

      // For completed sessions, find and show solution
      if (status === 'completed') {
        // Look for solution in mother log
        let foundSolution = false;
        
        // Scan backwards for efficiency (newer entries more likely to have solution)
        for (let i = motherLines.length - 1; i >= 0; i--) {
          try {
            const line = motherLines[i];
            const event = JSON.parse(line);
            const content = event.data?.response?.content || event.message || '';
            
            // Check for solution tag in content string
            if (content.includes('<solution>')) {
              const match = content.match(/<solution>([\s\S]*?)<\/solution>/);
              if (match && match[1]) {
                pulse += `MOTHER SOLUTION:\n`;
                pulse += `<<<<<<< SOLUTION\n`;
                pulse += match[1].trim() + '\n';
                pulse += `======= SOLUTION END >>>>>>>\n\n`;
                foundSolution = true;
                break;
              }
            }
          } catch (e) {
            // Skip invalid JSON lines
            continue;
          }
        }
        
        // No solution found message
        if (!foundSolution) {
          pulse += `STATUS COMPLETE BUT NO SOLUTION FOUND\n`;
          pulse += `Check the mother.log file for more details.\n\n`;
        }
      } else {
        // For in-progress, just show current OODA stage - without reversing
        for (let i = motherLines.length - 1; i >= 0; i--) {
          try {
            const event = JSON.parse(motherLines[i]);
            if (event.message && event.message.includes('OODA:')) {
              pulse += `Current Stage: ${event.message}\n\n`;
              break;
            }
          } catch (e) {
            // Skip invalid JSON lines
            continue;
          }
        }
      }

      pulse += `--- Scenario Agents (${totalScenarios} Total: ${totalScenarios - reportedScenarios} Running, ${reportedScenarios} Reported) ---\n\n`;

      // Process reported scenarios
      for (const file of reportFiles) {
        const scenarioId = file.replace('.json', '');
        
        const scenarioLogPath = join(logsDir, `scenario-${scenarioId}.log`);
        let scenarioLog;
        try {
          scenarioLog = await readFile(scenarioLogPath, 'utf8');
        } catch (e) {
          continue; // Skip if log file doesn't exist
        }
        
        const scenarioLines = scenarioLog.split('\n').filter(Boolean);
        if (!scenarioLines.length) continue;

        // Get hypothesis - scan once
        let hypothesis = 'Unknown hypothesis';
        for (let i = 0; i < scenarioLines.length; i++) {
          try {
            const event = JSON.parse(scenarioLines[i]);
            if (event.data?.hypothesis) {
              hypothesis = event.data.hypothesis;
              break;
            }
          } catch (e) {
            continue;
          }
        }

        pulse += `* Scenario: ${scenarioId}\n`;
        pulse += `  Status: Reported\n`;
        pulse += `  Hypothesis: "${hypothesis}"\n`;

        if (status === 'completed') {
          // Show summary for completed scenarios in completed sessions
          try {
            const reportRaw = await readFile(join(reportsDir, `${scenarioId}.json`), 'utf8');
            const report = JSON.parse(reportRaw);
            
            // Handle report as string or object
            const reportStr = typeof report === 'string' ? report : JSON.stringify(report, null, 2);
            // Limit to first few lines
            const reportLines = reportStr.split('\n').slice(0, 5);
            
            pulse += `  Outcome Summary:\n`;
            pulse += `  <<<<<<< OUTCOME ${scenarioId}\n`;
            pulse += `  ${reportLines.join('\n  ')}\n`;
            if (reportStr.split('\n').length > 5) {
              pulse += `  [...more lines...]\n`;
            }
            pulse += `  ======= OUTCOME ${scenarioId} END >>>>>>>\n`;
          } catch (e) {
            const error = e as Error;
            pulse += `  Error reading report: ${error.message}\n`;
          }
        }

        pulse += `  (Full report: ${join(reportsDir, `${scenarioId}.json`)})\n\n`;
      }

      // Process running scenarios
      const runningScenarios = scenarioLogs
        .filter(f => f.startsWith('scenario-'))
        .filter(f => !reportFiles.includes(f.replace('scenario-', '').replace('.log', '.json')));
      
      for (const file of runningScenarios) {
        const scenarioId = file.replace('scenario-', '').replace('.log', '');
        
        let scenarioLog;
        try {
          scenarioLog = await readFile(join(logsDir, file), 'utf8');
        } catch (e) {
          continue; // Skip if log file doesn't exist
        }
        
        const scenarioLines = scenarioLog.split('\n').filter(Boolean);
        if (!scenarioLines.length) continue;

        // Get hypothesis - more efficient scan
        let hypothesis = 'Unknown hypothesis';
        for (let i = 0; i < scenarioLines.length; i++) {
          try {
            const event = JSON.parse(scenarioLines[i]);
            if (event.data?.hypothesis) {
              hypothesis = event.data.hypothesis;
              break;
            }
          } catch (e) {
            continue;
          }
        }

        // First and last events
        let firstEvent, lastEvent;
        try {
          firstEvent = JSON.parse(scenarioLines[0]);
          lastEvent = JSON.parse(scenarioLines[scenarioLines.length - 1]);
          const runtime = Math.floor((Date.now() - new Date(firstEvent.timestamp).getTime()) / 1000);

          pulse += `* Scenario: ${scenarioId}\n`;
          pulse += `  Status: Running\n`;
          pulse += `  Hypothesis: "${hypothesis}"\n`;
          pulse += `  Runtime: ${runtime}s\n`;
          pulse += `  Latest Activity: ${lastEvent.message}\n`;
          pulse += `  (Log: ${join(logsDir, file)})\n\n`;
        } catch (e) {
          // Skip scenarios with invalid JSON
          continue;
        }
      }

      pulse += `--- End Session Pulse ---`;

      return {
        content: [{ 
          type: "text",
          text: pulse
        }]
      };

    } catch (err) {
      return {
        content: [{ 
          type: "text",
          text: `Error generating pulse: ${err}`
        }]
      };
    }
  }
);

// Helper to find session directory
async function findSessionDir(sessionId: string): Promise<string | null> {
  const memoryBank = join(DEEBO_ROOT, 'memory-bank');
  const projects = await readdir(memoryBank);
  
  for (const project of projects) {
    const sessionPath = join(memoryBank, project, 'sessions', sessionId);
    try {
      await access(sessionPath);
      return sessionPath;
    } catch {
      continue;
    }
  }
  return null;
}

server.tool(
  "cancel",
  {
    sessionId: z.string()
  },
  async ({ sessionId }) => {
    // Sanitize sessionId for shell
    const sanitizedId = sessionId.replace(/[^a-zA-Z0-9-]/g, '');
    
    try {
      // First attempt: SIGTERM to all processes in session tree
      const { stdout: pids } = await execPromise(`pgrep -f ${sanitizedId}`);
      const pidList = pids.split('\n').filter(Boolean);
      
      for (const pid of pidList) {
        try {
          // Kill process and all its children
          await execPromise(`pkill -15 -P ${pid}`);
          process.kill(Number(pid), 'SIGTERM');
        } catch (err) {
          // Ignore errors - process might be gone
        }
      }

      // Wait a moment for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check if any processes survived
      const { stdout: survivors } = await execPromise(`pgrep -f ${sanitizedId}`);
      const survivorList = survivors.split('\n').filter(Boolean);

      if (survivorList.length > 0) {
        // Force kill survivors with SIGKILL
        for (const pid of survivorList) {
          try {
            await execPromise(`pkill -9 -P ${pid}`);
            process.kill(Number(pid), 'SIGKILL');
          } catch (err) {
            // Ignore errors
          }
        }
      }

      // Final check
      const { stdout: final } = await execPromise(`pgrep -f ${sanitizedId}`);
      const finalList = final.split('\n').filter(Boolean);

      if (finalList.length > 0) {
        return {
          content: [{
            type: "text",
            text: `WARNING: ${finalList.length} processes survived cancellation. Session may need manual cleanup.`
          }]
        };
      }

      return {
        content: [{
          type: "text",
          text: `Successfully terminated all processes for session ${sanitizedId}`
        }]
      };

    } catch (err) {
      return {
        content: [{
          type: "text",
          text: `Error during cancellation: ${err}. Session may need manual cleanup.`
        }]
      };
    }
  }
);

// Register add_observation tool
server.tool(
  "add_observation",
  {
    agentId: z.string(),
    observation: z.string(),
    sessionId: z.string()
  },
  async ({ agentId, observation, sessionId }) => {
    try {
      // Get session directory
      const sessionDir = await findSessionDir(sessionId);
      if (!sessionDir) {
        throw new Error('Session not found');
      }

      // Get repoPath from agent log
      const logFile = join(sessionDir, 'logs', `${agentId}.log`);
      const agentLog = await readFile(logFile, 'utf8');
      const firstLine = agentLog.split('\n')[0];
      const firstEvent = JSON.parse(firstLine);
      const repoPath = firstEvent.data?.repoPath;
      
      if (!repoPath) {
        throw new Error('Could not find repoPath in agent log');
      }

      await writeObservation(repoPath, sessionId, agentId, observation);
      return { 
        content: [{ 
          type: "text", 
          text: "Observation logged" 
        }] 
      };
    } catch (err) {
      throw new Error(`Observation write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
);

// Connect transport
const transport = new StdioServerTransport();
await server.connect(transport);
