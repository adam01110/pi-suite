import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionFactory } from "../registry.js";

const BTW_MODEL_ENTRY_TYPE = "btw-model-override";

type EventHandler = (event: unknown, ctx: ExtensionContext) => unknown;
type EventRegistrar = (event: string, handler: EventHandler) => void;

export function suppressNotifications(
	factory: ExtensionFactory,
	prefixes: ReadonlySet<string>,
): ExtensionFactory {
	return async (pi) => {
		const originalOn = pi.on;
		const on = pi.on.bind(pi) as EventRegistrar;
		pi.on = ((event: string, handler: EventHandler) => {
			on(event, (payload, ctx) => {
				const notify = ctx.ui.notify.bind(ctx.ui);
				const ui = new Proxy(ctx.ui, {
					get(target, property, receiver) {
						if (property !== "notify")
							return Reflect.get(target, property, receiver);
						return (message: string, type?: "info" | "warning" | "error") => {
							if (![...prefixes].some((prefix) => message.startsWith(prefix)))
								notify(message, type);
						};
					},
				});
				const quietCtx = new Proxy(ctx, {
					get(target, property, receiver) {
						if (property === "ui") return ui;
						return Reflect.get(target, property, receiver);
					},
				});
				return handler(payload, quietCtx);
			});
		}) as ExtensionAPI["on"];

		try {
			await factory(pi);
		} finally {
			pi.on = originalOn;
		}
	};
}

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
