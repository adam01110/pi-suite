# pi-codemode

Vendored from `@georgebashi/pi-codemode` 0.1.0.

- Package: [npm](https://www.npmjs.com/package/@georgebashi/pi-codemode)
- Integrity: `sha512-o2BzellMfUW6gtDPZ2JqeQf4+MYenNj5I3/Y3WYkZR0RId2CPBsegap6tLkN6mt+XNuTAOswsQJsRKJytS7YKw==`
- License: MIT; see `LICENSE`.

Local adaptations:

- use the `@earendil-works` Pi packages and current `typebox` package;
- use Pi's current batched edit-tool input;
- load as an ES module without CommonJS `require` calls;
- route MCP calls through pi-suite's current `pi-mcp-adapter` proxy;
- keep `mcpScript` unavailable while preserving adapter authentication, policy,
  and lifecycle handling.
