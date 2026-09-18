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
  version: "0.7.0"
  short-description: Observe and control the local Linux desktop
allowed-tools: computer_use_linux_tools
---

# computer use linux

local Linux GUI only. remote browser/headless task with specific tool? use that
instead.

## flow

1. call `computer_use_linux_tools` with exact tools/capability needed. enabled
   tools appear next turn as `computer_use_linux_<name>`.
2. start each control turn with `get_app_state`, scoped: pass
   `app_name_or_bundle_identifier` or a window target (`window_id`, `pid`,
   `app_id`, `wm_class`, `title`). unscoped result is the whole desktop tree with
   `tree_scoped: false` and floods context. omit screenshot when tree is enough.
   `accessibility_tree_truncated: true`? narrow the target and raise `max_nodes`
   or `max_depth` (caps 2000 and 64), never lower them.
3. before input, identify target with `list_windows` or `focused_window`. verify
   title, app id, pid, or wm class.
4. prefer accessibility element index or role/name/text/state selector.
   coordinates only when tree cannot target. left element/index/selector `click`
   uses native AT-SPI `click`, `press`, or `toggle`; explicit `x`/`y`, right, and
   double/multiple clicks keep pointer semantics. entry `activate` or slider
   `jump`? use `perform_action`; `click` never substitutes it.
5. prefer `type_text` with explicit window/process/app/terminal selector over
   current focus.
6. mutating calls are stateful: run serially. after click, drag, key, text,
   action, or value change, read state again.

process exited or target uncertain after mutation? never replay blindly. obtain
fresh app state.

readiness missing? `can_build_accessibility_tree: false` → run
`setup_accessibility`, then restart the target app. `can_query_windows: false`
on GNOME Wayland → run `setup_window_targeting`, then log out and back in if
asked. inspect `computer_use_linux_doctor` only when detail helps; report
blocker. `guard-accessibility` in a foreground terminal only when the user
explicitly asks to hold the GNOME `toolkit-accessibility` key open.
configuration belongs outside this skill.

first screenshot may trigger portal prompt. apps started before AT-SPI may need
restart.
