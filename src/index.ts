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

      // Build the pulse using Gemini's format
      let pulse = `=== Deebo Session Pulse: ${sessionId} ===\n`;
      pulse += `Timestamp: ${new Date().toISOString()}\n`;
      pulse += `Overall Status: ${status}\n`;
      pulse += `Session Duration: ${Math.floor(durationMs / 1000)}s\n\n`;

      pulse += `--- Mother Agent ---\n`;
      pulse += `Status: ${status === 'in_progress' ? 'Working' : status}\n`;
      pulse += `Last Activity: ${lastEvent.timestamp}\n`;
      pulse += `Current Focus Snippet:\n`;
      pulse += `<<<<<<< MOTHER FOCUS\n`;
      // Get mother's last 20 lines but filter out noisy tool results
      const focusLines = motherLines.slice(-20)
        .map(l => {
          try {
            const event = JSON.parse(l);
            // Only show significant events
            if (event.level === 'debug' && 
               (event.message.includes('Sending to Claude') || 
                event.message.includes('Received from Claude'))) {
              return null;
            }
            return `[${event.timestamp}] ${event.message}`;
          } catch {
            return l;
          }
        })
        .filter(Boolean)
        .join('\n');
      pulse += focusLines;
      pulse += '\n======= MOTHER FOCUS END >>>>>>>\n\n';

      pulse += `--- Scenario Agents (${totalScenarios} Total: ${totalScenarios - reportedScenarios} Running, ${reportedScenarios} Reported) ---\n\n`;

      // Show scenario statuses
      for (const file of reportFiles.slice(-5)) { // Show last 5 scenarios
        const scenarioId = file.replace('.json', '');
        const report = JSON.parse(await readFile(join(reportsDir, file), 'utf8'));
        const scenarioLogPath = join(logsDir, `scenario-${scenarioId}.log`);
        const scenarioLog = await readFile(scenarioLogPath, 'utf8');
        const scenarioLines = scenarioLog.split('\n').filter(Boolean);
        const startEvent = JSON.parse(scenarioLines[0]);

        // Get hypothesis from scenario log
        const hypothesisLine = scenarioLines.find(l => {
          try {
            const event = JSON.parse(l);
            return event.data?.hypothesis;
          } catch {
            return false;
          }
        });
        const hypothesis = hypothesisLine ? JSON.parse(hypothesisLine).data.hypothesis : 'Unknown hypothesis';

        pulse += `* Scenario: ${scenarioId}\n`;
        pulse += `  Status: Reported\n`;
        pulse += `  Hypothesis: "${hypothesis}"\n`;
        pulse += `  Outcome Snippet:\n`;
        pulse += `  <<<<<<< OUTCOME ${scenarioId}\n`;
        // Get first 5 and last 5 non-empty lines of report
        const reportLines = report.split('\n').filter(Boolean);
        const start = reportLines.slice(0, 5).join('\n');
        const end = reportLines.slice(-5).join('\n');
        pulse += `  ${start}\n  ...\n  ${end}\n`;
        pulse += `  ======= OUTCOME ${scenarioId} END >>>>>>>\n`;
        pulse += `  (Full report: ${join(reportsDir, file)})\n\n`;
      }

      // Show running scenarios
      const runningScenarios = scenarioLogs
        .filter(f => f.startsWith('scenario-'))
        .filter(f => !reportFiles.includes(f.replace('scenario-', '').replace('.log', '.json')));

      for (const file of runningScenarios) {
        const scenarioId = file.replace('scenario-', '').replace('.log', '');
        const scenarioLog = await readFile(join(logsDir, file), 'utf8');
        const scenarioLines = scenarioLog.split('\n').filter(Boolean);
        if (!scenarioLines.length) continue;

        const startEvent = JSON.parse(scenarioLines[0]);
        const lastEvent = JSON.parse(scenarioLines[scenarioLines.length - 1]);
        const runtime = Math.floor((Date.now() - new Date(startEvent.timestamp).getTime()) / 1000);

        // Get hypothesis same as above
        const hypothesisLine = scenarioLines.find(l => {
          try {
            const event = JSON.parse(l);
            return event.data?.hypothesis;
          } catch {
            return false;
          }
        });
        const hypothesis = hypothesisLine ? JSON.parse(hypothesisLine).data.hypothesis : 'Unknown hypothesis';

        pulse += `* Scenario: ${scenarioId}\n`;
        pulse += `  Status: Running (${runtime}s)\n`;
        pulse += `  Hypothesis: "${hypothesis}"\n`;
        pulse += `  Latest Activity:\n`;
        pulse += `  <<<<<<< LATEST ${scenarioId}\n`;
        pulse += `  ${lastEvent.message}\n`;
        pulse += `  ======= LATEST ${scenarioId} END >>>>>>>\n`;
        pulse += `  (Log: ${join(logsDir, file)})\n\n`;
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
    observation: z.string()
  },
  async ({ agentId, observation }) => {
    try {
      // Find the active session
      const memoryBank = join(DEEBO_ROOT, 'memory-bank');
      const projects = await readdir(memoryBank);
      
      let sessionId = null;
      let repoPath = null;
      for (const project of projects) {
        const sessionsDir = join(memoryBank, project, 'sessions');
        const sessions = await readdir(sessionsDir);
        // Look for most recent session
        const sortedSessions = sessions.sort().reverse();
        if (sortedSessions.length > 0) {
          sessionId = sortedSessions[0];
          // Get repoPath from agent log
          const logFile = join(sessionsDir, sessionId, 'logs', `${agentId}.log`);
          const agentLog = await readFile(logFile, 'utf8');
          const firstLine = agentLog.split('\n')[0];
          const firstEvent = JSON.parse(firstLine);
          repoPath = firstEvent.data?.repoPath;
          break;
        }
      }

      if (!sessionId || !repoPath) {
        return {
          content: [{
            type: "text",
            text: "No active session found"
          }]
        };
      }

      await writeObservation(repoPath, sessionId, agentId, observation);
      return { 
        content: [{ 
          type: "text", 
          text: "Observation logged" 
        }] 
      };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: `Error logging observation: ${err}`
        }]
      };
    }
  }
);

// Connect transport
const transport = new StdioServerTransport();
await server.connect(transport);
