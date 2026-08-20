import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	formatSuiteStatus,
	loadModules,
	parseDisabledModules,
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
});
