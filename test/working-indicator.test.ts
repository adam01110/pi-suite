import { describe, expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionContext,
	WorkingIndicatorOptions,
} from "@earendil-works/pi-coding-agent";
import workingIndicator, {
	gradientFrames,
	parseTruecolor,
} from "../src/glue/working-indicator.js";

type EventHandler = (
	event: unknown,
	ctx: ExtensionContext,
) => Promise<void> | void;

const esc = String.fromCharCode(27);
const fgTruecolor = (r: number, g: number, b: number) =>
	`${esc}[38;2;${r};${g};${b}m`;
const fg256 = (n: number) => `${esc}[38;5;${n}m`;

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
			theme: {
				fg: (color: string, text: string) => `${color}:${text}`,
				getFgAnsi: (color: string) =>
					color === "accent" ? fgTruecolor(88, 44, 130) : fgTruecolor(7, 7, 7),
				getColorMode: () => "truecolor",
			},
			setWorkingIndicator: (options: WorkingIndicatorOptions) =>
				calls.push(options),
		},
	} as unknown as ExtensionContext;

	workingIndicator(pi);
	return { calls, ctx, getHandler: () => handler };
}

describe("parseTruecolor", () => {
	test("parses r;g;b from a foreground truecolor escape", () => {
		expect(parseTruecolor(fgTruecolor(88, 44, 130))).toEqual({
			r: 88,
			g: 44,
			b: 130,
		});
	});

	test("rejects non-truecolor escapes", () => {
		expect(parseTruecolor(fg256(196))).toBeUndefined();
		expect(parseTruecolor("accent")).toBeUndefined();
	});
});

describe("gradientFrames", () => {
	test("pings dim to accent and back without duplicating the endpoints", () => {
		const frames = gradientFrames(
			{ r: 0, g: 0, b: 0 },
			{ r: 100, g: 100, b: 100 },
		);
		expect(frames).toHaveLength(10);
		expect(frames[0]).toContain("0;0;0m");
		expect(frames[5]).toContain("100;100;100m");
		expect(frames[6]).not.toContain("100;100;100m");
		expect(frames[9]).toContain("10;10;10m");
	});

	test("keeps the dot visible in every frame", () => {
		for (const frame of gradientFrames(
			{ r: 1, g: 2, b: 3 },
			{ r: 4, g: 5, b: 6 },
		)) {
			expect(frame).toContain("●");
		}
	});
});

describe("working indicator", () => {
	test("applies the gradient pulse on every session start", async () => {
		const { calls, ctx, getHandler } = setup();
		const handler = getHandler();

		expect(handler).toBeDefined();
		await handler?.({}, ctx);
		await handler?.({}, ctx);

		const frames = gradientFrames(
			{ r: 7, g: 7, b: 7 },
			{ r: 88, g: 44, b: 130 },
		);
		expect(calls).toEqual([
			{ frames, intervalMs: 120 },
			{ frames, intervalMs: 120 },
		]);
	});

	test("falls back to the two-frame flash without truecolor theme colors", async () => {
		const { calls, ctx, getHandler } = setup();
		const theme = (ctx.ui as any).theme;
		theme.getFgAnsi = () => fg256(196);

		await getHandler()?.({}, ctx);

		expect(calls).toEqual([{ frames: ["accent:●", "dim:●"], intervalMs: 500 }]);
	});

	test("does not configure the indicator without UI", async () => {
		const { calls, ctx, getHandler } = setup();
		ctx.hasUI = false;

		await getHandler()?.({}, ctx);

		expect(calls).toEqual([]);
	});
});
