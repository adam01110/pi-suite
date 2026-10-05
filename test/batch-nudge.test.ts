import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import batchNudge from "../src/glue/batch-nudge.js";

type ToolCall = {
	args?: Record<string, unknown>;
	id: string;
	name: string;
	parentToolCallId?: string;
};
type Result = { block: boolean; reason: string } | undefined;

type ToolCallHandler = (
	event: {
		input?: Record<string, unknown>;
		parentToolCallId?: string;
		toolCallId: string;
		toolName: string;
	},
	ctx: { sessionManager: { getBranch: () => unknown[] } },
) => Result;

interface Harness {
	block: (call: ToolCall) => Result;
	entry: (role: "assistant" | "user", calls?: ToolCall[]) => unknown;
}

let entryCounter = 0;

function setup(): Harness {
	const handlers = new Map<string, ToolCallHandler>();
	const pi = {
		on: (name: string, handler: ToolCallHandler) => {
			handlers.set(name, handler);
		},
	} as unknown as ExtensionAPI;
	batchNudge(pi);
	const handler = handlers.get("tool_call")!;

	const entries: unknown[] = [];
	const entry = (role: "assistant" | "user", calls?: ToolCall[]) => {
		entryCounter += 1;
		const message =
			role === "user"
				? { role, content: [{ type: "text", text: "hi" }] }
				: {
						role,
						content: (calls ?? []).map((call) => ({
							type: "toolCall",
							id: call.id,
							name: call.name,
							arguments: call.args ?? {},
						})),
					};
		const item = { id: `entry-${entryCounter}`, type: "message", message };
		entries.push(item);
		return item;
	};

	const block = (call: ToolCall) =>
		handler(
			{
				toolCallId: call.id,
				parentToolCallId: call.parentToolCallId,
				toolName: call.name,
				input: call.args ?? {},
			},
			{ sessionManager: { getBranch: () => entries } },
		);

	return { block, entry };
}

const solo = (name: string, id: string, args?: Record<string, unknown>) => [
	{ id, name, args },
];

