---
name: subagent-workflows
description: >-
  Use when writing, debugging, or saving a SubagentWorkflow script. Carries the
  full scripting API the compact tool description omits: agent options,
  pipeline/parallel semantics, sandbox rules, saved-workflow paths.
license: LICENSE
compatibility: Requires @tintinweb/pi-subagents with workflows enabled.
metadata:
  author: Adam0
  version: "1.1.0"
  short-description: SubagentWorkflow scripting reference
allowed-tools: SubagentWorkflow Agent
---

# subagent workflows

workflow = one JS script coordinating many subagents. each `agent()` call spawns
a real subagent with own context and tools. script itself has no filesystem,
network, or module access. numbers of agents discovered at runtime, staged work,
or independent verification? workflow. one task or few known agents? `Agent`
tool instead. user opted into orchestration? requirement, not preference.

## script shape

1. first statement `export const meta = { name, description, phases: [{ title,
   detail? }] }`. pure literal. no variables, calls, spreads, interpolation.
   phase titles must match `phase()` calls; unmatched titles get own group.
2. plain JS, async context. standard built-ins only. `Date.now()`,
   `Math.random()`, argless `new Date()`, `eval` throw. timestamps in via
   `args`; vary prompts by index.
3. `agent()` returns final text as raw data, or validated object with `schema`.
   returns `null` on failure or user skip — indistinguishable.
   `.filter(Boolean)` after every schema stage.
4. prefer `pipeline` over `parallel`. barrier only when stage needs every prior
   result together.
5. verify by running (`gate`), not by asking another model.

## tool params

- `script` inline source. `scriptPath` file, wins over `script`. `name` saved
  workflow, lowest precedence. at least one required.
- `args` JSON-shaped, handed to script as `args` global verbatim.
- `resumeFromRunId` replay earlier run in this session, `^wf_[a-z0-9-]{6,}$`.
- `title`/`description` accepted and ignored.

## agent(prompt, opts?)

option keys rejected by name; values not validated — wrong `agentType` falls
back to `general-purpose` silently.

- `label` display name; also handle `resume` addresses.
- `phase` named group; use inside `pipeline`/`parallel` stages where ambient
  `phase()` races.
- `agentType` default `general-purpose`; built-ins `general-purpose`,
  `Explore`, `Plan`, plus custom agents.
- `model` `provider/modelId` or fuzzy like `haiku`.
- `effort` `minimal`…`max`. omit to inherit agent definition, then parent.
- `isolation: "worktree"` only when agents write files in parallel and would
  collide. fails loudly when not a git repo with commits.
- `gate: "<command>"` run after agent finishes. non-zero exit fails agent,
  command output becomes error.
- `resume: "<label>"` continue that child. cannot combine with `agentType`,
  `model`, `effort`, `isolation`, `gate`, `schema`.
- `schema` JSON Schema, object root. pressure, not guarantee — child that never
  produces matching payload still resolves `null`. keep schemas small and flat.

## pipeline(items, ...stages) / parallel(thunks)

`pipeline` no barrier: item A in stage 3 while B still in stage 1. stage gets
`(previousResult, originalItem, index)`. stage throws? that item drops to
`null`, remaining stages skip.

`parallel` barrier: waits all. thunk throws? becomes `null`, siblings safe.

barrier earned only when stage needs full set: dedup across all results, early
exit on zero, prompt comparing one result against all others. flatten/map/filter
inside a pipeline stage, not before a barrier.

## workflow(nameOrRef, args?)

run saved workflow inline. name or `{ scriptPath }`. `args` becomes child's
`args`. shares worker, concurrency cap, abort, journal, budget; phases render as
own group. one nesting level only — `workflow()` inside child throws.

## phase(), log(), args, budget

- `phase(title)` starts progress group for subsequent `agent()` calls.
- `log(message)` progress line.
- `args` tool call's `args`, verbatim; `undefined` if none.
- `budget.{total, spent(), remaining()}`. `total` always `null` — pi has no
  token directive, so Claude Code `budget.total` guards correctly never fire.
  `remaining()` is `Infinity` with no target.

## limits

concurrency `max(1, min(16, cpus - 2))`. 1000 agents per run. 4096 items per
`parallel`/`pipeline` call. 256 nested `workflow()` calls. 512 KiB script.
excess items queue, not crash.

## saved workflows

`.pi/workflows/` (project) → `.agents/workflows/` → `<agent dir>/workflows/`,
first hit wins. run with `{ name: "<name>" }`; re-run edited script with
`{ scriptPath: "<path>", resumeFromRunId }`. same script + same args replays
cached agent calls; first changed call runs live.
