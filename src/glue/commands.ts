import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionFactory } from "../registry.js";

const BTW_MODEL_ENTRY_TYPE = "btw-model-override";

type CommandDefinition = Parameters<ExtensionAPI["registerCommand"]>[1];

export function suppressCommands(
	factory: ExtensionFactory,
	names: ReadonlySet<string>,
): ExtensionFactory {
	return async (pi) => {
		const register = pi.registerCommand.bind(pi);
		pi.registerCommand = ((name, definition) => {
			if (!names.has(name)) register(name, definition);
		}) as ExtensionAPI["registerCommand"];

		try {
			await factory(pi);
		} finally {
			pi.registerCommand = register as ExtensionAPI["registerCommand"];
		}
	};
}

function hasFixedBtwModel(
	ctx: ExtensionContext,
	model: { id: string; provider: string },
): boolean {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index] as {
			type?: string;
			customType?: string;
			data?: {
				action?: string;
				id?: string;
				provider?: string;
			};
		};
		if (entry.type !== "custom" || entry.customType !== BTW_MODEL_ENTRY_TYPE)
			continue;
		return (
			entry.data?.action === "set" &&
			entry.data.provider === model.provider &&
			entry.data.id === model.id
		);
	}
	return false;
}

export function fixedBtwModel(
	factory: ExtensionFactory,
	modelArgs: string,
): ExtensionFactory {
	const [provider, id, api, ...extra] = modelArgs.trim().split(/\s+/);
	if (!provider || !id || !api || extra.length > 0)
		throw new Error(
			"BTW model must contain exactly: <provider> <model> <api>",
		);
	const model = { api, id, provider };

	return async (pi) => {
		const register = pi.registerCommand.bind(pi);
		let modelCommand: CommandDefinition | undefined;
		pi.registerCommand = ((name, definition) => {
			if (name === "btw:model") {
				modelCommand = definition;
				return;
			}
			register(name, definition);
		}) as ExtensionAPI["registerCommand"];

		try {
			await factory(pi);
		} finally {
			pi.registerCommand = register as ExtensionAPI["registerCommand"];
		}

		if (!modelCommand) throw new Error("pi-btw did not register /btw:model");
		const command = modelCommand;
		const ensureModel = async (_event: unknown, ctx: ExtensionContext) => {
			if (hasFixedBtwModel(ctx, model)) return;
			const quietUi = new Proxy(ctx.ui, {
				get(target, property, receiver) {
					if (property === "notify") return () => undefined;
					return Reflect.get(target, property, receiver);
				},
			});
			const quietCtx = new Proxy(ctx, {
				get(target, property, receiver) {
					if (property === "ui") return quietUi;
					return Reflect.get(target, property, receiver);
				},
			});
			await command.handler(
				modelArgs,
				quietCtx as Parameters<typeof command.handler>[1],
			);
		};
		pi.on("session_start", ensureModel);
		pi.on("session_tree", ensureModel);
	};
}
