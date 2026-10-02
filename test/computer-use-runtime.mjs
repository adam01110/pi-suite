import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline";

const environment = {
	PATH: "/nonexistent",
	HOME: process.env.TMPDIR ?? "/tmp",
};
const [launcher, bundled] = process.argv.slice(2);
assert.equal(realpathSync(launcher), realpathSync(bundled));
function verifyAccessibility(report) {
	for (const [name, probe] of Object.entries(report.accessibility)) {
		assert.doesNotMatch(
			probe.detail,
			/No such file or directory \(os error 2\)/,
			name,
		);
	}
	for (const name of ["toolkit_accessibility", "screen_reader_enabled"]) {
		assert.doesNotMatch(
			report.accessibility[name].detail,
			/No such schema|No schemas installed/,
		);
	}
	assert.equal(report.readiness.can_register_mcp_tools, true);
}
for (const executable of [launcher, bundled]) {
	const result = spawnSync(executable, ["doctor"], {
		env: environment,
		encoding: "utf8",
		timeout: 60000,
		maxBuffer: 4 * 1024 * 1024,
	});
	assert.ifError(result.error);
	assert.equal(result.status, 0, result.stderr);
	verifyAccessibility(JSON.parse(result.stdout));
	console.log(
		`${executable}: doctor resolves accessibility commands and schemas without host PATH`,
	);
}

const child = spawn(launcher, ["mcp"], {
	env: environment,
	stdio: ["pipe", "pipe", "inherit"],
});
const lines = createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 0;
lines.on("line", (line) => {
	const response = JSON.parse(line);
	pending.get(response.id)?.(response);
	pending.delete(response.id);
});
function request(method, params) {
	const id = ++nextId;
	return new Promise((resolve) => {
		pending.set(id, resolve);
		child.stdin.write(
			`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
		);
	});
}
const timeout = setTimeout(() => {
	child.kill("SIGKILL");
	console.error("MCP runtime check timed out");
	process.exitCode = 1;
}, 60000);
try {
	const initialized = await request("initialize", {
		protocolVersion: "2024-11-05",
		capabilities: {},
		clientInfo: { name: "pi-suite-runtime-check", version: "1" },
	});
	assert.equal(initialized.error, undefined);
	child.stdin.write(
		`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
	);
	const response = await request("tools/call", {
		name: "doctor",
		arguments: {},
	});
	assert.equal(response.error, undefined);
	assert.notEqual(response.result.isError, true);
	const text = response.result.content.find(
		(item) => item.type === "text",
	).text;
	verifyAccessibility(JSON.parse(text));
	console.log(
		`${launcher}: MCP initialize and doctor succeed without host PATH`,
	);
} finally {
	clearTimeout(timeout);
	lines.close();
	child.stdin.end();
	child.kill();
}
