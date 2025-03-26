Deebo: Autonomous Debugging Assistant

1. The Problem

Modern software projects can be incredibly complex, and debugging them often consumes vast amounts of developer time. Key challenges include:
	•	Time-Consuming Debugging:
Developers spend hours manually analyzing logs, reproducing errors, and iterating on fixes.
	•	Context Overload:
Large codebases make it difficult for both humans and automated tools to capture and process relevant context efficiently.
	•	Inconsistent Environments:
Bugs that appear only in certain environments (development vs. production) add to the debugging complexity.
	•	Limited Automation:
Current tools often require manual intervention and don't leverage advanced AI to suggest and validate fixes automatically.

⸻
2. IMPORTANT: while we are building Deebo as a composable API initially, the MVP will be an MCP server that can interface with agents such as Cline or Cursor. Keep that in mind when building the API.

3. What is Deebo?

Deebo is an ADS (Agentic Debugging System) that:
	•	Caches Code Snapshots:
It ingests and stores full codebases and computes diffs, so subsequent debugging sessions only process incremental changes.
	•	Uses Git-Based Isolation:
Each debugging attempt occurs in its own Git branch, providing isolation and version control while maintaining a complete history of attempted fixes.
	•	Analyzes Execution Results with LLMs:
Deebo leverages advanced language models to analyze outputs and automatically generate debugging reports, complete with fix suggestions and detailed explanations.
	•	Is Modular and Composable:
Its core API is designed independently of any specific interface. Today, it may run as a FastAPI service (or similar backend) and later be wrapped with an MCP server or exposed through a GUI.

⸻

4. Technical Architecture & Tech Stack

Core Modules of the API:
	1.	Code Ingestion Module:
	•	Functionality: Reads the full codebase. We are assuming the client will send a JSON package of error, logs, context, and codebase.
Error: this is cline's report of the error in the system, and what exactly it wants you to solve. 
Logs: system event logs, whether they're from the user's console, system events, etc. 
Codebase: cline sends the codebase to deebo the first time it's called in a chat session. If a previous version exists, Deebo computes a diff and updates its internal codebase.
Context: any other useful information that cline wants Deebo to know that would be helpful for solving the error. Basically space for Cline's LLM to be creative and thoughtful 
	2.	Git MCP Server Integration:
	•	Functionality: Provides direct access to Git operations via the Git MCP server. This MCP server exposes Git functionality (status, diff, log, branch, checkout, commit, etc.) via standardized API calls, enabling scenario agents to create and manage branches, track changes, and analyze code history directly from their Claude instances.
	•	Benefits: Native Git integration allows for clean isolation of debugging attempts, and preserves a complete history of all attempted fixes while providing familiar Git workflow concepts.
	3.	Desktop Commander MCP Integration:
	•	Functionality: Provides file system and command execution capabilities via the Desktop Commander MCP server. This MCP server allows agents to read/write files, execute terminal commands, and interact with the local environment directly through standardized API calls.
	•	Benefits: Empowers scenario agents to make file changes, execute build/test commands, and capture outputs without requiring custom code implementations.
	4.	Debug Analysis Module (Scenario Agents):
	•	Functionality: Each scenario agent is a fully autonomous agent with its own Claude instance and direct access to tools. They:
		- Create and manage their own Git branches
		- Have full access to Git MCP and DesktopCommander MCP
		- Make independent decisions about what to try next
		- Execute real terminal commands to build, test, and verify fixes
		- Report comprehensive results back to mother agent
		- Self-terminate after sending results
	5.	Orchestrator (Deebo, Mother Agent):
	•	Functionality: Orchestrates the end-to-end workflow:
		- Analyzes errors to determine which scenario types to investigate
		- Spawns independent scenario agents with their own Claude instances
		- Provides initial context and hypothesis to each agent
		- Evaluates results from scenario agents
		- Selects and verifies the best solution

Supporting Services:
	•	Caching:
Use Redis to cache metadata, smaller diffs, and indexes for fast retrieval.
	•	Persistent Storage:
