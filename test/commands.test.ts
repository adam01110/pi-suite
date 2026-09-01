import { describe, expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { fixedBtwModel, suppressCommands } from "../src/glue/commands.js";

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

	test("removes the BTW model command and fixes the session model", async () => {
		const registered: string[] = [];
		const handlers = new Map<string, EventHandler[]>();
		const branch: Array<Record<string, unknown>> = [];
		const modelArgs: string[] = [];
		const notifications: string[] = [];
		const pi = {
			on(name: string, handler: EventHandler) {
				handlers.set(name, [...(handlers.get(name) ?? []), handler]);
			},
			registerCommand(name: string) {
				registered.push(name);
			},
		} as unknown as ExtensionAPI;
		const ctx = {
			sessionManager: { getBranch: () => branch },
			ui: { notify: (message: string) => notifications.push(message) },
		} as unknown as ExtensionContext;

		await fixedBtwModel(
			async (api) => {
				api.registerCommand("btw", {} as never);
				api.registerCommand("btw:model", {
					handler: async (args: string, commandCtx: ExtensionContext) => {
						modelArgs.push(args);
						commandCtx.ui.notify("model override set");
						branch.push({
							customType: "btw-model-override",
							data: {
								action: "set",
								id: "side-model",
								provider: "side-provider",
							},
							type: "custom",
						});
					},
				} as never);
			},
			"side-provider side-model side-api",
		)(pi);

		for (const handler of handlers.get("session_start") ?? [])
			await handler({}, ctx);
		for (const handler of handlers.get("session_tree") ?? [])
			await handler({}, ctx);

		expect(registered).toEqual(["btw"]);
		expect(modelArgs).toEqual(["side-provider side-model side-api"]);
		expect(notifications).toEqual([]);
	});
});
