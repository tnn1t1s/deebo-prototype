# Deebo-Claude Code Integration Test Execution Guide

This guide outlines the step-by-step process for executing the integration tests between Deebo and Claude Code.

## Prerequisites

1. Ensure Deebo is installed:
   ```bash
   npx deebo-setup@latest
   ```

2. Configure Claude Code with Deebo MCP:
   - Copy `test-integration/mcp.json` to `~/.claude-code/mcp.json`
   - Update the API key in the configuration

3. Ensure required tools are installed:
   - Python 3.8+
   - NumPy, Pandas, Matplotlib
   - Claude Code CLI

## Test Execution Process

### 1. Prepare Test Environment

```bash
# Clone this repository if not already available
git clone https://github.com/your-org/deebo-prototype.git
cd deebo-prototype

# Switch to the integration testing branch
git checkout feature/claude-code-integration
```

### 2. Run Baseline Claude Code Tests

For each test repository:

1. Navigate to the test repository
   ```bash
   cd test-integration/test-repos/numpy-shape-error
   ```

2. Run the test to generate the error
   ```bash
   ./run_test.sh
   ```

3. Start Claude Code without Deebo integration
   ```bash
   claude-code
   ```

4. Ask Claude Code to fix the error (copy the error message)
   ```
   I'm getting the following error when running analyze_data.py. Can you help me debug it?
   
   [Error message from test run]
   ```

5. Record metrics in a copy of `data-collection-template.md` named `numpy-shape-error-claude-only-run1.md`

6. Repeat 3 times to get consistent measurements

### 3. Run Deebo-Claude Code Integration Tests

For each test repository:

1. Navigate to the test repository
   ```bash
   cd test-integration/test-repos/numpy-shape-error
   ```

2. Run the test to generate the error
   ```bash
   ./run_test.sh
   ```

3. Start Claude Code with Deebo integration
   ```bash
   claude-code
   ```

4. Ask Claude Code to fix the error using Deebo
   ```
   I'm getting the following error when running analyze_data.py. Can you help me debug it using Deebo?
   
   [Error message from test run]
   ```

5. Record metrics in a copy of `data-collection-template.md` named `numpy-shape-error-with-deebo-run1.md`

6. Repeat 3 times to get consistent measurements

### 4. Validate Solutions

For each solution:

1. Compare the solution with `expected_solution.py`
2. Score the solution on the quality metrics from the evaluation framework
3. Document any notable differences or improvement areas

### 5. Compile Results

Generate a summary report including:

1. Average metrics for each condition
2. Comparative performance analysis
3. Key observations and recommendations

## Troubleshooting

### Common Issues

1. **Claude Code MCP Connection Issues**
   - Ensure paths in the MCP configuration are absolute
   - Check Claude Code logs for connection errors
   - Verify Deebo server is running

2. **Deebo Tool Access Issues**
   - Ensure `.claude.md` is present in the repository root
   - Verify that the tools are registered correctly

3. **Missing API Keys**
   - Check that OpenRouter API key is correctly set in the configuration

4. **Memory Issues**
   - If Deebo crashes, try increasing `--max-old-space-size` in the MCP configuration

## Data Collection Tips

1. Use a stopwatch for precise timing measurements
2. Take screenshots of key moments in the debugging process
3. Save all error messages and outputs for later analysis
4. Document any manual interventions required during testing