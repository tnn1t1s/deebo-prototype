# NumPy Shape Error Test Repository

This repository contains a Python data processing application with intentional NumPy shape mismatch errors for testing Deebo debugging capabilities.

## Bug Description

The application processes scientific data with several matrix operations that result in shape inconsistencies:

1. Matrix multiplication with incompatible dimensions
2. Broadcasting errors in array operations
3. Indexing errors with multi-dimensional arrays
4. Incorrect axis specification in reduction operations

## Expected Behavior

When debugging with Deebo:
1. Deebo should identify the shape incompatibility issues
2. Generate hypotheses about correct dimensions and transformations
3. Implement fixes with proper reshaping or transposition operations

## Test Instructions

1. Run the analysis with `python analyze_data.py`
2. Note the error: `ValueError: operands could not be broadcast together with shapes (10,5) (5,20)`
3. Use Claude Code with Deebo to debug the issue

## Success Criteria

- Time to first hypothesis < 60 seconds
- Valid solution that resolves shape incompatibilities
- Fix should maintain mathematical correctness of operations
- Analysis should complete successfully after fixes