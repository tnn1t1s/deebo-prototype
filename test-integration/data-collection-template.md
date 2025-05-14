# Deebo-Claude Code Integration Test Data Collection Template

## Test Information

- **Test ID**: [REPO-CONDITION-RUN#]
- **Repository**: [REPOSITORY_NAME]
- **Test Condition**: [CLAUDE_ONLY or WITH_DEEBO]
- **Run Date**: [DATE]
- **Tester**: [NAME]

## Setup

- **Claude Code Version**: [VERSION]
- **Deebo Version**: [VERSION]
- **Python Version**: [VERSION]
- **NumPy/Pandas Versions**: [VERSIONS]
- **Error Description**: [ERROR_TEXT]

## Time Metrics

- **Session Start Time**: [HH:MM:SS]
- **First Hypothesis Time**: [HH:MM:SS]
- **Time to First Hypothesis**: [SECONDS]
- **Solution Delivery Time**: [HH:MM:SS]
- **Time to Solution**: [SECONDS]
- **Number of Hypotheses Generated**: [COUNT]
- **Hypothesis Generation Rate**: [HYPOTHESES/MINUTE]

## Quality Metrics

- **Solution Correctness**: [0 or 1]
- **Solution Quality Score**: [1-5]
  - Robustness: [1-5]
  - Readability: [1-5]
  - Performance: [1-5]
  - Generalizability: [1-5]
- **Relevant Hypotheses**: [COUNT]
- **Total Hypotheses**: [COUNT]
- **Hypothesis Relevance Ratio**: [RATIO]

## Efficiency Metrics

- **Tool Usage Appropriateness**: [1-5]
  - Tool Selection: [1-5]
  - Parameter Accuracy: [1-5]
  - Result Interpretation: [1-5]
- **Peak Memory Usage**: [MB]
- **Average CPU Usage**: [%]
- **Number of Tool Calls**: [COUNT]

## Solution Details

### Identified Root Cause
[DESCRIPTION]

### Implemented Fix
```python
# Code snippet of the implemented solution
```

### Validation Method
[DESCRIPTION]

## Observations

### Strengths
- [POINT 1]
- [POINT 2]
- ...

### Weaknesses
- [POINT 1]
- [POINT 2]
- ...

### Additional Notes
[ANY ADDITIONAL OBSERVATIONS]