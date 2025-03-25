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
	•	Executes Code in Docker:
By launching Docker containers, it ensures a controlled, isolated environment where code is executed and monitored.
	•	Analyzes Execution Results with LLMs:
Deebo leverages advanced language models to analyze outputs and automatically generate debugging reports, complete with fix suggestions and detailed explanations.
	•	Is Modular and Composable:
Its core API is designed independently of any specific interface. Today, it may run as a FastAPI service (or similar backend) and later be wrapped with an MCP server or exposed through a GUI.

⸻

4. Technical Architecture & Tech Stack

Core Modules of the API:
	1.	Code Ingestion Module:
	•	Functionality: Reads the full codebase. We are assuming the client will send a JSON package of error, logs, context, and codebase.
Error: this is cline’s report of the error in the system, and what exactly it wants you to solve. 
Logs: system event logs, whether they’re from the user’s console, Docker, AWS, etc. 
Codebase: cline sends the codebase to deebo the first time it’s called in a chat session. If a previous version exists, Deebo computes a diff and updates its internal codebase.
Context: any other useful information that cline wants Deebo to know that would be helpful for solving the error. Basically space for Cline’s LLM to be creative and thoughtful 
	2.	Docker Manager Module:
	•	Functionality: Manages Docker container lifecycle. It spawns containers using a pre-built Docker image (e.g., deebo-env), injects the code snapshot, sets up the codebase fully to be ready for executing commands and modifying code, for example a full-stack web application or a backend API service, and cleans up afterward.
	3.	Execution Module:
	•	Functionality: Executes commands (like running tests) inside the Docker container and captures outputs (logs, errors, stack traces). The execution module is critical to implement thoughtfully, as it is what agents will use to confirm its experiments in the agentic debugging system.
	4.	Debug Analysis Module (Scenario Agents):
	•	Functionality: Owns and conducts end-to-end experiments that Deebo tells it to do. Reports back the package (error, logs, code, context) from the results of its experiment. Also suggests next steps. Has access to git mcp server, desktopcommander mcp server for codebase access and running code
	5.	Orchestrator (Deebo, Mother Agent):
	•	Functionality: Orchestrates the end-to-end workflow: from ingesting the codebase, managing Docker execution, running the analysis, to cleaning up containers.

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
	•	Containerization: Docker (managed via Python Docker SDK)
	•	Caching: Redis (for metadata/diffs)
	•	Persistent Storage: Supabase Storage (for large artifacts)
	•	LLM Integration: API calls to Claude 3.7 
	•	Testing: pytest for unit/integration tests
	•	Deployment: Docker Compose for local development; production deployment on a cloud platform

⸻





5. Lightweight Wrappers

Once the core API is stable, you can build lightweight wrappers around it:
	•	MCP Server Wrapper (IMMEDIATE PRIORITY):
Wrap the core API in a minimal MCP interface so that platforms like Cline can call Deebo as a single tool (e.g., via a "deebo-debug" endpoint).
	•	Web/Desktop Interface (FUTURE):
Create a simple web or desktop app that calls the core API and presents debugging reports to users.

Deebo aims to revolutionize debugging by automating code ingestion, isolated execution, and intelligent analysis using modern containerization and LLM technologies. Its composable core API is designed for scalability, efficiency, and future integration into various platforms. This roadmap and module breakdown provide a clear, step-by-step guide to building Deebo—from setting up the environment and developing core modules to deploying lightweight wrappers and releasing an MVP.

Overview of the Agentic Debugging System

In an advanced debugging assistant like Deebo, a multi-agent system can improve the reliability and accuracy of the fix generation process. The idea is to split the debugging task into smaller, focused subtasks that multiple specialized agents handle concurrently or in sequence. The two main types of agents in this system are:
	•	Scenario Agents:
These are "worker" agents, each responsible for exploring a distinct debugging strategy or hypothesis. Each Scenario Agent operates in its own isolated environment (typically via a Docker container) where it tests a specific fix or configuration change. They execute debugging experiments, capture outputs, and generate reports on the potential effectiveness of the proposed solution.
	•	Mother Agent:
This is the "orchestrator" agent that oversees the entire debugging process. It collects reports from the Scenario Agents, evaluates their outputs based on predefined criteria (such as success of tests, confidence scores, and overall error reduction), and selects the best solution. The Mother Agent can also decide if further experimentation is necessary (for example, if none of the Scenario Agents yield a satisfactory fix).

⸻

Detailed Roles and Workflow

1. Scenario Agents

Role:
	•	Each Scenario Agent takes a different approach or hypothesis on how to resolve the detected issue. For example, one agent might attempt to fix a missing dependency error, another might try to correct a misconfiguration in the code, and yet another might adjust environment variables.

