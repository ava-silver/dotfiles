import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "./index.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("redacts an escaped secret without changing the JSONL size", async () => {
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
			if (args[0] === "--version") throw new Error("not found");
			if (command === "brew") return { code: 0, stdout: "", stderr: "" };
			return { code: 205, stdout: `${JSON.stringify(finding)}\n`, stderr: "" };
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
	expect(Buffer.byteLength(result)).toBe(Buffer.byteLength(content));
	expect(result).not.toContain(secret);
	expect(result).toContain("*".repeat(secret.length));
	expect(() => JSON.parse(result)).not.toThrow();
	expect(notifications).toEqual(["Redacted 1 validated secret from this session."]);
	expect(commands.slice(0, 2)).toEqual(["kingfisher --version", "brew install kingfisher"]);
});
