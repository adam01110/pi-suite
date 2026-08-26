import { afterAll, describe, expect, test } from "bun:test";
import {
	executeCode,
	shutdownSandbox,
} from "../src/vendor/codemode/sandbox.js";
import type { ToolBindings } from "../src/vendor/codemode/tool-bindings.js";
import { initTypeChecker } from "../src/vendor/codemode/type-checker.js";
import {
	generateBuiltinTypeDefs,
	generateMcpServerTypeDefs,
} from "../src/vendor/codemode/type-generator.js";

initTypeChecker();
afterAll(shutdownSandbox);

describe("code mode", () => {
	test("type-checks and executes a tool call", async () => {
		const tools: ToolBindings = {
			async read() {
				return "ok";
			},
			async write() {},
			async edit() {
				return "";
			},
			async search_tools() {
				return "";
			},
			async describe_tools() {
				return "";
			},
			progress() {},
		};
		const typeDefinitions = `${generateBuiltinTypeDefs()}\n${generateMcpServerTypeDefs([])}`;

		const result = await executeCode(
			'return await tools.read({ path: "example.txt" });',
			typeDefinitions,
			tools,
		);

		expect(result.success).toBe(true);
		expect(result.returnValue).toBe("ok");
	});
});
