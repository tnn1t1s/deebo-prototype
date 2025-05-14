# Type Error Test Repository

This repository contains a simple Express.js application with intentional null/undefined property access errors for testing Deebo debugging capabilities.

## Bug Description

The application has a user management API that attempts to access properties of undefined objects in several places:

1. User profile access without null checks
2. Configuration settings access without defaults
3. Auth middleware with missing property validation

## Expected Behavior

When debugging with Deebo:
1. Deebo should identify the null/undefined property access
2. Generate hypotheses about proper null checking
3. Implement a fix that handles undefined values gracefully

## Test Instructions

1. Start the application with `npm start`
2. Attempt to access the user profile endpoint
3. Note the error: `TypeError: Cannot read property 'id' of undefined`
4. Use Claude Code with Deebo to debug the issue

## Success Criteria

- Time to first hypothesis < 60 seconds
- Valid solution that adds proper null checks
- Fix should maintain original functionality when valid data is provided