import { describe, expect, test } from "bun:test";
import {
	batchValidationText,
	collapsedLspResult,
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
