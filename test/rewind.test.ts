import { describe, expect, mock, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

mock.module("pi-rewind/src/index.js", () => ({
	default: async () => {},
}));
mock.module("pi-rewind/src/core.js", () => ({
	IGNORED_DIR_NAMES: new Set<string>(["builtin"]),
}));

const { default: rewindAdapter } = await import("../src/glue/rewind.js");
const { IGNORED_DIR_NAMES } = await import("pi-rewind/src/core.js");

describe("rewind adapter", () => {
	test("adds the extra ignored directories to the upstream set", async () => {
		await rewindAdapter({} as ExtensionAPI);

		const ignored = IGNORED_DIR_NAMES as Set<string>;
		for (const name of ["target", "vendor", ".direnv"])
			expect(ignored.has(name)).toBe(true);
	});

	test("preserves the upstream built-in ignore entries", async () => {
		await rewindAdapter({} as ExtensionAPI);

		expect((IGNORED_DIR_NAMES as Set<string>).has("builtin")).toBe(true);
	});
});
