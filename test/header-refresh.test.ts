import { describe, expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import headerRefresh from "../src/glue/header-refresh.js";

type Handler = (event: unknown, ctx: ExtensionContext) => Promise<void> | void;

function makeHarness() {
	const handlers = new Map<string, Handler[]>();
	const pi = {
		on: (name: string, handler: Handler) => {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
	} as unknown as ExtensionAPI;
	const fire = async (name: string, event: unknown, ctx: ExtensionContext) => {
		for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
	};
	return { pi, fire };
}

/** Mimics pi's setExtensionHeader: the factory runs synchronously on set. */
function makeUi() {
	const headers: Array<Record<string, unknown>> = [];
	const ui = {
		setHeader: (
			factory:
				| ((tui: unknown, theme: unknown) => Record<string, unknown>)
				| undefined,
		) => {
			headers.length = 0;
			if (factory) headers.push(factory({}, {}));
		},
	} as unknown as ExtensionContext["ui"];
	return { ui, headers };
}

function fakeHeader() {
	return {
		reapplies: 0,
		render: () => [],
		invalidate: () => {},
		reapply() {
			this.reapplies += 1;
		},
	};
}

const ctxOf = (ui: ExtensionContext["ui"]) =>
	({ mode: "tui", ui }) as unknown as ExtensionContext;

describe("header refresh", () => {
	test("reapplies the mounted header after a model switch", async () => {
		const { pi, fire } = makeHarness();
		const { ui, headers } = makeUi();
		headerRefresh(pi);

		await fire("session_start", { reason: "startup" }, ctxOf(ui));
		const header = fakeHeader();
		ui.setHeader(() => header as never);

		await fire("model_select", { type: "model_select", model: {} }, ctxOf(ui));
		expect((headers[0]?.reapplies as number) ?? 0).toBe(1);
	});

	test("keeps the header mounted without restarting it", async () => {
		const { pi, fire } = makeHarness();
		const { ui, headers } = makeUi();
		headerRefresh(pi);

		await fire("session_start", { reason: "startup" }, ctxOf(ui));
		let creations = 0;
		ui.setHeader(() => {
			creations += 1;
			return fakeHeader() as never;
		});
		await fire("model_select", { type: "model_select", model: {} }, ctxOf(ui));

		// reapply() refreshes in place: the component is not re-created.
		expect(creations).toBe(1);
		expect(headers.length).toBe(1);
	});

	test("does not double-wrap setHeader across session starts", async () => {
		const { pi, fire } = makeHarness();
		const { ui } = makeUi();
		headerRefresh(pi);

		await fire("session_start", { reason: "startup" }, ctxOf(ui));
		await fire("session_start", { reason: "reload" }, ctxOf(ui));
		ui.setHeader(() => fakeHeader() as never);

		await fire("model_select", { type: "model_select", model: {} }, ctxOf(ui));
		// One wrap means one reapply call per model_select, not two.
		const header = fakeHeader();
		ui.setHeader(() => header as never);
		await fire("model_select", { type: "model_select", model: {} }, ctxOf(ui));
		expect(header.reapplies).toBe(1);
	});

	test("is a no-op without a mounted custom header", async () => {
		const { pi, fire } = makeHarness();
		const { ui } = makeUi();
		headerRefresh(pi);
		await fire("session_start", { reason: "startup" }, ctxOf(ui));

		await expect(
			fire("model_select", { type: "model_select", model: {} }, ctxOf(ui)),
		).resolves.toBeUndefined();
	});

	test("ignores non-tui sessions", async () => {
		const { pi, fire } = makeHarness();
		const { ui, headers } = makeUi();
		headerRefresh(pi);

		const nonTui = { mode: "rpc", ui } as unknown as ExtensionContext;
		await fire("session_start", { reason: "startup" }, nonTui);
		ui.setHeader(() => fakeHeader() as never);
		await fire("model_select", { type: "model_select", model: {} }, ctxOf(ui));

		expect(headers[0]?.reapplies ?? 0).toBe(0);
	});
});
