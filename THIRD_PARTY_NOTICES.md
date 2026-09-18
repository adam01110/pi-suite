# Third-party notices

## RTK Pi extension

[`src/vendor/rtk.ts`](./src/vendor/rtk.ts) is derived from the RTK 0.45.0
Pi extension:

<https://github.com/rtk-ai/rtk/blob/v0.45.0/hooks/pi/rtk.ts>

The upstream file is licensed under the Apache License 2.0. The copy in this
repository was modified in 2026 by Adam0 to add provenance and licensing
metadata for inclusion in pi-suite. RTK 0.45.0 does not include an upstream
`NOTICE` file.

The full Apache License 2.0 text is available at
[`LICENSES/Apache-2.0.txt`](./LICENSES/Apache-2.0.txt).

## Packaged skill overrides

The following skill directories are derived from bundled extension packages.
Their instructions were condensed for the local Pi configuration, and their
metadata was adapted for pi-suite:

- [`skills/ask-user`](./skills/ask-user) from `pi-ask-user` 0.15.0
- [`skills/computer-use-linux`](./skills/computer-use-linux) from
  `@agent-sh/computer-use-linux` 0.7.0
- [`skills/mcp-scripting`](./skills/mcp-scripting) from `pi-mcp-adapter` 2.34.0

Each directory contains its upstream MIT license.

All dependencies bundled under `node_modules` retain their respective
licenses and notices.
