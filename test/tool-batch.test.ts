import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerToolBatch } from "@vanillagreen/pi-tool-renderer/extensions/tool-renderer/batch.js";

const PATCH_MARKER = "context?.executeTool";

async function batchDefinition(agent: unknown, cwd: string) {
  const source = await Bun.file(
    new URL(
      "../node_modules/@vanillagreen/pi-tool-renderer/extensions/tool-renderer/batch.ts",
      import.meta.url,
    ),
  ).text();
  if (!source.includes(PATCH_MARKER))
    throw new Error("patches/pi-tool-renderer-batch-registry.patch is not applied to node_modules");

  let definition: any;
  registerToolBatch({ registerTool: (tool: unknown) => (definition = tool) } as never, agent, cwd);
  return definition;
}

function output(result: any): string {
  return result.content
    .filter((part: any) => part.type === "text")
    .map((part: any) => part.text)
    .join("\n");
}

test("tool_batch unwraps the outcome ctx.executeTool resolves to", async () => {
  const definition = await batchDefinition({}, process.cwd());
  const seen: string[] = [];
  // ctx.executeTool() resolves to a ToolCallOutcome, not to the tool result.
  const context = {
    executeTool: async (name: string, args: unknown) => {
      seen.push(`${name}${JSON.stringify(args)}`);
      return {
        toolCall: { type: "toolCall", id: `call-1/${seen.length}`, name, arguments: args },
        result: { content: [{ type: "text", text: `${name} ran` }], details: {} },
        isError: false,
      };
    },
  };

  const result = await definition.execute(
    "call-1",
    {
      calls: [
        { tool: "read", args: { path: "a.txt" } },
        { tool: "grep", args: { pattern: "probe" } },
      ],
    },
    undefined,
    undefined,
    context,
  );

  expect(seen).toEqual(['read{"path":"a.txt"}', 'grep{"pattern":"probe"}']);
  const text = output(result);
  expect(text).toContain("batch_succeeded=2");
  expect(text).toContain("read ran");
  expect(text).toContain("grep ran");
});

test("tool_batch reports a nested error from the outcome", async () => {
  const definition = await batchDefinition({}, process.cwd());
  const context = {
    executeTool: async (name: string, args: unknown) => ({
      toolCall: { type: "toolCall", id: `call-3/1`, name, arguments: args },
      result: { content: [{ type: "text", text: "ENOENT: no such file" }], details: {} },
      isError: true,
    }),
  };

  const result = await definition.execute(
    "call-3",
    { calls: [{ tool: "read", args: { path: "missing.txt" } }] },
    undefined,
    undefined,
    context,
  );

  expect(result.isError).toBe(true);
  const text = output(result);
  expect(text).toContain("batch_succeeded=0 batch_total=1");
  expect(text).toContain("Status: failed");
  expect(text).toContain("ENOENT: no such file");
});

test("tool_batch falls back to built-in tools without an executable context", async () => {
  const agent = await import("@earendil-works/pi-coding-agent");
  const cwd = mkdtempSync(join(tmpdir(), "pi-suite-tool-batch-"));
  writeFileSync(join(cwd, "a.txt"), "fallback probe");
  try {
    const definition = await batchDefinition(agent, cwd);
    const result = await definition.execute(
      "call-2",
      { calls: [{ tool: "read", args: { path: join(cwd, "a.txt") } }] },
      undefined,
      undefined,
      {},
    );
    const text = output(result);
    expect(text).toContain("batch_succeeded=1");
    expect(text).toContain("fallback probe");
  } finally {
    rmSync(cwd, { force: true, recursive: true });
  }
});
