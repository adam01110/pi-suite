import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	formatSuiteStatus,
	loadModules,
	parseDisabledModules,
	statusNotifyLevel,
} from "../src/registry.js";

const pi = {} as ExtensionAPI;

describe("suite registry", () => {
	test("parses comma-separated disabled module IDs", () => {
		expect([...parseDisabledModules(" qol, lsp,,web-access ")]).toEqual([
			"qol",
			"lsp",
			"web-access",
		]);
	});

	test("loads sequentially and continues after optional failures", async () => {
		const calls: string[] = [];
		const results = await loadModules(
			pi,
			[
				{
					id: "first",
					optional: true,
					factory: async () => {
						calls.push("first:start");
						await Promise.resolve();
						calls.push("first:end");
					},
				},
				{
					id: "broken",
					optional: true,
					factory: () => {
						calls.push("broken");
						throw new Error("boom");
					},
				},
				{
					id: "last",
					optional: true,
					factory: () => {
						calls.push("last");
					},
				},
			],
			new Set(),
		);

		expect(calls).toEqual(["first:start", "first:end", "broken", "last"]);
		expect(results.map(({ id, state }) => ({ id, state }))).toEqual([
			{ id: "first", state: "loaded" },
			{ id: "broken", state: "failed" },
			{ id: "last", state: "loaded" },
		]);
		expect(formatSuiteStatus(results)).toContain("failed: broken (boom)");
	});

	test("does not invoke disabled modules", async () => {
		let called = false;
		const results = await loadModules(
			pi,
			[
				{
					id: "off",
					optional: true,
					factory: () => {
						called = true;
					},
				},
			],
			new Set(["off"]),
		);
		expect(called).toBe(false);
		expect(results).toEqual([{ id: "off", state: "disabled" }]);
	});

	test("rethrows and stops on a required module failure", async () => {
		let called = false;
		await expect(
			loadModules(
				pi,
				[
					{
						id: "required",
						factory: () => {
							throw new Error("boom");
						},
					},
					{
						id: "unreached",
						optional: true,
						factory: () => {
							called = true;
						},
					},
				],
				new Set(),
			),
		).rejects.toThrow("boom");
		expect(called).toBe(false);
	});

	test("reports non-Error failures with their string form", async () => {
		const results = await loadModules(
			pi,
			[
				{
					id: "string-thrown",
					optional: true,
					factory: () => {
						throw "not an error";
					},
				},
			],
			new Set(),
		);
		expect(results).toEqual([
			{ id: "string-thrown", state: "failed", error: "not an error" },
		]);
	});

	test("formats empty status sections as none", () => {
		const status = formatSuiteStatus([]);
		expect(status).toBe("loaded: none\ndisabled: none\nfailed: none");
	});

	test("warns on the suite command when any module failed", () => {
		expect(
			statusNotifyLevel([
				{ id: "first", state: "loaded" },
				{ id: "broken", state: "failed", error: "boom" },
			]),
		).toBe("warning");
	});

	test("keeps the suite command informational without failures", () => {
		// Disabled-only proves the check matches failures, not non-loaded states.
		expect(
			statusNotifyLevel([
				{ id: "first", state: "loaded" },
				{ id: "off", state: "disabled" },
			]),
		).toBe("info");
		expect(statusNotifyLevel([])).toBe("info");
	});
});
