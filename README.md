# pi-suite

A single package that loads and adapts the Pi extensions used by my personal
Pi harness.

> [!WARNING]
> This repository was created entirely by AI. I do not care about it as a
> standalone project, and I do not provide support or accept responsibility
> for its use. It exists only to hold glue code for my Pi harness.

## Overview

`pi-suite` consolidates my Pi extensions behind one TypeScript entrypoint. It
mostly loads upstream packages unchanged and adds narrow compatibility adapters
where their behavior or rendering needs to fit the rest of my configuration.

The repository is not the source of truth for my complete Pi setup. Nix
configuration elsewhere controls deployment, settings, MCP servers, LSP
servers, agents, secrets, environment variables, and operating-system services.

The suite provides:

- Deterministic, sequential extension loading.
- Isolation of optional extension failures.
- One environment variable for disabling individual modules.
- Compatibility glue for Atuin, autoformatting, cache status, rewind, tool
  rendering, and web access.
- A vendored RTK hook with its provenance recorded in the source.
- Reproducible Nix packaging, including the `computer-use-linux` binaries.

## Usage

The package exposes `src/index.ts` as its Pi extension entrypoint. My Nix
configuration loads the built package through Pi's `settings.packages` option.

Disable modules with a comma-separated environment variable:

```sh
PI_SUITE_DISABLED=lsp,rewind,web-access
```

All modules are enabled by default. Run `/suite` inside Pi to see which modules
loaded, failed, or were disabled.

## Development

Install dependencies and run the checks with Bun:

```sh
bun install
bun run typecheck
bun test
```

Format and validate the Nix flake with its formatter:

```sh
nix fmt
nix flake check
```

Build the package with:

```sh
nix build .#pi-suite
```

Both dependency lockfiles are intentional:

- `bun.lock` is used for local Bun development.
- `package-lock.json` is required by Nix's `buildNpmPackage` and its fixed-output
  dependency hash.

## Upstream projects

The actual extension behavior belongs primarily to the packages listed in
`package.json`. This repository is integration glue, not a replacement for
those projects. Bugs in an upstream extension should generally be reported to
its maintainer rather than here.
