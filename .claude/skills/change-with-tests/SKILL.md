---
name: change-with-tests
description: Use when a request changes code behavior, fixes a bug, refactors code, or defines future code changes that should be paired with unit tests, including technical designs and specs that lead to implementation work.
---

# Change With Tests

Use this skill for any task that changes code or defines code changes.

This skill is complementary to `prd-to-opsx`, not a replacement for it:

- use `prd-to-opsx` to refine PRDs or natural-language requests into high-quality OpenSpec design and task artifacts
- use `change-with-tests` to enforce that any resulting implementation, bugfix, refactor, or design-to-code task addresses unit tests
- when both apply, run or follow both: `prd-to-opsx` defines what should be built, `change-with-tests` constrains how code-changing work must be tested

This skill is intentionally repo-agnostic. Project-specific test runner, commands, file locations, mocks, and current test status should come from `AGENTS.md`, `docs/testing.md`, and the nearby test files in the repository.

## Core Rule

- Code changes are not complete unless unit-test impact is addressed.
- If unit-test tooling already exists, write or update tests in that existing stack.
- If no safe unit-test path exists, do not silently skip tests. Explain the blocker and the minimum next step.

## Read First

- `AGENTS.md`
- `docs/testing.md`
- existing tests near the target module

If repository guidance conflicts with this skill, follow the repository guidance.

## Behavior-First Workflow

1. Restate the user-visible behavior, regression, or acceptance criteria before editing code.
2. Derive test cases from requirements, bug repros, edge cases, and public interfaces before finalizing the implementation.
3. Implement code and tests as one change.
4. Run a non-watch test command when available.
5. Report what behavior the tests cover and what still remains uncovered.

Use `references/behavior-test-checklist.md` when scoping coverage or reviewing whether the tests are too coupled to the implementation.

## Test Quality Guardrails

- Prefer stable public contracts such as return values, rendered output, state transitions, visible side effects, and domain errors.
- Avoid asserting private helpers, internal call order, incidental intermediate state, or mocks that merely mirror the implementation.
- Add explicit regression cases for bug fixes.
- For refactors with no intended behavior change, keep or strengthen existing behavior tests rather than rewriting them around internals.
- Reuse existing test helpers, factories, fixtures, and mock conventions from the repo.

## Delegation

If the current tool supports subagents and delegation is allowed under that tool's rules:

- Prefer assigning unit test authoring or independent test review to a subagent.
- Give the subagent only the task intent, acceptance criteria, touched files, public interfaces, and current test conventions.
- Do not frame the task as "write tests that match this implementation". Ask for behavior-oriented tests or an independent regression test pass.
- Review the returned tests and reject cases that only validate implementation details.

If delegation is unavailable, preserve the same separation by writing the test plan from requirements before editing code.

## When Tooling Already Exists

Interpret `docs/testing.md` states this way:

- `present`: update existing tests or add new tests in the current stack.
- `partial`: keep the current runner and config. Adding the first real smoke or regression tests is expected.
- `absent`: if the current task can safely introduce the minimum unit-test path, do so; otherwise stop and explain the blocker.
- `ambiguous` or `unsupported`: do not invent a framework. Explain the blocker and the safest next step.

Never replace the current runner or switch frameworks just because another stack would be easier for the current task.

## Design And Spec Work

When writing requirements, technical design, change plans, or task breakdowns, include a testing section.

If the current design or task plan comes from `prd-to-opsx` or OpenSpec artifacts, keep those artifacts and add testing obligations on top of them rather than treating the skills as alternatives.

Minimum contents:

- affected modules or public contracts
- planned unit-test files or suites
- normal, edge, and regression scenarios
- mock or fixture needs
- test command or verification path
- risks not covered by unit tests

When producing task lists, pair implementation tasks with test tasks.

## Completion Standard

A code-change task should normally end with:

- code changes
- unit test changes or an explicit blocker
- test execution result or a clear reason it was not run
- a brief coverage summary tied to the requirement, bug, or refactor goal
