import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { userInfo } from "node:os";

const execFileAsync = promisify(execFile);

const KEYCHAIN_SERVICE = "Pi Slack MCP credentials";
const KEYCHAIN_ACCOUNT = userInfo().username;

export interface SlackCredentials {
	accessToken: string;
	refreshToken: string;
	expiresAt?: number;
}

async function runSecurity(args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("security", args, {
		encoding: "utf8",
	});
	return stdout.trim();
}

export async function readCredentials(): Promise<SlackCredentials | undefined> {
	try {
		const payload = await runSecurity(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"]);
		const credentials = JSON.parse(payload) as Partial<SlackCredentials>;
		if (typeof credentials.accessToken !== "string") return undefined;

		return {
			accessToken: credentials.accessToken,
			refreshToken: typeof credentials.refreshToken === "string" ? credentials.refreshToken : "",
			expiresAt: typeof credentials.expiresAt === "number" ? credentials.expiresAt : undefined,
		};
	} catch (error) {
		const code = (error as { code?: number }).code;
		if (code === 44) return undefined;
		throw error;
	}
}

export async function saveCredentials(credentials: SlackCredentials): Promise<void> {
	await runSecurity([
		"add-generic-password",
		"-s",
		KEYCHAIN_SERVICE,
		"-a",
		KEYCHAIN_ACCOUNT,
		"-w",
		JSON.stringify(credentials),
		"-U",
	]);
}
