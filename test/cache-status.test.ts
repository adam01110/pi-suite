import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import cacheStatusColor from "../src/glue/cache-status.js";

type EventHandler = (event: unknown, ctx: ExtensionContext) => Promise<void> | void;

describe("cache status colors", () => {
  test("styles configured statuses and restores setStatus", async () => {
    const handlers = new Map<string, EventHandler[]>();
    const statuses: Array<[string, string | undefined]> = [];
    const originalSetStatus = (key: string, text: string | undefined) => {
      statuses.push([key, text]);
    };
    const pi = {
      on(name: string, handler: EventHandler) {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      },
    } as unknown as ExtensionAPI;
    const ctx = {
      hasUI: true,
      ui: {
        setStatus: originalSetStatus,
        theme: { fg: (color: string, text: string) => `${color}:${text}` },
      },
    } as unknown as ExtensionContext;

    cacheStatusColor(pi);
    for (const handler of handlers.get("session_start") ?? []) await handler({}, ctx);
    for (const handler of handlers.get("session_start") ?? []) await handler({}, ctx);

    ctx.ui.setStatus("pi-cache-stats", "cache:1");
    ctx.ui.setStatus("qol-attachments", "images:2");
    ctx.ui.setStatus("other", "unchanged");
    ctx.ui.setStatus("qol-attachments", undefined);

    for (const handler of handlers.get("session_shutdown") ?? []) await handler({}, ctx);
    expect(ctx.ui.setStatus as unknown).toBe(originalSetStatus as unknown);
    ctx.ui.setStatus("qol-attachments", "images:3");

    expect(statuses).toEqual([
      ["pi-cache-stats", "dim:cache:1"],
      ["qol-attachments", "muted:images:2"],
      ["other", "unchanged"],
      ["qol-attachments", undefined],
      ["qol-attachments", "images:3"],
    ]);
  });
});
