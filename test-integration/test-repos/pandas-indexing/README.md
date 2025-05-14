# Pandas Indexing Error Test Repository

This repository contains a Python data analysis application with intentional Pandas indexing and alignment issues for testing Deebo debugging capabilities.

## Bug Description

The application analyzes tabular data with several DataFrame handling issues:

1. Index alignment errors when joining DataFrames
2. Chain indexing leading to unexpected view vs. copy behavior
3. Mixed integer/label based indexing confusion
4. MultiIndex level selection errors

## Expected Behavior

When debugging with Deebo:
1. Deebo should identify the DataFrame indexing issues
2. Generate hypotheses about proper indexing approaches
3. Implement fixes with correct indexing methods

## Test Instructions

1. Run the analysis with `python analyze_data.py`
2. Note the error: `KeyError: 'Timestamp not in index'` or `SettingWithCopyWarning`
3. Use Claude Code with Deebo to debug the issue

## Success Criteria

- Time to first hypothesis < 70 seconds
- Valid solution that resolves indexing issues
- Fix should eliminate SettingWithCopyWarning messages
- Analysis should produce correct results after fixes