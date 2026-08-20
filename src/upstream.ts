import type { ExtensionFactory } from "./registry.js";

export async function importUpstream(
	specifier: string,
): Promise<Record<string, any>> {
	return import(specifier) as Promise<Record<string, any>>;
}

export function upstreamFactory(specifier: string): ExtensionFactory {
	return async (pi) => {
		const module = await importUpstream(specifier);
		const factory = module.default;
		if (typeof factory !== "function")
			throw new Error(`${specifier} has no default extension factory`);
		await factory(pi);
	};
}
