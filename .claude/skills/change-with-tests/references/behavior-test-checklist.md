# Behavior Test Checklist

Use this checklist to keep tests aligned with requirements instead of implementation details.

## For Features

- What public behavior changed?
- Which happy path proves the feature works?
- Which edge cases are part of the contract?
- Which failure cases should stay stable?
- Which existing modules might regress?

## For Bug Fixes

- What was the user-visible bug or broken contract?
- Is there a regression test that fails without the fix?
- Does the test describe the bug symptom instead of the patch shape?
- Are nearby edge cases still covered?

## For Refactors

- What behavior is expected to remain unchanged?
- Which existing tests already protect that behavior?
- Which gaps need new behavior-level tests?
- Are new assertions checking outcomes instead of structure?

## For Technical Design Or Specs

Include:

- target modules and public contracts
- planned unit-test suites or files
- normal, edge, and regression scenarios
- mock, fixture, or factory needs
- command and verification path
- explicit non-goals or uncovered risks

## Anti-Fitting Checks

- Would this test still be valid after an internal rewrite with the same behavior?
- Does the test fail when the requirement is broken, not only when the implementation changes?
- Are mocks minimal, or are they recreating the implementation?
- Are assertions focused on observable outputs and domain behavior?
