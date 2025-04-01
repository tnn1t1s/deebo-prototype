# DEEBO TODO (Priority-Sorted for 1.0 Release)

This is the definitive list of tasks needed to prepare Deebo for a public GitHub 1.0 release.
It follows the rules in `rules.txt` and prioritizes only what’s necessary to ship a stable, philosophical, minimal, correct base.

---

## 🛠️ PRIORITY 1 – MUST-HAVE TO SHIP DEEBO 1.0

These are blocking. They affect correctness, portability, or public usability.

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

---

## 💸 PRIORITY 3 – COST REDUCTION / PERFORMANCE

These are cost optimization or toggleable runtime features. They can land after 1.0.

- [ ] **Use QwQ 32b or Claude Haiku for Scenario Agents**
  - Claude Sonnet is expensive; scenarios don’t always need it
  - Allow model override for scenario agents

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

---
