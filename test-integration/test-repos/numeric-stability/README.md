# Numeric Stability Test Repository

This repository contains a Python scientific computing application with intentional numeric stability issues for testing Deebo debugging capabilities.

## Bug Description

The application performs numerical computations with several stability issues:

1. Catastrophic cancellation in floating-point subtraction
2. Loss of precision in accumulation of small values
3. Numerical instability in eigenvalue computation
4. Ill-conditioned matrices in linear system solvers

## Expected Behavior

When debugging with Deebo:
1. Deebo should identify the numerical stability issues
2. Generate hypotheses about appropriate numerical methods
3. Implement fixes with stable algorithms or better conditioned approaches

## Test Instructions

1. Run the simulation with `python run_simulation.py`
2. Note the error: `RuntimeWarning: invalid value encountered in sqrt` followed by `nan` values in results
3. Use Claude Code with Deebo to debug the issue

## Success Criteria

- Time to first hypothesis < 120 seconds
- Valid solution that improves numerical stability
- Fix should prevent NaN/Inf values in results
- Results should match reference values within tolerance