describe("batch nudge", () => {
	test("allows the first solo lookup of a run", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", solo("read", "r1"));
		expect(h.block({ id: "r1", name: "read" })).toBeUndefined();
	});

	test("blocks the second consecutive solo lookup with the same tool", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", solo("read", "r1"));
		h.entry("assistant", solo("read", "r2"));
		const result = h.block({ id: "r2", name: "read" });
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("tool_batch");
		expect(result?.reason).toContain('{"calls": [{"tool": "read"');
	});

	test("blocks serial bash probes", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", solo("bash", "b1", { command: "ls" }));
		h.entry("assistant", solo("bash", "b2", { command: "pwd" }));
		const result = h.block({
			id: "b2",
			name: "bash",
			args: { command: "pwd" },
		});
		expect(result?.block).toBe(true);
	});

	test("blocks a chained bash command even as the first call of a run", () => {
		const h = setup();
		h.entry("user");
		const args = { command: "ls src && grep -rn nudge src" };
		h.entry("assistant", solo("bash", "b1", args));
		const result = h.block({ id: "b1", name: "bash", args });
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain('{"calls": [{"tool": "bash"');
		expect(result?.reason).toContain('"command": "ls src"');
	});

	test("blocks a chained bash command on re-issue instead of letting it run", () => {
		const h = setup();
		h.entry("user");
		const args = { command: "ls && pwd" };
		h.entry("assistant", solo("bash", "b1", args));
		expect(h.block({ id: "b1", name: "bash", args })?.block).toBe(true);
		h.entry("assistant", solo("bash", "b2", args));
		expect(h.block({ id: "b2", name: "bash", args })?.block).toBe(true);
	});

	test("lets the same chained command through after the block cap", () => {
		const h = setup();
		h.entry("user");
		const args = { command: "ls && pwd" };
		h.entry("assistant", solo("bash", "b1", args));
		expect(h.block({ id: "b1", name: "bash", args })?.block).toBe(true);
		h.entry("assistant", solo("bash", "b2", args));
		expect(h.block({ id: "b2", name: "bash", args })?.block).toBe(true);
		h.entry("assistant", solo("bash", "b3", args));
		expect(h.block({ id: "b3", name: "bash", args })).toBeUndefined();
	});

	test("counts chained blocks per run, not across a user turn", () => {
		const h = setup();
		h.entry("user");
		const args = { command: "ls && pwd" };
		h.entry("assistant", solo("bash", "b1", args));
		expect(h.block({ id: "b1", name: "bash", args })?.block).toBe(true);
		h.entry("user");
		h.entry("assistant", solo("bash", "b2", args));
		expect(h.block({ id: "b2", name: "bash", args })?.block).toBe(true);
	});

	test("blocks a newline-separated bash command", () => {
		const h = setup();
		h.entry("user");
		const args = { command: "ls\npwd" };
		h.entry("assistant", solo("bash", "b1", args));
		expect(h.block({ id: "b1", name: "bash", args })?.block).toBe(true);
	});

	test("allows a trailing newline", () => {
		const h = setup();
		h.entry("user");
		const args = { command: "rg -n nudge src\n" };
		h.entry("assistant", solo("bash", "b1", args));
		expect(h.block({ id: "b1", name: "bash", args })).toBeUndefined();
	});

	test("allows a backslash line continuation", () => {
		const h = setup();
		h.entry("user");
		const args = { command: "rg -n nudge \\\n  src" };
		h.entry("assistant", solo("bash", "b1", args));
		expect(h.block({ id: "b1", name: "bash", args })).toBeUndefined();
	});

	test("blocks chained bash nested in codemode without parsing the script", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", solo("codemode", "cm1", { code: "dynamic script" }));
		const result = h.block({
			id: "cm1/1",
			parentToolCallId: "cm1",
			name: "bash",
			args: { command: "ls && pwd" },
		});
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain(
			'{"tool": "bash", "args": {"command": "ls"}}',
		);
	});

	test("blocks chained bash at deeper nesting levels", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", solo("codemode", "cm1"));
		expect(
			h.block({
				id: "cm1/1/1",
				parentToolCallId: "cm1/1",
				name: "bash",
				args: { command: "pwd || ls" },
			})?.block,
		).toBe(true);
	});

	test("allows single commands and sibling probes nested in codemode", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", solo("read", "r1"));
		h.entry("assistant", solo("codemode", "cm1"));
		for (const command of ["ls", "pwd"]) {
			expect(
				h.block({
					id: `cm1/${command}`,
					parentToolCallId: "cm1",
					name: "bash",
					args: { command },
				}),
			).toBeUndefined();
		}
		expect(
			h.block({
				id: "cm1/3",
				parentToolCallId: "cm1",
				name: "read",
				args: { path: "a" },
			}),
		).toBeUndefined();
	});

	test("allows a single bash command with no chain", () => {
		const h = setup();
		h.entry("user");
		const args = { command: "rg -n nudge src" };
		h.entry("assistant", solo("bash", "b1", args));
		expect(h.block({ id: "b1", name: "bash", args })).toBeUndefined();
	});

	test("ignores separators inside quotes", () => {
		const h = setup();
		h.entry("user");
		const args = {
			command: "rg -n nudge src | awk '{print $1; print $2}'",
		};
		h.entry("assistant", solo("bash", "b1", args));
		expect(h.block({ id: "b1", name: "bash", args })).toBeUndefined();
	});

	test("allows the re-issued call but nudges the next probe again", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", solo("read", "r1"));
		h.entry("assistant", solo("read", "r2"));
		expect(h.block({ id: "r2", name: "read" })?.block).toBe(true);
		h.entry("assistant", solo("read", "r2b"));
		expect(h.block({ id: "r2b", name: "read" })).toBeUndefined();
		h.entry("assistant", solo("read", "r3"));
		expect(h.block({ id: "r3", name: "read" })?.block).toBe(true);
	});

	test("allows cross-tool chains (grep -> read)", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", solo("grep", "g1"));
		h.entry("assistant", solo("read", "r1"));
		expect(h.block({ id: "r1", name: "read" })).toBeUndefined();
	});

	test("allows a read after a solo bash probe", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", solo("bash", "b1", { command: "ls" }));
		h.entry("assistant", solo("read", "r1"));
		expect(h.block({ id: "r1", name: "read" })).toBeUndefined();
	});

	test("blocks separate parallel probe calls in one message", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", [
			{ id: "b1", name: "bash", args: { command: "ls" } },
			{ id: "b2", name: "bash", args: { command: "pwd" } },
		]);
		expect(
			h.block({ id: "b1", name: "bash", args: { command: "ls" } })?.block,
		).toBe(true);
	});

	test("allows a mixed message with a non-probe call", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", [
			{ id: "r1", name: "read" },
			{ id: "e1", name: "edit" },
		]);
		expect(h.block({ id: "r1", name: "read" })).toBeUndefined();
	});

	test("lets the message after a blocked one through", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", [
			{ id: "b1", name: "bash", args: { command: "ls" } },
			{ id: "b2", name: "bash", args: { command: "pwd" } },
		]);
		expect(
			h.block({ id: "b1", name: "bash", args: { command: "ls" } })?.block,
		).toBe(true);
		h.entry("assistant", [
			{ id: "b3", name: "bash", args: { command: "ls" } },
			{ id: "b4", name: "bash", args: { command: "pwd" } },
		]);
		expect(
			h.block({ id: "b3", name: "bash", args: { command: "ls" } }),
		).toBeUndefined();
	});

	test("treats tool_batch as batching and resets the run", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", solo("read", "r1"));
		h.entry("assistant", [
			{
				id: "tb1",
				name: "tool_batch",
				args: { calls: [{ tool: "read", args: { path: "a" } }] },
			},
		]);
		expect(h.block({ id: "tb1", name: "tool_batch" })).toBeUndefined();
		h.entry("assistant", solo("read", "r2"));
		expect(h.block({ id: "r2", name: "read" })).toBeUndefined();
		h.entry("assistant", solo("read", "r3"));
		expect(h.block({ id: "r3", name: "read" })?.block).toBe(true);
	});

	test("treats codemode as batching and resets the run", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", solo("read", "r1"));
		h.entry("assistant", [
			{
				id: "cm1",
				name: "codemode",
				args: {
					code: 'text(await Promise.allSettled([tools.read({path: "a"}), tools.grep({pattern: "b"})]))',
				},
			},
		]);
		expect(h.block({ id: "cm1", name: "codemode" })).toBeUndefined();
		h.entry("assistant", solo("read", "r4"));
		expect(h.block({ id: "r4", name: "read" })).toBeUndefined();
		h.entry("assistant", solo("read", "r5"));
		expect(h.block({ id: "r5", name: "read" })?.block).toBe(true);
	});

	test("does not inspect arbitrary codemode source for probe counts", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", solo("read", "r1"));
		h.entry(
			"assistant",
			solo("codemode", "cm1", {
				code: 'const f = tools.read; text(await f({path: "a"}))',
			}),
		);
		expect(h.block({ id: "cm1", name: "codemode" })).toBeUndefined();
		h.entry("assistant", solo("read", "r2"));
		expect(h.block({ id: "r2", name: "read" })).toBeUndefined();
	});

	test("allows solo calls of non-probe tools and resets the run", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", solo("read", "r1"));
		h.entry("assistant", solo("edit", "e1"));
		expect(h.block({ id: "e1", name: "edit" })).toBeUndefined();
		h.entry("assistant", solo("read", "r2"));
		expect(h.block({ id: "r2", name: "read" })).toBeUndefined();
	});

	test("a user turn resets suppression", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", solo("read", "r1"));
		h.entry("assistant", solo("read", "r2"));
		expect(h.block({ id: "r2", name: "read" })?.block).toBe(true);
		h.entry("user");
		h.entry("assistant", solo("read", "r3"));
		expect(h.block({ id: "r3", name: "read" })).toBeUndefined();
		h.entry("assistant", solo("read", "r4"));
		expect(h.block({ id: "r4", name: "read" })?.block).toBe(true);
	});
});
