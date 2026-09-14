import { describe, expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	addTpsSample,
	calculateTps,
	canUpdateTps,
	registerTpsCounter,
} from "../src/glue/tps-counter.js";

type EventHandler = (
	event: unknown,
	ctx: ExtensionContext,
) => Promise<void> | void;

function assistant(output: number) {
	return { role: "assistant", usage: { output } };
}

describe("TPS calculation", () => {
	test("calculates output tokens per second", () => {
		let samples = addTpsSample([], 0, 0);
		samples = addTpsSample(samples, 20, 1_000);
		samples = addTpsSample(samples, 60, 2_000);

		expect(calculateTps(samples)).toBe(30);
	});

	test("keeps only samples in the rolling window", () => {
		let samples = addTpsSample([], 0, 0, 3_000);
		samples = addTpsSample(samples, 20, 2_000, 3_000);
		samples = addTpsSample(samples, 80, 5_000, 3_000);

		expect(samples).toEqual([
			{ timestamp: 2_000, outputTokens: 20 },
			{ timestamp: 5_000, outputTokens: 80 },
		]);
		expect(calculateTps(samples)).toBe(20);
	});

	test("resets samples when cumulative usage decreases", () => {
		const samples = addTpsSample(
			[{ timestamp: 1_000, outputTokens: 40 }],
			2,
			2_000,
		);

		expect(samples).toEqual([{ timestamp: 2_000, outputTokens: 2 }]);
		expect(calculateTps(samples)).toBeUndefined();
	});

	test("throttles status updates", () => {
		expect(canUpdateTps(undefined, 100)).toBe(true);
		expect(canUpdateTps(100, 349)).toBe(false);
		expect(canUpdateTps(100, 350)).toBe(true);
	});
});

describe("TPS footer status", () => {
	test("publishes a muted throttled rate and clears it at message end", () => {
		const handlers = new Map<string, EventHandler>();
		const statuses: Array<[string, string | undefined]> = [];
		const pi = {
			on(name: string, handler: EventHandler) {
				handlers.set(name, handler);
			},
		} as unknown as ExtensionAPI;
		const ctx = {
			hasUI: true,
			ui: {
				setStatus: (key: string, text: string | undefined) =>
					statuses.push([key, text]),
				theme: { fg: (color: string, text: string) => `${color}:${text}` },
			},
		} as unknown as ExtensionContext;
		let timestamp = 0;
		registerTpsCounter(pi, () => timestamp);

		handlers.get("message_start")?.(
			{ type: "message_start", message: assistant(0) },
			ctx,
		);
		timestamp = 100;
		handlers.get("message_update")?.(
			{
				type: "message_update",
				assistantMessageEvent: {
					type: "text_delta",
					partial: assistant(10),
				},
			},
			ctx,
		);
		timestamp = 200;
		handlers.get("message_update")?.(
			{
				type: "message_update",
				assistantMessageEvent: {
					type: "thinking_delta",
					partial: assistant(20),
				},
			},
			ctx,
		);
		timestamp = 350;
		handlers.get("message_update")?.(
			{
				type: "message_update",
				assistantMessageEvent: {
					type: "toolcall_delta",
					partial: assistant(35),
				},
			},
			ctx,
		);
		handlers.get("message_end")?.(
			{ type: "message_end", message: assistant(35) },
			ctx,
		);

		expect(statuses).toEqual([
			["tps", undefined],
			["tps", "muted:\uf0e7 100 t/s"],
			["tps", "muted:\uf0e7 100 t/s"],
			["tps", undefined],
		]);
	});

	test("does not touch the UI when unavailable", () => {
		const handlers = new Map<string, EventHandler>();
		const pi = {
			on(name: string, handler: EventHandler) {
				handlers.set(name, handler);
			},
		} as unknown as ExtensionAPI;
		const ctx = { hasUI: false } as ExtensionContext;
		let timestamp = 0;
		registerTpsCounter(pi, () => timestamp);

		handlers.get("message_start")?.(
			{ type: "message_start", message: assistant(0) },
			ctx,
		);
		timestamp = 100;
		handlers.get("message_update")?.(
			{
				type: "message_update",
				assistantMessageEvent: {
					type: "text_delta",
					partial: assistant(10),
				},
			},
			ctx,
		);
		handlers.get("message_end")?.(
			{ type: "message_end", message: assistant(10) },
			ctx,
		);
	});
});
