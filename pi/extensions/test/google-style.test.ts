import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { BuildSystemPromptOptions, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildGoogleStylePrompt, parseGoogleStyleMode, restoreGoogleStyleMode } from "../google-style.ts";

test("parses Google style modes", () => {
	assert.equal(parseGoogleStyleMode("on"), true);
	assert.equal(parseGoogleStyleMode("new"), true);
	assert.equal(parseGoogleStyleMode("old"), false);
	assert.equal(parseGoogleStyleMode("off"), false);
	assert.equal(parseGoogleStyleMode("status"), undefined);
});

test("restores the latest Google style mode from the current branch", () => {
	const ctx = {
		sessionManager: {
			getBranch: () => [
				{ type: "custom", customType: "google-style-mode", data: { enabled: true } },
				{ type: "custom", customType: "other", data: { enabled: true } },
				{ type: "custom", customType: "google-style-mode", data: { enabled: false } },
			],
		},
	} as unknown as ExtensionContext;

	assert.equal(restoreGoogleStyleMode(ctx), false);
});

test("builds a session-wide prompt from the Google style skill", () => {
	const root = mkdtempSync(join(tmpdir(), "google-style-"));
	try {
		const skillPath = join(root, "SKILL.md");
		writeFileSync(skillPath, "---\nname: google-developer-style\n---\n\nUse active voice.\n");
		const skills = [
			{
				name: "google-developer-style",
				description: "test",
				filePath: skillPath,
				baseDir: root,
				sourceInfo: { path: skillPath, source: "test", scope: "user", origin: "top-level" },
				disableModelInvocation: false,
			},
		] satisfies NonNullable<BuildSystemPromptOptions["skills"]>;

		const prompt = buildGoogleStylePrompt(skills);
		assert.match(prompt, /every user-facing response/);
		assert.match(prompt, /Use active voice\./);
		assert.doesNotMatch(prompt, /name: google-developer-style/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
