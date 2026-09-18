---
name: mcp-scripting
description: >-
  Use when coordinating multiple MCP searches, inspections, or calls with
  JavaScript control flow through mcpScript.
license: LICENSE
compatibility: Requires Node.js 20 or newer and the Pi MCP adapter.
metadata:
  author: Nico Bailon
  version: "2.34.0"
  short-description: Coordinate multi-call MCP workflows
allowed-tools: mcpScript mcp
disable-model-invocation: true
---

# mcp scripting

one search, describe, status, auth, or call? use `mcp`. many calls needing loop,
filter, chain, fan-out, or retry? use `mcpScript` with plain JavaScript.

## flow

1. discover: `await tools.search({ query, server?, limit?, offset? })`.
2. inspect exact path: `await tools.describe({ path })`.
3. execute: `await tools.call(path, args)`.

call returns `{ ok: true, data }` or `{ ok: false, error }`. handle failure.
`emit(value)` is user-visible. console output is captured. normal connection,
auth, output, and approval gates still apply.

known identifier path? direct `tools.github_search_issues(args)` works.
hyphenated or reserved path? use `tools.call("exact-path", args)`.

never enumerate `tools`; proxy refuses. await search/describe. default timeout is
30s and kills worker. final result has call trace. no fluent `tools.find`,
`tools.parallel`, or `tools.retry` helpers.
