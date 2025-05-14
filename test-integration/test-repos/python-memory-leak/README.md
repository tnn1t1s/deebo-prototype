# Python Memory Leak Test Repository

This repository contains a Python data processing application with intentional memory leaks for testing Deebo debugging capabilities.

## Bug Description

The application processes large datasets with several memory management issues:

1. Large objects retained in global variables
2. Circular references preventing garbage collection
3. NumPy arrays not being properly released
4. Missing `del` statements for temporary large objects

## Expected Behavior

When debugging with Deebo:
1. Deebo should identify the memory leak issues
2. Generate hypotheses about memory management approaches
3. Implement fixes that properly release memory

## Test Instructions

1. Run the processing with `python process_dataset.py`
2. Note the error: `MemoryError: Unable to allocate array with shape (1000000, 1000) and data type float64`
3. Use Claude Code with Deebo to debug the issue

## Success Criteria

- Time to first hypothesis < 90 seconds
- Valid solution that resolves memory management issues
- Fix should maintain original processing functionality
- Memory usage should remain stable during processing