import { describe, expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	suppressCommands,
	suppressNotifications,
} from "../src/glue/commands.js";

type EventHandler = (
	event: unknown,
	ctx: ExtensionContext,
) => Promise<void> | void;

describe("suite command adapters", () => {
	test("suppresses selected commands and restores registration", async () => {
		const registered: string[] = [];
		const original = (name: string) => registered.push(name);
		const pi = { registerCommand: original } as unknown as ExtensionAPI;

		await suppressCommands(
			async (api) => {
				api.registerCommand("keep", {} as never);
				await Promise.resolve();
				api.registerCommand("remove", {} as never);
			},
			new Set(["remove"]),
		)(pi);
		pi.registerCommand("after", {} as never);

		expect(registered).toEqual(["keep", "after"]);
	});

	test("suppresses selected notifications and restores event registration", async () => {
		const notifications: string[] = [];
		const handlers = new Map<string, EventHandler[]>();
		const originalOn = (name: string, handler: EventHandler) => {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		};
		const pi = { on: originalOn } as unknown as ExtensionAPI;
		const ctx = {
			ui: { notify: (message: string) => notifications.push(message) },
		} as unknown as ExtensionContext;

		await suppressNotifications(
			async (api) => {
				api.on("session_start", (_event, eventCtx) => {
					eventCtx.ui.notify("ignore: unavailable", "error");
					eventCtx.ui.notify("keep", "warning");
					// Matches only under includes(); startsWith lets it through.
					eventCtx.ui.notify("docs mention ignore: syntax", "info");
				});
			},
			new Set(["ignore:"]),
		)(pi);

		expect(pi.on as unknown).toBe(originalOn as unknown);
		for (const handler of handlers.get("session_start") ?? [])
			await handler({}, ctx);
		expect(notifications).toEqual(["keep", "docs mention ignore: syntax"]);
	});
});
