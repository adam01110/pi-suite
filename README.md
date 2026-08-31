<div align="center">

# pi-suite

The extension bundle behind my personal [Pi](https://github.com/badlogic/pi-mono) harness.

[![Pi](https://img.shields.io/badge/Pi-extension_suite-458588?style=flat-square&labelColor=504945)](https://github.com/badlogic/pi-mono)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-689d6a?style=flat-square&labelColor=504945&logo=typescript&logoColor=ebdbb2)](https://www.typescriptlang.org)
[![Bun](https://img.shields.io/badge/Bun-tested-b16286?style=flat-square&labelColor=504945&logo=bun&logoColor=ebdbb2)](https://bun.sh)
[![Nix](https://img.shields.io/badge/Nix-flake-fe8019?style=flat-square&labelColor=504945&logo=nixos&logoColor=ebdbb2)](https://nixos.org)

[Overview](#overview) - [Usage](#usage) - [Modules](#modules) - [Development](#development) - [Layout](#layout)
</div>

I made this to keep the Pi extensions used by my config behind one package and
one entrypoint. Most modules are loaded from upstream unchanged; the rest have
small adapters where their behavior, tools, or rendering need to fit together.

> [!WARNING]
> This repository was created entirely by AI. I do not treat it as a standalone
> project, provide support for it, or accept responsibility for its use. It
> exists as glue for my own Pi harness.

## Overview

- Loads extensions sequentially so UI and tool integrations initialize in a
  predictable order.
- Keeps optional extension failures isolated instead of preventing Pi from
  starting.
- Lets individual modules be disabled through one environment variable.
- Adapts Atuin, autoformatting, cache status, rewind, tool rendering, and web
  access.
- Vendors an adapted RTK integration with its provenance recorded in source.
- Packages the suite reproducibly with Nix, including the
  `computer-use-linux` binaries.

This is not the source of truth for my complete Pi setup. My Nix configuration
handles deployment, settings, MCP and LSP servers, agents, skills, secrets,
environment variables, and operating-system services.

## Usage

The package exposes `src/index.ts` as its Pi extension entrypoint. I build it
with Nix and load the resulting package through Pi's `settings.packages` option.

Build the package with:

```bash
nix build .#pi-suite
```

Disable individual modules with a comma-separated environment variable:

```bash
PI_SUITE_DISABLED=lsp,rewind,web-access
```

All modules are enabled by default. Run `/suite` inside Pi to list the modules
that loaded, failed, or were disabled.

## Modules

The suite currently combines:

| Group | Modules |
| --- | --- |
| Interface | QOL, header, footer, cache status, cache optimizer, Atuin, fast resume |
| Workflow | BTW, cwd, FFF, autoformat, rewind, subagents |
| Tools | ask-user, computer use, LSP, MCP, RTK, web access |
| Rendering | autoformat and shared tool-renderer adapters |

The actual extension behavior primarily belongs to the dependencies in
[`package.json`](./package.json). Bugs in an unchanged upstream extension should
generally go to its maintainer rather than here.

## Development

Install dependencies and run the TypeScript checks and tests with Bun:

```bash
bun install
bun run typecheck
bun test
```

Format and check the complete flake with Nix:

```bash
nix fmt
nix flake check
```

## Layout

| Path | Contents |
| --- | --- |
| `src/index.ts` | Ordered module registry and `/suite` command |
| `src/glue/` | Compatibility adapters around upstream extensions |
| `src/vendor/` | Adapted vendored integrations and provenance notes |
| `test/` | Bun tests for the registry, tracking, and rendering |
| `flake/` | Nix package and treefmt configuration |
