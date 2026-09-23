import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	batchValidationText,
	collapsedLspResult,
	diagnosticsDisplayText,
	installSessionSafeUserMessageRenderer,
	latestDiagnosticsResult,
	setSettingsGenerationSource,
} from "../src/glue/tool-renderer.js";

const CHECK_EMOJI = "\u2705";
const WARNING_EMOJI = "\u26a0\ufe0f";

describe("LSP diagnostics renderer compatibility", () => {
	test("removes the redundant heading and status marker from display text", () => {
		expect(
			diagnosticsDisplayText(
				`LSP diagnostics:\n\n${CHECK_EMOJI} no diagnostics`,
			),
		).toBe("no diagnostics");
	});

	test("keeps a single server diagnostic on one line", () => {
		expect(
			diagnosticsDisplayText(
				`LSP diagnostics:\n\n${WARNING_EMOJI} nixd:\nmodules/cli/bun.nix:6:5 - warning`,
			),
		).toBe("nixd: modules/cli/bun.nix:6:5 - warning");
	});

	test("removes emoji status markers from tool results", () => {
		expect(
			latestDiagnosticsResult([
				{
					type: "text",
					text: `LSP diagnostics:\n\n${CHECK_EMOJI} no diagnostics`,
				},
			]),
		).toEqual([{ type: "text", text: "LSP diagnostics:\n\nno diagnostics" }]);
	});

	test("replaces stale diagnostics with the refreshed result", () => {
		expect(
			latestDiagnosticsResult([
				{
					type: "text",
					text: `LSP diagnostics:\n\n${CHECK_EMOJI} no diagnostics`,
				},
				{
					type: "text",
					text: `LSP diagnostics:\n\n${WARNING_EMOJI} nixd: unused argument`,
				},
			]),
		).toEqual([
			{
				type: "text",
				text: "LSP diagnostics:\n\nnixd: unused argument",
			},
		]);
	});
});

describe("LSP result truncation", () => {
	const fiveLines = "one\ntwo\nthree\nfour\nfive";

	test("collapses long results to four lines plus a remainder count", () => {
		expect(collapsedLspResult(fiveLines, false)).toEqual({
			text: "one\ntwo\nthree\nfour",
			more: 1,
		});
	});

	test("keeps exactly-four-line results fully visible when collapsed", () => {
		expect(collapsedLspResult("one\ntwo\nthree\nfour", false)).toEqual({
			text: "one\ntwo\nthree\nfour",
			more: 0,
		});
	});

	test("expansion shows every line without a remainder", () => {
		expect(collapsedLspResult(fiveLines, true)).toEqual({
			text: fiveLines,
			more: 0,
		});
	});
});

describe("tool batch validation renderer compatibility", () => {
	test("summarizes an unsupported inner tool without repeating arguments", () => {
		const raw = `Validation failed for tool "tool_batch":
  - calls.3.tool: must be equal to one of the allowed values

Received arguments:
${JSON.stringify(
	{
		calls: [
			{ tool: "find" },
			{ tool: "find" },
			{ tool: "bash" },
			{ tool: "lsp_diagnostics" },
		],
	},
	null,
	2,
)}`;

		expect(batchValidationText(raw)).toBe(
			"Call 4 uses unsupported tool lsp_diagnostics.\nAllowed tools: read, grep, find, ls, bash.",
		);
	});
});

type InstallUserMessageRendererArgs = Parameters<
	typeof installSessionSafeUserMessageRenderer
>;

const RENDERER_CONFIG_ID = "@vanillagreen/pi-tool-renderer";

function rendererConfig(toolChrome: string): unknown {
	return {
		kendex: {
			extensionManager: { config: { [RENDERER_CONFIG_ID]: { toolChrome } } },
		},
	};
}

