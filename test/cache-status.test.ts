import { describe, expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import cacheStatusColor from "../src/glue/cache-status.js";

type EventHandler = (
	event: unknown,
	ctx: ExtensionContext,
) => Promise<void> | void;

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
		for (const handler of handlers.get("session_start") ?? [])
			await handler({}, ctx);
		for (const handler of handlers.get("session_start") ?? [])
			await handler({}, ctx);

		ctx.ui.setStatus("pi-cache-stats", "cache:1");
		ctx.ui.setStatus("qol-attachments", "images:2");
		ctx.ui.setStatus("other", "unchanged");
		ctx.ui.setStatus("qol-attachments", undefined);

		for (const handler of handlers.get("session_shutdown") ?? [])
			await handler({}, ctx);
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

	test("attributes OpenCode Go stats and clears the previous provider on model switch", async () => {
		const handlers = new Map<string, EventHandler[]>();
		const statuses: Array<[string, string | undefined]> = [];
		const pi = {
			on(name: string, handler: EventHandler) {
				handlers.set(name, [...(handlers.get(name) ?? []), handler]);
			},
		} as unknown as ExtensionAPI;
		const ctx = {
			hasUI: true,
			model: { provider: "openai-codex" },
			ui: {
				setStatus: (key: string, text: string | undefined) => {
					statuses.push([key, text]);
				},
				theme: { fg: (color: string, text: string) => `${color}:${text}` },
			},
		} as unknown as ExtensionContext;
		const emit = async (name: string, event: unknown) => {
			for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
		};

		cacheStatusColor(pi);
		await emit("session_start", {});
		ctx.ui.setStatus(
			"pi-cache-stats",
			"· OpenAI cache 110/111·9.53M/9.68M 98.4%",
		);
		await emit("model_select", { model: { provider: "opencode-go" } });
		ctx.ui.setStatus("pi-cache-stats", "· OpenAI cache 2/3·0.02M/0.03M 66.7%");
		ctx.ui.setStatus("pi-cache-stats", "· GLM cache 1/2·0.01M/0.02M 50.0%");
		ctx.ui.setStatus(
			"pi-cache-stats",
			"· Cache Optimizer disabled · Kimi cache 0/0·0M/0M 0.0% ⚠️ compat",
		);
		await emit("model_select", { model: { provider: "anthropic" } });
		ctx.ui.setStatus("pi-cache-stats", "· Claude cache 4/5·0.04M/0.05M 80.0%");
		await emit("session_shutdown", {});

		expect(statuses).toEqual([
			["pi-cache-stats", "dim:· OpenAI cache 110/111·9.53M/9.68M 98.4%"],
			["pi-cache-stats", undefined],
			[
				"pi-cache-stats",
				"dim:· OpenCode Go cache (OpenAI) 2/3·0.02M/0.03M 66.7%",
			],
			["pi-cache-stats", "dim:· OpenCode Go cache (GLM) 1/2·0.01M/0.02M 50.0%"],
			[
				"pi-cache-stats",
				"dim:· Cache Optimizer disabled · OpenCode Go cache (Kimi) 0/0·0M/0M 0.0% ⚠️ compat",
			],
			["pi-cache-stats", undefined],
			["pi-cache-stats", "dim:· Claude cache 4/5·0.04M/0.05M 80.0%"],
		]);
	});
});
