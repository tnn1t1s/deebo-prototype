
Deebo: Autonomous Debugging Assistant

0. Vision (most important)

Our design philosophy is to build a debugging assistant (MCP Server for AI agents like Cline, Cursor, Claude Desktop, etc.) that is as lean and straightforward as possible. We eliminate unnecessary asynchronous frameworks, container orchestrations, or inter-agent communication overhead by leveraging OS-level process isolation. In short, every agent is self-sufficient, self-prompting, and operates independently. The key ideas are:
	•	Process Isolation via MCP Tools:
	•	Dedicated Node Servers: Each scenario agent, when executing a tool (such as a Git command or file operation), spins up its own Node server using npm/npx/uvx. This means there’s no need for additional containers or orchestration frameworks.
	•	Unique Git Branches: Each scenario agent works on its own isolated Git branch. This guarantees that experimental changes remain isolated, prevents merge conflicts, and preserves a complete history of attempted fixes.
	•	Minimal Asynchronous Complexity:
	•	The only asynchronous operation required is at the macro level—where the mother agent waits for all spawned scenario agents to complete, regardless of whether they succeed or crash.
	•	Self-contained OODA Loops: Each scenario agent implements its own micro OODA (Observe, Orient, Decide, Act) loop independently. They do not need to communicate with each other; their only communication is one-way: sending detailed final reports back to the mother agent.
	•	One-Way Reporting: After execution, every agent logs its detailed results (including standard output, errors, and timestamps) and reports them back for centralized aggregation.
	•	Extensive, Centralized Logging:
	•	Every significant event—tool invocations, successes, or errors—is logged in a structured format. This approach provides full visibility into each agent’s state and helps trace the entire debugging process.
	•	Ideally, logs will be in a structured NDJSON format, complete with timestamps and metadata, to simplify monitoring and post-mortem debugging.
	•	Simplicity and Elegance:
	•	By leveraging the natural isolation of separate Node processes and Git branches, we avoid overcomplicating the system with extraneous async frameworks or messaging queues.
	•	The mother agent’s sole responsibility is to spawn scenario agents, wait for their completion, and aggregate their results, while each scenario agent is focused exclusively on executing its own OODA loop as directed by Claude.

In summary, our vision is to create an agentic debugging system that is both robust and minimal. Each agent is autonomous and self-prompting, interacting solely with its environment (via MCP tools) and reporting back to a central orchestrator. This design not only simplifies the overall architecture but also makes the system inherently scalable, fault-tolerant, and developer-friendly.

⸻

1. The Problem

Modern software projects are incredibly complex, and debugging them consumes vast amounts of developer time. Key challenges include:
	•	Time-Consuming Debugging:
Developers often spend hours manually analyzing logs, reproducing errors, and iterating on fixes.
	•	Context Overload:
Large codebases make it difficult for both humans and automated tools to capture and process all relevant context efficiently.
	•	Inconsistent Environments:
Bugs that only appear in certain environments (e.g., production vs. development) add further complexity to the debugging process.
	•	Limited Automation:
Existing tools frequently require manual intervention and do not leverage advanced AI to suggest, validate, and even generate fixes automatically.

⸻

2. IMPORTANT

While our final goal is to build Deebo as a fully composable API, the MVP will be implemented as an MCP server. This server will interface with agents (such as those running on Cline or Cursor) and serve as the central integration point for our debugging system.

⸻

3. What is Deebo?

Deebo is an Agentic Debugging System (ADS) that combines AI with real-world tool execution. It is designed to:
	•	Cache Code Snapshots:
Deebo ingests entire codebases and computes diffs, ensuring that subsequent debugging sessions only process incremental changes.
	•	Utilize Git-Based Isolation:
Each debugging attempt occurs in its own Git branch. This provides a clean, isolated environment for each fix attempt while maintaining a comprehensive history of all changes.
	•	Analyze Execution Results with LLMs:
Deebo leverages advanced language models (like Claude) to analyze outputs, generate debugging reports, and propose detailed fixes complete with empirical validation.
	•	Be Modular and Composable:
