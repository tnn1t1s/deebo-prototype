import { ToolConfigManager } from './build/util/tool-config.js';
import { spawn } from 'child_process';

// Constants
const TEST_TIMEOUT = 15000;  // 15 seconds
const STARTUP_WAIT = 5000;   // 5 seconds
const SHUTDOWN_GRACE = 1000; // 1 second grace period for shutdown

// Custom error for Python-related issues
class PythonEnvironmentError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'PythonEnvironmentError';
    this.cause = cause;
  }
}

// Timeout wrapper
async function runWithTimeout(promise, ms, operation) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Operation '${operation}' timed out after ${ms}ms`)), ms);
  });
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// Process cleanup handler
let serverProcess = null;
function cleanup(exitCode = 0) {
  if (serverProcess) {
    try {
      // Send SIGTERM first for graceful shutdown
      if (process.platform !== 'win32') {
        process.kill(-serverProcess.pid, 'SIGTERM');
      } else {
        serverProcess.kill('SIGTERM');
      }
      
      // Force kill after grace period if still running
      setTimeout(() => {
        try {
          if (serverProcess) {
            if (process.platform !== 'win32') {
              process.kill(-serverProcess.pid, 'SIGKILL');
            } else {
              serverProcess.kill('SIGKILL');
            }
          }
        } catch (error) {
          // Process might already be terminated, ignore errors
        } finally {
          serverProcess = null;
          process.exit(exitCode);
        }
      }, SHUTDOWN_GRACE);
    } catch (error) {
      console.error('Error during cleanup:', error);
      serverProcess = null;
      process.exit(exitCode);
    }
  } else {
    process.exit(exitCode);
  }
}

// Add signal handlers
process.on('SIGINT', () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));
process.on('SIGUSR1', () => cleanup(0));
process.on('SIGUSR2', () => cleanup(0));
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  cleanup(1);
});

async function validatePythonEnvironment(config) {
  console.log('\nValidating Python environment...');
  
  // Check Python executable
  if (!config.command.includes('python')) {
    throw new PythonEnvironmentError('Invalid Python command in configuration');
  }

  // Check environment variables
  const env = config.env || {};
  console.log('Environment configuration:');
  console.log('- VIRTUAL_ENV:', env.VIRTUAL_ENV || 'not set');
  console.log('- PYTHONPATH:', env.PYTHONPATH || 'not set');
  console.log('- PATH:', env.PATH ? env.PATH.substring(0, 50) + '...' : 'not set');

  if (!env.VIRTUAL_ENV) {
    throw new PythonEnvironmentError('Virtual environment not configured');
  }

  // Try running Python with version check
  const pythonProcess = spawn(config.command, ['--version'], { env });
  
  return new Promise((resolve, reject) => {
    let output = '';
    
    pythonProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      output += data.toString();
    });

    pythonProcess.on('error', (error) => {
      reject(new PythonEnvironmentError('Failed to execute Python', error));
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        console.log('Python version:', output.trim());
        resolve();
      } else {
        reject(new PythonEnvironmentError(`Python version check failed with code ${code}: ${output}`));
      }
    });
  });
}

async function testGitMcp() {
  try {
    console.log('Testing git-mcp configuration...');
    
    // Get tool config
    console.log('Getting tool configuration...');
    const manager = await ToolConfigManager.getInstance();
    console.log('Tool manager initialized');
    const config = await manager.getToolConfig('git-mcp');
    console.log('Got git-mcp tool config');
    
    console.log('\nTool Configuration:');
    console.log('Command:', config.command);
    console.log('Args:', config.args);
    
    // Validate Python environment first
    await validatePythonEnvironment(config);
    
    // Try running git-mcp
    console.log('\nStarting git-mcp server...');
    
    const startServer = new Promise((resolve, reject) => {
      // Create new process group on Unix systems
      console.log('Setting up spawn options...');
      const spawnOptions = {
        env: config.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32'
      };
      console.log('Spawn options:', {
        env: {
          VIRTUAL_ENV: config.env?.VIRTUAL_ENV,
          PYTHONPATH: config.env?.PYTHONPATH,
          PATH: config.env?.PATH?.substring(0, 50) + '...'
        },
        detached: spawnOptions.detached
      });
      
      console.log('Spawning process:', config.command, config.args.join(' '));
      serverProcess = spawn(config.command, config.args, spawnOptions);
      console.log('Process spawned with PID:', serverProcess.pid);
      
      // Ensure child process is killed when parent exits
      if (process.platform !== 'win32') {
        process.on('exit', () => {
          if (serverProcess) {
            try {
              process.kill(-serverProcess.pid, 'SIGKILL');
            } catch (error) {
              console.error('Failed to kill process group:', error);
            }
          }
        });
      }
      
      let output = '';
      let errorOutput = '';
      
      // Set up timeout for server startup
      let startTimeout = setTimeout(() => {
        reject(new Error(`Server failed to start within ${STARTUP_WAIT}ms`));
      }, STARTUP_WAIT);

      // Handle stdout
      serverProcess.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        console.log('Server output:', text.trim());
        
        // Check for server ready indication
        if (text.includes('Server started') || text.includes('Listening') || text.includes('Ready')) {
          clearTimeout(startTimeout);
          resolve({ output, errorOutput });
        }
      });
      
      // Handle stderr
      serverProcess.stderr.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        console.error('Server error:', text.trim());
        
        // Some servers might log ready message to stderr
        if (text.includes('Server started') || text.includes('Listening') || text.includes('Ready')) {
          clearTimeout(startTimeout);
          resolve({ output, errorOutput });
        }
      });
      
      // Handle process errors
      serverProcess.on('error', (error) => {
        clearTimeout(startTimeout);
        reject(new Error(`Failed to start server: ${error.message}`));
      });
      
      // Handle process exit
      serverProcess.on('close', (code) => {
        clearTimeout(startTimeout);
        if (code === null || code === 0) {
          resolve({ output, errorOutput });
        } else {
          reject(new Error(`Server exited with code ${code}\nOutput: ${output}\nError: ${errorOutput}`));
        }
      });
    });
    
    // Run the server with timeout
    await runWithTimeout(startServer, TEST_TIMEOUT, 'git-mcp server startup');
    
    console.log('\ngit-mcp server started successfully!');
    
  } catch (error) {
    if (error instanceof PythonEnvironmentError) {
      console.error('\nPython environment error:', error.message);
      if (error.cause) {
        console.error('Caused by:', error.cause);
      }
    } else {
      console.error('\nTest failed:', error);
    }
    process.exit(1);
  } finally {
    cleanup();
  }
}

// Run the test
testGitMcp();
