import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	applyAgentProfiles,
	applyProfileToFile,
} from "../src/glue/model-profile.js";

const TOKEN_FILE = `---
description: Implement and verify code changes
display_name: Coding
extensions: true
isolated: false
model: coder
prompt_mode: append
---

# coding
`;

const STATELESS_FILE = `---
description: Locate code
tools: read, bash
model: fast
---
`;

function makeAgentDir(): string {
	const dir = join(
		tmpdir(),
		`pi-suite-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "coding.md"), TOKEN_FILE);
	writeFileSync(join(dir, "explore.md"), STATELESS_FILE);
	return dir;
}

describe("model profile agent rewrites", () => {
	test("rewrites a token to a concrete model and thinking level", () => {
		const lines = TOKEN_FILE.split("\n");
		const first = applyProfileToFile(
			lines,
			"coder",
			{ model: "openai-codex/gpt-5.6-sol", thinking: "medium" },
			undefined,
		);

		expect(first.changed).toBe(true);
		expect(first.next).toEqual({
			model: "openai-codex/gpt-5.6-sol",
			thinking: "medium",
		});
		const text = lines.join("\n");
		expect(text).toContain("model: openai-codex/gpt-5.6-sol");
		expect(text).toContain("thinking: medium");
		expect(text).not.toContain("model: coder");
	});

	test("drops the model line and rewrites thinking for session-inheriting entries", () => {
		const lines = TOKEN_FILE.split("\n");
		const applied = { model: "openai-codex/gpt-5.6-sol", thinking: "medium" };
		applyProfileToFile(
			lines,
			"coder",
			{ model: "openai-codex/gpt-5.6-sol", thinking: "medium" },
			undefined,
		);

		const second = applyProfileToFile(
			lines,
			"coder",
			{ thinking: "high" },
			applied,
		);

		expect(second.changed).toBe(true);
		expect(second.next).toEqual({ model: null, thinking: "high" });
		const text = lines.join("\n");
		expect(text).not.toContain("model: openai-codex/gpt-5.6-sol");
		expect(text).toContain("thinking: high");
	});

	test("never touches hand-pinned thinking levels", () => {
		const lines = [
			"---",
			"description: x",
			"model: coder",
			"thinking: low",
			"---",
		];
		const result = applyProfileToFile(
			lines,
			"coder",
			{ thinking: "high" },
			undefined,
		);

		// Model line still drops (thinking-only entry inherits the session
		// model), but the hand-pinned thinking level must survive untouched.
		expect(lines).toContain("thinking: low");
		expect(result.changed).toBe(true);
		expect(result.next.thinking).toBeUndefined();
	});

	test("skips files without frontmatter", () => {
		const lines = ["# notes", "model: coder"];
		const result = applyProfileToFile(
			lines,
			"coder",
			{ model: "x" },
			undefined,
		);
		expect(result.changed).toBe(false);
	});
});

describe("applyAgentProfiles", () => {
	test("round-trips codex -> opencode-go -> codex across deployed files", async () => {
		const dir = makeAgentDir();
		try {
			const config = {
				"openai-codex": {
					coder: { model: "openai-codex/gpt-5.6-sol", thinking: "medium" },
					fast: { model: "openai-codex/gpt-5.6-luna", thinking: "medium" },
				},
				"opencode-go/glm-5.3-flash": {
					coder: { thinking: "high" },
					fast: { thinking: "low" },
				},
			};

			await applyAgentProfiles(
				{ provider: "openai-codex", id: "gpt-5.6-sol" },
				{ agentDir: dir, config },
			);
			let coding = readFileSync(join(dir, "coding.md"), "utf8");
			expect(coding).toContain("model: openai-codex/gpt-5.6-sol");
			expect(coding).toContain("thinking: medium");
			let explore = readFileSync(join(dir, "explore.md"), "utf8");
			expect(explore).toContain("model: openai-codex/gpt-5.6-luna");

			await applyAgentProfiles(
				{ provider: "opencode-go", id: "glm-5.3-flash" },
				{ agentDir: dir, config },
			);
			coding = readFileSync(join(dir, "coding.md"), "utf8");
			expect(coding).not.toContain("model: openai-codex/gpt-5.6-sol");
			expect(coding).toContain("thinking: high");
			explore = readFileSync(join(dir, "explore.md"), "utf8");
			expect(explore).not.toContain("model: openai-codex/gpt-5.6-luna");
			expect(explore).toContain("thinking: low");
			expect(existsSync(join(dir, "pi-suite-profile-state.json"))).toBe(true);

			await applyAgentProfiles(
				{ provider: "openai-codex", id: "gpt-5.6-sol" },
				{ agentDir: dir, config },
			);
			coding = readFileSync(join(dir, "coding.md"), "utf8");
			expect(coding).toContain("model: openai-codex/gpt-5.6-sol");
			expect(coding).toContain("thinking: medium");
			explore = readFileSync(join(dir, "explore.md"), "utf8");
			expect(explore).toContain("model: openai-codex/gpt-5.6-luna");
			expect(explore).toContain("thinking: medium");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