The core API is designed independently of any specific interface. Initially, it will run as an MCP server but can later be wrapped with a GUI or integrated into other services.

⸻

4. Technical Architecture & Tech Stack

Core Modules of the API
	1.	Code Ingestion Module:
	•	Functionality: Reads the entire codebase.
	•	Inputs from Cline:
	•	Error: A detailed report of the error that needs fixing.
	•	Logs: System event logs from various sources.
	•	Codebase: The complete codebase is sent on the first invocation; subsequent sessions only send diffs.
	•	Context: Additional helpful context for guiding the debugging process.
	2.	Git MCP Server Integration:
	•	Functionality: Provides direct access to Git operations via standardized MCP API calls.
	•	Capabilities: Status, diff, log, branch creation/checkout, commit, etc.
	•	Benefits:
	•	Ensures clean isolation of debugging attempts through dedicated branches.
	•	Preserves the history of attempted fixes.
	3.	File System MCP Server Integration:
	•	Functionality: Offers file system operations and command execution capabilities through MCP.
	•	Capabilities: Read/write files, list directories, execute terminal commands, process management.
	•	Benefits:
	•	Enables agents to perform real file manipulations and command executions for testing fixes.
	•	Captures output from execution for empirical analysis.
	4.	Debug Analysis Module (Scenario Agents):
	•	Functionality: Each scenario agent is an autonomous agent with its own Claude instance and direct access to MCP tools.
	•	Key Actions:
	•	Create and manage its own Git branch.
	•	Execute real build, test, and validation commands.
	•	Iterate through its internal OODA loop to refine its debugging approach.
	•	Report comprehensive results and evidence back to the mother agent before self-terminating.
	5.	Orchestrator (Mother Agent):
	•	Functionality: Oversees the end-to-end debugging process.
	•	Key Actions:
	•	Analyzes the initial error and determines which debugging scenarios to investigate.
	•	Spawns scenario agents with appropriate hypotheses and initial context.
	•	Collects and aggregates results from scenario agents.
	•	Evaluates results, selects the best solution, and determines if further investigation is needed.

5. MCP Servers in Detail

Git MCP Server
	•	Purpose: Provides a standardized interface to Git version control operations via the MCP.
	•	Key Capabilities:
	•	Repository Analysis: Commands such as status, diff, log, blame, and show.
	•	Branch Management: Creation, checkout, merge, reset.
	•	Change Tracking: Add, commit, push, pull.
	•	History Exploration: Detailed logs and revision-specific commands.
	•	Benefits:
	•	Clean isolation of debugging attempts.
	•	Complete history of attempted fixes.
	•	Seamless integration with developer workflows.

File System MCP Server
	•	Purpose: Offers standardized file system operations and command execution via MCP.
	•	Key Capabilities:
	•	File Operations: Read, write, edit, and directory listing.
	•	Command Execution: Running CLI commands with captured outputs.
	•	Process Management: Starting, monitoring, and terminating processes.
	•	Environment Interaction: Access to system settings and configurations.
	•	Benefits:
	•	Enables agents to modify files and execute tests in real time.
	•	Provides evidence of fix effectiveness through output capture.
	•	Integrates naturally with the development toolchain.


7. Detailed Roles and Workflow

Scenario Agents

Role:
Fully autonomous agents with their own Claude instances, each exploring a distinct debugging hypothesis in isolation.

Key Functions:
	•	Environment Setup:
	•	Each agent creates and manages its own dedicated Git branch.
	•	Gains access to the full suite of MCP tools (Git MCP, File System MCP).
	•	Experiment Execution:
	•	Independently decides on commands and experiments to run.
	•	Executes builds, tests, and validations in its isolated environment.
	•	Analysis & Reporting:
	•	Uses its Claude instance to analyze execution results.
	•	Iteratively refines its hypothesis via its internal OODA loop until it reaches a resolution.
	•	Generates a detailed debug report containing:
	•	The hypothesis and steps executed.
	•	Empirical evidence (command outputs, diffs, logs).
	•	A confidence score based on testing.
	•	An explanation of the solution.
	•	Autonomy:
	•	Does not communicate with other scenario agents.
	•	Self-terminates after reporting results back to the mother agent.

