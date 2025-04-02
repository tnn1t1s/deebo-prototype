# DEEBO TODO (Priority-Sorted for 1.0 Release)

This is the definitive list of tasks needed to prepare Deebo for a public GitHub 1.0 release.  
It follows the rules in `rules.txt` and prioritizes only what’s necessary to ship a stable, philosophical, minimal, correct base.

Legend:

X = implemented, tested, complete (afaik)

! = implemented, not tested

---

## 🛠️ PRIORITY 1 – MUST-HAVE TO SHIP DEEBO 1.0

These are blocking. They affect correctness, portability, or public usability.
- [!] **Agents Consistently Fail to Access Memory Bank** 
  - All agents try `memory-bank` or `/memory-bank` and get denied
  - Logged: `"Access denied - path outside allowed directories"`
  - Mother agent is confirmed to be using `join(DEEBO_ROOT, 'memory-bank')`, but Claude is likely being told a relative path
  - FIX: inject `"memoryPath"` in `tools.json` and prompt Claude to use that absolute path

- [!] **Claude Crashes on Trailing Whitespace**
  - `SCENARIO ERROR: 400` with `final assistant content cannot end with trailing whitespace`
  - Occurs when writing report to `session-xxxx/reports/session-xxxx.json`

- [!] **Inconsistent Tool Parameters Cause Repeated Failures** 
  - Examples from logs:
    - `"branch"` instead of `"branch_name"`
    - `"changes"` instead of `"edits"`
    - `"pattern"` / `"replacement"` instead of `"oldText"` / `"newText"`
  - Fix is not prompt tuning alone — enforce usage examples like Cline does

- [!] **Prompt Better for Tool Use (Copy Cline)**
  - Provide canonical `<use_mcp_tool>` examples in agent system prompts
  - Copy Cline's format for clarity and success rate
- [!] **Reduce Redundant Hypotheses via Prompt + Context Args**
  - Claude already receives full message history per scenario
  - But agents still retry the same ideas unless prompted not to
  - Update mother prompt to say:
    > "Avoid redundant hypotheses. Use prior scenario results to avoid repeating work."
  - Remind mother to utilize scenario args such as 'context' to give it useful information such as 'dont try x i already tried x and it gave y its a waste of time' 
- [ ] **Finalize Session Completion Signal for Cline**
  - Currently: Cline polls and waits for end condition
  - Ideas:
    - Write flag/log indicating completion
    - Return ETA or session phase via `checkSessionStatus()`
    - Don't return full logs — return summary, error, status
  - Update: finalized on gemini's 'session pulse' plan
- [ ] **Hardcoded Path in Config**
    - File: config/tools.json
    - Problem: The git-mcp command path /Users/sriram/.local/bin/uvx is specific to one machine.
    - Result: Not portable.
    - Why it matters: While not a direct rule violation, robust system infrastructure (Rule 1) should ideally be easily deployable.

---

## ⚙️ PRIORITY 2 – CLEANUP / INFRA REFACTOR

Not strictly blocking, but improves clarity, modularity, and contributor sanity.

- [ ] **Refactor `agent-utils.ts`**
  - Extract shared logic:
    - Tool XML parsing
    - Claude message helpers
    - Scenario arg parsing
    - Logging wrapper (from `logger.ts`)
  - Goal: minimal duplication across `mother-agent.ts`, `scenario-agent.ts`, `mcp.ts`

- [!] **Format `activeContext.md` Better**
  - Use direct FS operations:
    - On start: write date + client error message
    - On session end / crash: append `==========` + mother's notes
  - Be careful not to duplicate `progress.md` behavior

- [!] **Git Repo Requirement (Discuss)**
  - Deebo implicitly requires `.git/` to function
  - Decide:
    - Fail gracefully if not a Git repo
    - Or `git init` automatically (but this is invasive and potentially surprising)
  - Leans toward: **Document in README** and don’t handle responsibility inside Deebo



---

## 💸 PRIORITY 3 – COST REDUCTION / PERFORMANCE

These are cost optimization or toggleable runtime features. They can land after 1.0.

- [ ] **Use QwQ 32b or Claude Haiku for Scenario Agents**
  - Claude Sonnet is expensive
  - Plan to test QwQ-32b and R1 tomorrow and compare

- [ ] **Tool Suppression for Cheap Mode**
  - Add a flag for “no tools” debugging
  - Claude will only debate/think, no `<use_mcp_tool>` XML

---

## ✨ PRIORITY 4 – STRATEGIC / FUTURE RELEASE

These are philosophical polish or extra clarity. Not needed for 1.0.

- [ ] **Cheap Mode (Prompt-Only Debugging)**
  - Like `chorus.sh`: agents debate hypotheses with no tool calls
  - Good for fast/low-resource use cases

- [ ] **Explicit `<unsolvable>` Tag**
  - Let Claude declare a session unsolvable
  - Useful for returning clear failure state without relying on timeout

---

## ✅ DONE OR WORKING AS DESIGNED

- [x] Loop regeneration already supported via Mother’s OODA loop
- [x] Mother optionally reads memory-bank via `filesystem-mcp`
- [x] Scenario agents write reports statelessly via infra
- [x] Raw tool output passed to Claude without formatting
- [x] Claude is trusted to parse everything
- [x] `progress.md` and `activeContext.md` are updated correctly when enabled
- [X] **Fix `tools.json` Paths — Dynamic Tool Path Support**
  - Remove hardcoded `DEEBO_ROOT` references
  - Build tool paths dynamically from `repoPath`
  - Implement inside `connectMcpTool()` or launch wrapper

- [X] **Cancel Session Tool in `index.ts`**
  - Add a new `cancel` tool to abort a debug session early
  - Minimal implementation: flag session as canceled or clean up memory/logs

- [X] **Explicit git-mcp Preference in Prompt**
  - Update Claude prompts to strongly prefer `git-mcp` for all Git ops
  - Penalize usage of `filesystem-mcp` to edit `.gitignore` etc.

- [X] **Clarify `progress.md` Behavior**
  - Confirm current behavior:
    - Appends successful session summary OR
    - Logs error like:
      ```
      ## Debug Session session-... - 2025-...
      Error: Error: Investigation exceeded maximum runtime
      Failed: ...
      Scenarios Run: 8
      Duration: 950s
      ```