describe("user message renderer frame reuse", () => {
	interface Harness {
		component: { render: (width: number) => string[]; text: string };
		calls: () => { border: number; raw: number };
	}

	function install(text: string): Harness {
		const handlers = new Map<string, (event: unknown, ctx: unknown) => void>();
		let border = 0;
		let raw = 0;
		class UserMessageComponent {
			text = text;
			render(width: number): string[] {
				return [`fallback:${width}`];
			}
		}
		installSessionSafeUserMessageRenderer(
			{
				on(event: string, handler: (event: unknown, ctx: unknown) => void) {
					handlers.set(event, handler);
					return () => {};
				},
			} as unknown as InstallUserMessageRendererArgs[0],
			UserMessageComponent,
			{
				renderRawUserMessageLines(_component, width) {
					raw += 1;
					return [`raw:${width}`];
				},
				renderUserMessageBorder(lines, width) {
					border += 1;
					return [`border:${width}`, ...lines];
				},
			},
		);
		handlers.get("session_start")?.(
			{},
			{ cwd: "/tmp", hasUI: true, mode: "tui", ui: { theme: {} } },
		);
		return {
			calls: () => ({ border, raw }),
			component: new UserMessageComponent(),
		};
	}

	test("reuses a frame while width, text, theme and settings hold", () => {
		setSettingsGenerationSource(() => 3);
		const harness = install("hello");
		const first = harness.component.render(40);
		expect(harness.component.render(40)).toBe(first);
		expect(harness.calls()).toEqual({ border: 1, raw: 1 });
	});

	test("rebuilds the frame when the width or the settings change", () => {
		let generation = 0;
		setSettingsGenerationSource(() => generation);
		const harness = install("hello");
		harness.component.render(40);
		harness.component.render(41);
		expect(harness.calls()).toEqual({ border: 2, raw: 2 });
		generation = 1;
		harness.component.render(41);
		expect(harness.calls()).toEqual({ border: 3, raw: 3 });
	});
});

describe("vendored tool renderer frame caching", () => {
	test("caches settings reads until the settings file changes", async () => {
		const settings = await import(
			"@vanillagreen/pi-tool-renderer/extensions/tool-renderer/settings.js"
		);
		if (typeof settings.currentSettingsGeneration !== "function")
			throw new Error(
				"patches/pi-tool-renderer-frame-cache.patch is not applied to node_modules",
			);

		const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		const dir = mkdtempSync(join(tmpdir(), "pi-suite-settings-"));
		try {
			process.env.PI_CODING_AGENT_DIR = dir;
			const settingsPath = join(dir, "settings.json");
			const cwd = join(dir, "project");
			writeFileSync(settingsPath, JSON.stringify(rendererConfig("off")));
			expect(
				settings.readPackageConfig(RENDERER_CONFIG_ID, cwd).toolChrome,
			).toBe("off");

			const generation = settings.currentSettingsGeneration();
			settings.readPackageConfig(RENDERER_CONFIG_ID, cwd);
			expect(settings.currentSettingsGeneration()).toBe(generation);

			writeFileSync(settingsPath, JSON.stringify(rendererConfig("outlines")));
			await Bun.sleep(300);
			expect(
				settings.readPackageConfig(RENDERER_CONFIG_ID, cwd).toolChrome,
			).toBe("outlines");
			expect(settings.currentSettingsGeneration()).toBeGreaterThan(generation);
		} finally {
			if (previousAgentDir === undefined)
				delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
			rmSync(dir, { force: true, recursive: true });
		}
	});

	test("reuses chrome lines while the rendered content is unchanged", async () => {
		const chrome = await import(
			"@vanillagreen/pi-tool-renderer/extensions/tool-renderer/chrome.js"
		);
		if (typeof chrome.__test?.renderToolChromeLines !== "function")
			throw new Error(
				"patches/pi-tool-renderer-frame-cache.patch is not applied to node_modules",
			);

		const component = {
			cwd: process.cwd(),
			toolCallId: "call-1",
			toolName: "read",
		};
		const first = chrome.__test.renderToolChromeLines(
			component,
			["alpha", "beta"],
			80,
		);
		const second = chrome.__test.renderToolChromeLines(
			component,
			["alpha", "beta"],
			80,
		);
		expect(second).toBe(first);
		const changed = chrome.__test.renderToolChromeLines(
			component,
			["alpha", "gamma"],
			80,
		);
		expect(changed).not.toBe(first);
	});
});
