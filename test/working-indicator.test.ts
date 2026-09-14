import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  WorkingIndicatorOptions,
} from "@earendil-works/pi-coding-agent";
import workingIndicator from "../src/glue/working-indicator.js";

type EventHandler = (event: unknown, ctx: ExtensionContext) => Promise<void> | void;

function setup() {
  let handler: EventHandler | undefined;
  const calls: WorkingIndicatorOptions[] = [];
  const pi = {
    on(name: string, registeredHandler: EventHandler) {
      if (name === "session_start") handler = registeredHandler;
    },
  } as unknown as ExtensionAPI;
  const ctx = {
    hasUI: true,
    ui: {
      theme: { fg: (color: string, text: string) => `${color}:${text}` },
      setWorkingIndicator: (options: WorkingIndicatorOptions) => calls.push(options),
    },
  } as unknown as ExtensionContext;

  workingIndicator(pi);
  return { calls, ctx, getHandler: () => handler };
}

describe("working indicator", () => {
  test("applies flashing accent and dim frames on every session start", async () => {
    const { calls, ctx, getHandler } = setup();
    const handler = getHandler();

    expect(handler).toBeDefined();
    await handler?.({}, ctx);
    await handler?.({}, ctx);

    expect(calls).toEqual([
      { frames: ["accent:●", "dim:●"], intervalMs: 500 },
      { frames: ["accent:●", "dim:●"], intervalMs: 500 },
    ]);
  });

  test("does not configure the indicator without UI", async () => {
    const { calls, ctx, getHandler } = setup();
    ctx.hasUI = false;

    await getHandler()?.({}, ctx);

    expect(calls).toEqual([]);
  });
});