Key Functions:
	•	Environment Setup:
	•	Each agent gets its own isolated Docker container. This ensures that the experiment doesn't affect the main environment and that each agent can safely run its tests.
	•	The codebase (or its diff) is injected into the container.
	•	Experiment Execution:
	•	The agent executes specific commands or tests (e.g., running unit tests, starting the application, simulating user interactions) to determine if the proposed fix resolves the error.
	•	It captures execution outputs, logs, stack traces, and any error messages.
	•	Analysis & Reporting:
	•	The Scenario Agent uses an LLM (e.g., Claude 3.7) or predefined rules to analyze the output of the execution.
	•	It generates a detailed DebugReport that includes:
	•	The specific hypothesis or fix attempted.
	•	Observations from the execution (e.g., did the error go away? Were new errors introduced?).
	•	A confidence score reflecting how likely the fix is to work.
	•	Any additional insights or suggestions.
	•	Autonomy and Independence:
	•	Each Scenario Agent operates independently, allowing multiple debugging strategies to be tested in parallel. This maximizes the chance of finding a viable solution quickly.

2. Mother Agent

Role:
	•	The Mother Agent is responsible for supervising the overall debugging process. It aggregates the reports generated by all active Scenario Agents, reviews their findings, and then determines which fix is most promising.

Key Functions:
	•	Aggregation:
	•	Collects all DebugReports from the Scenario Agents.
	•	Organizes the reports, noting each agent's proposed fix, test outcomes, and confidence levels.
	•	Evaluation:
	•	Uses pre-defined decision criteria (such as the highest confidence score, successful elimination of errors, or lowest performance impact) to rank the proposed fixes.
	•	May cross-reference with previous debugging sessions to validate the effectiveness of similar fixes.
	•	Decision-Making:
	•	Selects the best candidate fix based on the evaluation.
	•	If no Scenario Agent produces a satisfactory result, the Mother Agent can trigger additional experiments or refine the strategies for a second iteration.
	•	Communication:
	•	Returns the selected fix (and accompanying explanation) to the system (e.g., through the MCP interface or directly to Cline).
	•	Optionally, it can also provide a summary report detailing why a particular solution was chosen and what alternative approaches were considered.

⸻

3. Full Workflow Example
	Cline detects an error in the code
Cline starts a debug session with Deebo, providing:
Error information (message, location, etc.)
Path to the Git repository
Deebo would:
Use git_status to see what files have changed
Use git_diff_unstaged to get the current changes
Use git_show to retrieve committed code
Analyze and debug the issue with full context

	•	This code snapshot is then injected into one or more Docker containers for isolated testing.
	3.	Spawning Scenario Agents:
	•	Multiple Scenario Agents are spawned, each testing a different fix:
	•	Scenario Agent A: Tries adding a missing dependency.
	•	Scenario Agent B: Adjusts environment configuration.
	•	Scenario Agent C: Applies a patch to correct a syntax error.
	•	Each agent runs the code in its container, executes tests, and captures the output.
	4.	Debug Report Generation:
	•	Each Scenario Agent processes the output through its analysis module (using an LLM) and produces a DebugReport.
	•	The reports include details on the attempted fix, test outcomes, and a confidence score.
	5.	Mother Agent Evaluation:
	•	The Mother Agent collects all DebugReports.
	•	It evaluates the results based on criteria like successful error resolution and confidence scores.
	•	The Mother Agent selects the best fix, or if none are satisfactory, decides to generate new scenarios.
	6.	Final Decision & Communication:
	•	The chosen fix and its explanation are sent back to Cline (or the end user).
	•	If the fix is applied, the codebase is updated, and the debugging process is considered successful.
	•	If no fix works, the system notifies the user that deeper investigation is underway, and additional scenarios will be generated.

⸻

Advantages of the Agentic System
	•	Parallel Exploration:
By running multiple debugging strategies concurrently, the system increases the likelihood of quickly finding an effective fix.
	•	Robust Decision-Making:
The Mother Agent ensures that decisions aren't based on a single approach, but rather on a comparative analysis of multiple strategies.
	•	Isolation and Safety:
Each Scenario Agent works in its own Docker container, which prevents conflicts and ensures that experiments don't interfere with one another or with the production code.
	•	Scalability:
The modular design allows you to add more Scenario Agents or refine the decision criteria in the Mother Agent as needed, making the system flexible and scalable.
	•	Future Extensions:
This multi-agent framework can be extended with additional agents, more advanced analytics, or integrated with other systems (such as an MCP server) to further automate and enhance debugging.


