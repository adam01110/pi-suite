import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import batchNudge from "../src/glue/batch-nudge.js";

type ToolCallHandler = (
	event: { toolCallId: string; toolName?: string },
	ctx: { sessionManager: { getBranch: () => unknown[] } },
) => { block: boolean; reason: string } | undefined;

interface Harness {
	block: (toolCallId: string) => { block: boolean; reason: string } | undefined;
	entry: (
		role: "assistant" | "user",
		calls?: Array<{ id: string; name: string }>,
	) => unknown;
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
	const entry = (
		role: "assistant" | "user",
		calls?: Array<{ id: string; name: string }>,
	) => {
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
							arguments: {},
						})),
					};
		const item = { id: `entry-${entryCounter}`, type: "message", message };
		entries.push(item);
		return item;
	};

	const block = (toolCallId: string) =>
		handler({ toolCallId }, { sessionManager: { getBranch: () => entries } });

	return { block, entry };
}

const solo = (name: string, id: string) => [{ id, name }];

describe("batch nudge", () => {
	test("allows the first solo lookup of a run", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", solo("read", "r1"));
		expect(h.block("r1")).toBeUndefined();
	});

	test("blocks the second consecutive solo lookup with the same tool", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", solo("read", "r1"));
		h.entry("assistant", solo("read", "r2"));
		const result = h.block("r2");
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("tool_batch");
	});

	test("runs the re-issued call and stops nudging for the run", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", solo("read", "r1"));
		h.entry("assistant", solo("read", "r2"));
		expect(h.block("r2")?.block).toBe(true);
		h.entry("assistant", solo("read", "r2b")); // re-issue runs
		expect(h.block("r2b")).toBeUndefined();
		h.entry("assistant", solo("read", "r3"));
		expect(h.block("r3")).toBeUndefined();
	});

	test("allows cross-tool chains (grep -> read)", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", solo("grep", "g1"));
		h.entry("assistant", solo("read", "r1"));
		expect(h.block("r1")).toBeUndefined();
	});

	test("allows solo lookups after a solo bash call", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", solo("bash", "b1"));
		h.entry("assistant", solo("read", "r1"));
		expect(h.block("r1")).toBeUndefined();
	});

	test("allows and resets after a batched message", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", solo("read", "r1"));
		h.entry("assistant", [
			{ id: "r2", name: "read" },
			{ id: "r3", name: "grep" },
		]);
		expect(h.block("r2")).toBeUndefined();
		h.entry("assistant", solo("read", "r4"));
		expect(h.block("r4")).toBeUndefined();
		h.entry("assistant", solo("read", "r5"));
		expect(h.block("r5")?.block).toBe(true);
	});

	test("blocks repeated serial greps too", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", solo("grep", "g1"));
		h.entry("assistant", solo("grep", "g2"));
		expect(h.block("g2")?.block).toBe(true);
	});

	test("allows solo lookups of mutating or custom tools", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", solo("read", "r1"));
		h.entry("assistant", solo("edit", "e1"));
		expect(h.block("e1")).toBeUndefined();
	});

	test("a user turn resets suppression", () => {
		const h = setup();
		h.entry("user");
		h.entry("assistant", solo("read", "r1"));
		h.entry("assistant", solo("read", "r2")); // blocked
		h.entry("user");
		h.entry("assistant", solo("read", "r3"));
		expect(h.block("r3")).toBeUndefined();
		h.entry("assistant", solo("read", "r4"));
		expect(h.block("r4")?.block).toBe(true);
	});
});
