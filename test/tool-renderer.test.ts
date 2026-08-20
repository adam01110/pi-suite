import { describe, expect, test } from "bun:test";
import {
	batchValidationText,
	diagnosticsDisplayText,
	latestDiagnosticsResult,
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
