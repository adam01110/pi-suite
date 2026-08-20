import type {
	ExtensionAPI,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";

export type AnyToolDefinition = ToolDefinition<any, any, any>;

export interface ToolTracker {
	get(name: string): AnyToolDefinition | undefined;
	registrationsSince(mark: number): AnyToolDefinition[];
	mark(): number;
	block(names: ReadonlySet<string>): () => void;
	restore(): void;
}

export function trackToolRegistrations(pi: ExtensionAPI): ToolTracker {
	const register = pi.registerTool.bind(pi);
	const definitions = new Map<string, AnyToolDefinition>();
	const registrations: AnyToolDefinition[] = [];
	let blocked = new Set<string>();

	pi.registerTool = ((definition: AnyToolDefinition) => {
		registrations.push(definition);
		if (blocked.has(definition.name)) return;
		definitions.set(definition.name, definition);
		register(definition);
	}) as ExtensionAPI["registerTool"];

	return {
		get: (name) => definitions.get(name),
		registrationsSince: (mark) => registrations.slice(mark),
		mark: () => registrations.length,
		block(names) {
			const previous = blocked;
			blocked = new Set([...blocked, ...names]);
			return () => {
				blocked = previous;
			};
		},
		restore() {
			pi.registerTool = register as ExtensionAPI["registerTool"];
		},
	};
}
