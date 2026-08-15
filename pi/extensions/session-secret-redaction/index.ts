import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type Finding = {
	line: number;
	column_start: number;
	column_end: number;
};

type FindingRecord = {
	finding?: Finding;
};

function parseFindings(output: string): Finding[] {
	const findings: Finding[] = [];
	for (const line of output.split("\n")) {
		if (!line.trim()) continue;
		const record = JSON.parse(line) as FindingRecord;
		if (record.finding) findings.push(record.finding);
	}
	return findings;
}

function redact(content: string, findings: Finding[]): string {
	const lines = content.split("\n");
	const byLine = new Map<number, Finding[]>();

	for (const finding of findings) {
		const matches = byLine.get(finding.line) ?? [];
		matches.push(finding);
		byLine.set(finding.line, matches);
	}

	for (const [lineNumber, matches] of byLine) {
		const line = Array.from(lines[lineNumber - 1] ?? "");
		for (const finding of matches.sort((a, b) => b.column_start - a.column_start)) {
			const start = finding.column_start;
			const end = finding.column_end + 1;
			if (start < 0 || end > line.length || start >= end) {
				throw new Error(`Invalid Kingfisher range at ${lineNumber}:${finding.column_start}-${finding.column_end}`);
			}
			line.splice(start, end - start, ...Array<string>(end - start).fill("*"));
		}
		lines[lineNumber - 1] = line.join("");
	}

	const redacted = lines.join("\n");
	for (const line of redacted.split("\n")) {
		if (line) JSON.parse(line);
	}
	return redacted;
}

async function ensureKingfisher(pi: ExtensionAPI): Promise<void> {
	try {
		const result = await pi.exec("kingfisher", ["--version"], { timeout: 10_000 });
		if (result.code === 0) return;
	} catch {
		// Report the missing provisioned dependency below.
	}

	throw new Error("Kingfisher is not installed. Run Brew bundle or ./setup.sh.");
}

async function redactSession(pi: ExtensionAPI, ctx: ExtensionContext): Promise<number> {
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile) return 0;
	try {
		await stat(sessionFile);
	} catch {
		return 0;
	}
	await ensureKingfisher(pi);

	const result = await pi.exec(
		"kingfisher",
		[
			"scan",
			sessionFile,
			"--git-history",
			"none",
			"--only-valid",
			"--redact",
			"--no-dedup",
			"--format",
			"jsonl",
			"--no-update-check",
		],
		{ timeout: 60_000 },
	);
	if (![0, 200, 205].includes(result.code))
		throw new Error(`Kingfisher scan failed: (${result.code}) - ${result.stdout.trim()}${result.stderr.trim()}`);

	const findings = parseFindings(result.stdout);
	if (findings.length === 0) return 0;

	const info = await stat(sessionFile);
	const content = await readFile(sessionFile, "utf8");
	const redacted = redact(content, findings);
	const temporary = `${sessionFile}.redact-${process.pid}.tmp`;
	try {
		await writeFile(temporary, redacted, { mode: info.mode });
		await rename(temporary, sessionFile);
	} catch (error) {
		await unlink(temporary).catch(() => undefined);
		throw error;
	}
	return findings.length;
}

export default function sessionSecretRedaction(pi: ExtensionAPI): void {
	let pending = Promise.resolve();

	function run(ctx: ExtensionContext): Promise<void> {
		pending = pending.then(async () => {
			try {
				const count = await redactSession(pi, ctx);
				if (count > 0 && ctx.hasUI) {
					ctx.ui.notify(`Redacted ${count} validated secret${count === 1 ? "" : "s"} from this session.`, "info");
				}
			} catch (error) {
				if (ctx.hasUI) {
					const reason = error instanceof Error ? error.message : "unknown error";
					ctx.ui.notify(`Could not redact secrets from this Pi session: ${reason}`, "warning");
				}
			}
		});
		return pending;
	}

	pi.on("session_start", async (_event, ctx) => run(ctx));
	pi.on("agent_settled", async (_event, ctx) => run(ctx));
	pi.on("session_shutdown", async (_event, ctx) => run(ctx));
}
