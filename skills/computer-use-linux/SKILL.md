---
name: computer-use-linux
description: >-
  Use when observing or controlling the local Linux desktop through accessibility
  trees, screenshots, window targeting, or synthesized input.
license: LICENSE
compatibility: >-
  Requires Linux. Native Pi tools require Pi 0.84.4+ and Node.js 22.19+; the
  standalone CLI and MCP server support Node.js 18+.
metadata:
  author: agent-sh
  version: "0.5.0"
  short-description: Observe and control the local Linux desktop
allowed-tools: computer_use_linux_tools
---

# computer use linux

local Linux GUI only. remote browser/headless task with specific tool? use that
instead.

## flow

1. call `computer_use_linux_tools` with exact tools/capability needed. enabled
   tools appear next turn as `computer_use_linux_<name>`.
2. start each control turn with `get_app_state`; omit screenshot when tree is
   enough.
3. before input, identify target with `list_windows` or `focused_window`. verify
   title, app id, pid, or wm class.
4. prefer accessibility element index or role/name/text/state selector.
   coordinates only when tree cannot target.
5. prefer `type_text` with explicit window/process/app/terminal selector over
   current focus.
6. mutating calls are stateful: run serially. after click, drag, key, text,
   action, or value change, read state again.

process exited or target uncertain after mutation? never replay blindly. obtain
fresh app state.

readiness missing? inspect `doctor` only when detail helps; report blocker.
configuration belongs outside this skill.

first screenshot may trigger portal prompt. apps started before AT-SPI may need
restart.