Use Supabase Storage (or a similar object storage service) to store large codebase snapshots (if needed) while keeping the bulk out of Redis.
	•	Deployment:
Initially, deploy the backend using FastAPI (running on Uvicorn). In production, you might host this on Vercel or a cloud provider.

Tech Stack Summary:
	•	Backend Framework: FastAPI (Python)
	•	Programming Language: Python 3.x
	•	Data Modeling: Pydantic
	•	Version Control: Git (for isolation and change tracking)
	•	MCP Servers: Git MCP & Desktop Commander MCP
	•	Caching: Redis (for metadata/diffs)
	•	Persistent Storage: Supabase Storage (for large artifacts)
	•	LLM Integration: API calls to Claude 3.7 
	•	Testing: pytest for unit/integration tests
	•	Deployment: Standard cloud deployment (e.g., Vercel, cloud provider)

⸻

MCP Servers in Detail:

1. Git MCP Server
   • Purpose: Provides a standardized interface to Git version control operations through the Model Context Protocol
   • Key Capabilities:
     - Repository Analysis: status, diff, log, blame, show
     - Branch Management: branch, checkout, reset, merge
     - Change Tracking: add, commit, push, pull
     - History Exploration: log with various formats, show specific revisions
   • Integration with Deebo:
     - Mother Agent uses it to gather initial context about the codebase
     - Scenario Agents use it to create isolated branches for experimentation
     - All agents can perform Git operations without shell execution
     - Changes can be tracked with standard Git workflows
   • Benefits for Debugging:
     - Clean isolation of debugging attempts
     - Complete history of all fix attempts
     - Easy comparison between different solution approaches
     - Natural integration with developer workflows

2. Desktop Commander MCP Server
   • Purpose: Provides file system and command execution capabilities through the Model Context Protocol
   • Key Capabilities:
     - File Operations: read, write, edit, search, list directories
     - Command Execution: run any CLI command with output capture
     - Process Management: start, monitor, and terminate processes
     - Environment Interaction: access system information and settings
   • Integration with Deebo:
     - Scenario Agents use it to read and modify code files
     - Agents execute build and test commands to validate fixes
     - Output capture from command execution provides evidence for solution effectiveness
     - File system operations allow checking and modifying configuration files
   • Benefits for Debugging:
     - Direct file manipulation without complex APIs
     - Real validation of fixes through actual command execution
     - Complete access to development toolchain
     - Evidence collection through captured outputs

⸻

5. Lightweight Wrappers

Once the core API is stable, you can build lightweight wrappers around it:
	•	MCP Server Wrapper (IMMEDIATE PRIORITY):
Wrap the core API in a minimal MCP interface so that platforms like Cline can call Deebo as a single tool (e.g., via a "deebo-debug" endpoint).
	•	Web/Desktop Interface (FUTURE):
Create a simple web or desktop app that calls the core API and presents debugging reports to users.

Overview of the Agentic Debugging System

In an advanced debugging assistant like Deebo, a multi-agent system can improve the reliability and accuracy of the fix generation process. The idea is to split the debugging task into smaller, focused subtasks that multiple specialized agents handle concurrently or in sequence. The two main types of agents in this system are:
	•	Scenario Agents:
These are fully autonomous agents, each responsible for exploring a distinct debugging strategy or hypothesis. Each Scenario Agent operates in its own Git branch where it tests a specific fix or configuration change. They have their own Claude instances with direct tool access, allowing them to make independent decisions, execute commands, and validate fixes through real experimentation.
	•	Mother Agent:
This is the "orchestrator" agent that oversees the entire debugging process. It analyzes errors, spawns scenario agents with appropriate hypotheses, collects their reports, and selects the best solution. The Mother Agent can also decide if further experimentation is necessary (for example, if none of the Scenario Agents yield a satisfactory fix).

⸻

Detailed Roles and Workflow

1. Scenario Agents