Mother Agent

Role:
The orchestrator overseeing the entire debugging session.

Key Functions:
	•	Analysis & Planning:
	•	Analyzes the error and initial context.
	•	Determines which scenario types (e.g., dependency issues, syntax errors, performance problems) to investigate.
	•	Generates hypotheses for each debugging approach.
	•	Agent Management:
	•	Spawns independent scenario agents with tailored initial prompts and context.
	•	Operates a macro OODA loop:
	•	Observe: Collects outputs and logs from scenario agents.
	•	Orient: Aggregates insights, evaluates empirical evidence.
	•	Decide: Selects the most promising solution or decides to initiate another round of hypothesis testing.
	•	Act: Either terminates the session with the best fix or spawns additional agents.
	•	Communication & Aggregation:
	•	Receives detailed reports from each scenario agent.
	•	Aggregates these reports into a comprehensive session summary.
	•	Provides the final debugging recommendation back to Cline.

⸻

8. Full Workflow Example
	1.	Initial Analysis:
	•	Cline detects an error and starts a debug session with Deebo, sending:
	•	An error report.
	•	The path to the Git repository.
	•	Logs and additional context.
	•	The Mother Agent analyzes the error using Git MCP (e.g., running git_status, git_diff) to establish a baseline.
	2.	Agent Deployment:
	•	The Mother Agent spawns 2-3 scenario agents, each with different debugging hypotheses.
	•	Each scenario agent:
	•	Creates its own Git branch.
	•	Accesses both Git MCP and File System MCP.
	•	Independently executes experiments and tests.
	3.	Investigation Process:
	•	Scenario agents operate in their own micro OODA loops:
	•	Observe: Gather current code and output.
	•	Orient: Use Claude to analyze results and decide next actions.
	•	Decide/Act: Execute tool calls (e.g., create branch, run tests, edit files).
	•	Iterate until a solution is reached or the maximum iteration count is hit.
	•	Each agent logs its every step in a detailed, timestamped report.
	4.	Result Analysis:
	•	The Mother Agent collects and aggregates all scenario agent reports.
	•	It evaluates which hypothesis had the best empirical support (e.g., highest confidence, clear diff evidence).
	•	The Mother Agent may also prompt Claude for a meta-analysis, comparing results across agents.
	5.	Solution Delivery:
	•	The best solution is finalized, documented, and delivered back to Cline.
	•	Debug reports include:
	•	The final Git diff.
	•	Test outputs.
	•	Confidence metrics.
	•	Step-by-step explanations of the changes made.
	•	Optionally, successful branches are preserved for further review.

⸻

9. Advantages of the Agentic System
	•	True Autonomy:
Each scenario agent acts as an independent AI agent with its own decision-making loop, minimizing dependencies.
	•	Parallel Exploration:
Multiple agents work concurrently in isolated environments, increasing the chance of finding a correct fix quickly.
	•	Empirical Validation:
Fixes are validated through real execution of commands, ensuring that solutions are not merely theoretical.
	•	Clean Isolation:
Dedicated Git branches and separate Node servers provide natural isolation, making it easier to track and revert changes.
	•	Scalability:
The system is inherently scalable—adding new scenario types or debugging strategies is as simple as updating the JSON schema and tool mappings.
	•	Developer Friendly:
Debugging reports are delivered in familiar formats (Git diffs, logs), integrating smoothly into existing developer workflows.

⸻

10. Conclusion

Our updated vision for Deebo is to create a robust, autonomous debugging system that leverages the power of MCP tools and advanced AI through Claude. By using process isolation and focused OODA loops at both the scenario and mother agent levels, we avoid unnecessary complexity while ensuring high adaptability and scalability. The system’s elegant minimalism allows for extensive logging and empirical validation, setting the stage for a truly next-generation debugging assistant.

⸻

This document now thoroughly explains our design vision—why we eliminate unnecessary asynchronous frameworks, how each agent self-prompts and isolates its execution, and how the mother agent coordinates the overall debugging process. It provides a concrete roadmap for anyone to understand and further develop the system.