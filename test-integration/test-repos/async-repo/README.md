# Async/Promise Error Test Repository

This repository contains a Node.js application with intentional race conditions and unhandled promise rejections for testing Deebo debugging capabilities.

## Bug Description

The application has a data processing pipeline with several async issues:

1. Unhandled promise rejection in data fetching
2. Race condition between cached and fresh data
3. Missing await in an async function call
4. Incorrect error propagation in async chain

## Expected Behavior

When debugging with Deebo:
1. Deebo should identify the async/promise issues
2. Generate hypotheses about promise handling and race conditions
3. Implement fixes that properly handle async flows

## Test Instructions

1. Start the application with `npm start`
2. Trigger the data processing with the test command
3. Note the error: `UnhandledPromiseRejectionWarning: Error: Data fetch failed`
4. Use Claude Code with Deebo to debug the issue

## Success Criteria

- Time to first hypothesis < 90 seconds
- Valid solution that properly handles promises
- Fix should prevent race conditions
- All async calls should be properly awaited