Role:
	•	Each Scenario Agent is a fully autonomous agent with its own Claude instance and direct tool access. They take different approaches to resolving the detected issue, such as fixing dependency errors, correcting misconfigurations, or adjusting environment variables.

Key Functions:
	•	Environment Setup:
	•	Each agent creates and manages its own Git branch, ensuring isolation from other debugging attempts
	•	The agent has full access to read, write, and execute operations in its branch
	•	Experiment Execution:
	•	The agent makes independent decisions about what commands to run
	•	Executes real builds, tests, and validation steps
	•	Captures all outputs, logs, and metrics
	•	Analysis & Reporting:
	•	Uses its Claude instance to analyze execution results
	•	Makes decisions about next steps based on results
	•	Generates a detailed DebugReport that includes:
		•	The specific hypothesis and steps taken
		•	Evidence from actual execution results
		•	Confidence score based on empirical testing
		•	Comprehensive explanation of the solution
	•	Autonomy and Independence:
	•	Has full access to Git MCP and DesktopCommander MCP
	•	Makes its own decisions about what to try next
	•	Can perform multi-step investigations
	•	Self-terminates after reporting results

2. Mother Agent

Role:
	•	The Mother Agent is responsible for orchestrating the debugging process. It spawns and coordinates scenario agents, analyzes their findings, and determines the best solution.

Key Functions:
	•	Analysis & Planning:
	•	Analyzes the error to determine which scenario types to investigate
	•	Creates appropriate hypotheses for each scenario
	•	Agent Management:
	•	Spawns independent scenario agents with their own Claude instances
	•	Provides initial context and hypothesis to each agent
	•	Monitors agent progress and collects results
	•	Evaluation:
	•	Reviews empirical evidence from each agent
	•	Compares confidence scores and solution complexity
	•	Verifies selected solutions independently
	•	Decision-Making:
	•	Selects the best solution based on real test results
	•	Can spawn additional agents if needed
	•	Communication:
	•	Returns detailed fix recommendations with evidence
	•	Provides comprehensive debugging reports

⸻

3. Full Workflow Example

1. Initial Analysis:
	•	Cline detects an error in the code
	•	Cline starts a debug session with Deebo, providing:
		- Error information (message, location, etc.)
		- Path to the Git repository
	•	Mother Agent:
		- Uses git_status to see what files have changed
		- Uses git_diff_unstaged to get the current changes
		- Uses git_show to retrieve committed code
		- Analyzes the error and context

2. Agent Deployment:
	•	Mother Agent spawns 2-3 scenario agents with different hypotheses
	•	Each scenario agent:
		- Creates its own Git branch
		- Has full tool access (Git MCP, DesktopCommander MCP)
		- Makes independent decisions
		- Performs real experiments and tests
		- Reports results back to mother agent

3. Investigation Process:
	•	Each scenario agent:
		- Explores the codebase
		- Makes code changes
		- Runs builds and tests
		- Captures evidence
		- Iterates based on results
		- Documents findings

4. Result Analysis:
	•	Mother Agent:
		- Collects all debug reports
		- Evaluates empirical evidence
		- Compares confidence scores
		- Selects best solution
		- Verifies fix effectiveness

5. Solution Delivery:
	•	Selected fix is documented with:
		- Actual test results
		- Git diff of changes
		- Confidence metrics
		- Implementation steps
	•	Results sent back to Cline
	•	Successful branches optionally preserved

⸻

Advantages of the Agentic System
	•	True Autonomy:
Each scenario agent is a full-fledged AI agent capable of independent decision-making and multi-step problem solving.
	•	Parallel Exploration:
Multiple agents work concurrently in isolated branches, increasing the chance of finding effective solutions quickly.
	•	Empirical Validation:
Solutions are validated through actual code execution and testing, not just AI reasoning.
	•	Version Control Integration:
Git-based isolation provides clean experimentation environments while maintaining a history of all attempts.
	•	Scalability:
The system can easily accommodate new scenario types and debugging strategies.
	•	Developer Friendly:
Results are delivered in familiar formats (Git branches, diffs) that integrate naturally into development workflows.
