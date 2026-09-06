---
name: ask-user
description: >-
  Use before high-stakes decisions, irreversible changes, or work blocked by
  ambiguous requirements to collect an explicit user choice.
license: LICENSE
compatibility: Requires Pi 0.74.0 or newer and the ask_user tool.
metadata:
  author: Enzo Lucchesi
  version: "0.15.0"
  short-description: Resolve consequential or ambiguous decisions
allowed-tools: read grep find bash ask_user
---

# ask user

decision control, not chat.

ask before:

- architecture, schema, API, deployment, or security choice
- expensive or destructive change
- unclear/conflicting requirement or success condition
- valid options where preference decides
- material assumption that changes implementation

user already chose exact tradeoff? do not ask again.

## handshake

1. inspect relevant code/docs first. user should not decide blind.
2. summarize current state, constraints, tradeoffs, recommendation. short,
   neutral.
3. call `ask_user`. exactly one focused question. 2-5 outcome-oriented options
   when useful. unrelated choices? separate boundaries, separate calls.
4. restate choice and proceed.
5. ask again only when new material ambiguity appears.

normal boundary: one call. unclear/cancelled? one narrower retry with:

- proceed with recommendation
- choose another option
- stop

after retry: high-stakes still unclear? stop blocked. ambiguity-only and user
says "your call"? choose most reversible default; state assumptions.

avoid trivial formatting questions, broad prompts, repeated confirmation, and
questions answerable by inspection.
