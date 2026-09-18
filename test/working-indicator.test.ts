import { describe, expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import workingIndicator, {
	SPINNER_FRAMES,
	spinnerFrames,
} from "../src/glue/working-indicator.js";

type EventHandler = (
	event: unknown,
	ctx: ExtensionContext,
) => Promise<void> | void;

function setup() {
	const handlers: EventHandler[] = [];
	const calls: unknown[] = [];
	const pi = {
		on(name: string, registeredHandler: EventHandler) {
			if (name === "session_start") handlers.push(registeredHandler);
		},
	} as unknown as ExtensionAPI;
	const ctx = {
		hasUI: true,
		ui: {
			theme: {
				fg: (color: string, text: string) => `${color}:${text}`,
			},
			setWorkingIndicator: (options: unknown) => calls.push(options),
		},
	} as unknown as ExtensionContext;

	workingIndicator(pi);
	return { calls, ctx, handlers };
}

describe("spinnerFrames", () => {
	test("colors every braille frame", () => {
		const frames = spinnerFrames((text) => `<${text}>`);

		expect(frames).toHaveLength(SPINNER_FRAMES.length);
		expect(frames[0]).toBe("<⠋>");
		expect(frames.at(-1)).toBe("<⠏>");
	});

	test("keeps ten distinct single-cell frames", () => {
		expect(new Set(SPINNER_FRAMES).size).toBe(10);
		for (const frame of SPINNER_FRAMES) {
			expect(frame).toHaveLength(1);
			// Braille block range, not a dot or a nerd-font glyph.
			expect(frame.codePointAt(0)).toBeGreaterThanOrEqual(0x2800);
			expect(frame.codePointAt(0)).toBeLessThanOrEqual(0x28ff);
		}
	});
});

describe("working indicator", () => {
	test("applies the braille spinner on every session start", async () => {
		const { calls, ctx, handlers } = setup();

		for (const handler of handlers) await handler({}, ctx);

		expect(calls).toEqual([
			{
				frames: SPINNER_FRAMES.map((frame) => `accent:${frame}`),
				intervalMs: 80,
			},
		]);
	});

	test("does not configure the indicator without UI", async () => {
		const { calls, ctx, handlers } = setup();
		ctx.hasUI = false;

		for (const handler of handlers) await handler({}, ctx);

		expect(calls).toEqual([]);
	});
});
