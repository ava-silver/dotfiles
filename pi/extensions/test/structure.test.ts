import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");

async function findNestedManifests(directory: string): Promise<string[]> {
	const found: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.name === "node_modules") continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			found.push(...(await findNestedManifests(path)));
		} else if (directory !== ROOT && (entry.name === "package.json" || entry.name === "bun.lock")) {
			found.push(relative(ROOT, path));
		}
	}
	return found;
}

test("extensions use the root manifest and lockfile", async () => {
	assert.deepEqual(await findNestedManifests(ROOT), []);
});

test("auto-discovered root contains no tests", async () => {
	const rootFiles = await readdir(ROOT, { withFileTypes: true });
	assert.deepEqual(
		rootFiles.filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts")).map((entry) => entry.name),
		[],
	);
});

test("Pi SDK packages stay aligned", async () => {
	const manifest = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as {
		packageManager?: string;
		peerDependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};
	assert.match(manifest.packageManager ?? "", /^bun@\d+\.\d+\.\d+$/);

	const packages = ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"] as const;
	const versions = packages.map((name) => manifest.devDependencies?.[name]);
	assert.equal(new Set(versions).size, 1);
	assert.match(versions[0] ?? "", /^\d+\.\d+\.\d+$/);
	for (const name of packages) assert.equal(manifest.peerDependencies?.[name], "*");
});
