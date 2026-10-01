import { afterEach, describe, expect, it, jest, mock } from "bun:test";

mock.module("vitest", () => ({ afterEach, describe, expect, it, vi: jest }));
