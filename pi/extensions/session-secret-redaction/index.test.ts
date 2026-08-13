import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "./index.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

for (const scanExitCode of [200, 205]) {
	test(`redacts an escaped secret when Kingfisher exits with ${scanExitCode}`, async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-redaction-"));
		temporaryDirectories.push(directory);
		const sessionFile = join(directory, "session.jsonl");
		const secret = "0123456789abcdef0123456789abcdef";
		const content = `${JSON.stringify({ type: "message", message: { content: `{"api_key": "${secret}"}` } })}\n`;
		await writeFile(sessionFile, content);

		const start = content.indexOf(secret);
		const finding = {
			finding: {
				line: 1,
				column_start: start,
				column_end: start + secret.length - 1,
			},
		};
		let sessionStart: ((event: unknown, ctx: unknown) => Promise<void>) | undefined;
		const commands: string[] = [];
		const pi = {
			on(name: string, handler: (event: unknown, ctx: unknown) => Promise<void>) {
				if (name === "session_start") sessionStart = handler;
			},
			async exec(command: string, args: string[]) {
				commands.push([command, ...args].join(" "));
				if (args[0] === "--version") return { code: 0, stdout: "kingfisher", stderr: "" };
				return { code: scanExitCode, stdout: `${JSON.stringify(finding)}\n`, stderr: "" };
			},
		};
		extension(pi as never);

		const notifications: string[] = [];
		await sessionStart?.(
			{},
			{
				hasUI: true,
				ui: { notify: (message: string) => notifications.push(message) },
				sessionManager: { getSessionFile: () => sessionFile },
			},
		);

		const result = await readFile(sessionFile, "utf8");
		assert.equal(Buffer.byteLength(result), Buffer.byteLength(content));
		assert.equal(result.includes(secret), false);
		assert.equal(result.includes("*".repeat(secret.length)), true);
		assert.doesNotThrow(() => JSON.parse(result));
		assert.deepEqual(notifications, ["Redacted 1 validated secret from this session."]);
		assert.deepEqual(commands.slice(0, 2), [
			"kingfisher --version",
			`kingfisher scan ${sessionFile} --git-history none --only-valid --redact --format jsonl --no-update-check`,
		]);
	});
}
