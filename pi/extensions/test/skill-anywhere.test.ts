import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectSkillDirs } from "../skill-anywhere.ts";

test("excludes project skill directories when the project is untrusted", () => {
	const root = mkdtempSync(join(tmpdir(), "skill-anywhere-"));
	try {
		const project = join(root, "project");
		const nested = join(project, "nested");
		const globalSkills = join(root, "global", "skills");
		const piSkills = join(project, ".pi", "skills");
		const agentSkills = join(nested, ".agents", "skills");
		mkdirSync(globalSkills, { recursive: true });
		mkdirSync(piSkills, { recursive: true });
		mkdirSync(agentSkills, { recursive: true });
		writeFileSync(join(project, ".git"), "gitdir: ignored");

		assert.deepEqual(collectSkillDirs(nested, false, globalSkills), [globalSkills]);
		assert.deepEqual(collectSkillDirs(nested, true, globalSkills), [globalSkills, agentSkills, piSkills]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
