import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { refreshTranscriptOnSessionStart } from "../src/glue/tool-renderer.js";
import { importUpstream } from "../src/upstream.js";

describe("transcript refresh", () => {
  test("repaints a restored message after upstream initializes its context", async () => {
    const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => void>>();
    const pi = {
      on(event: string, handler: (event: unknown, ctx: ExtensionContext) => void) {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      },
    } as unknown as ExtensionAPI;
    class UserMessage {
      contentBox = { paddingY: 1, setBgFn() {}, invalidateCache() {} };
      render(_width: number) {
        return ["hello"];
      }
    }
    const upstream = await importUpstream(
      "@vanillagreen/pi-tool-renderer/extensions/tool-renderer/messages.js",
    );
    upstream.installUserMessageRenderer(pi, UserMessage);
    refreshTranscriptOnSessionStart(pi);
    const message = new UserMessage();
    let cached: string[] | undefined;
    const render = () => (cached ??= message.render(40));
    const widgets = new Set<string>();
    let repaints = 0;
    const tui = {
      invalidate() {
        cached = undefined;
      },
      requestRender() {
        repaints++;
        render();
      },
    };
    const ctx = {
      mode: "tui",
      hasUI: true,
      cwd: process.cwd(),
      ui: {
        setWidget(key: string, factory?: (tui: unknown) => unknown) {
          if (factory) {
            factory(tui);
            widgets.add(key);
          } else widgets.delete(key);
        },
      },
    } as unknown as ExtensionContext;
    try {
      const before = [...render()];
      expect(before[0]).toBe("hello");
      for (const handler of handlers.get("session_start") ?? []) handler({ reason: "resume" }, ctx);
      expect(render()).not.toEqual(before);
      expect(render().join("\n")).toContain("hello");
      expect(repaints).toBe(1);
      expect(widgets.size).toBe(0);
    } finally {
      for (const handler of handlers.get("session_shutdown") ?? []) handler({}, ctx);
    }
  });

  test("does not use TUI factories in non-terminal modes", () => {
    let start: (event: unknown, ctx: ExtensionContext) => void = () => {};
    refreshTranscriptOnSessionStart({
      on(_event: string, handler: typeof start) {
        start = handler;
      },
    } as unknown as ExtensionAPI);
    for (const mode of ["rpc", "json", "print"] as const) {
      expect(() => start({}, { mode } as ExtensionContext)).not.toThrow();
    }
  });
});
