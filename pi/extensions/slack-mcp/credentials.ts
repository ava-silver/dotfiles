import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { userInfo } from "node:os";

const execFileAsync = promisify(execFile);

const KEYCHAIN_SERVICE = "Pi Slack MCP credentials";
const KEYCHAIN_ACCOUNT = userInfo().username;
export const KEYCHAIN_TIMEOUT_MS = 10_000;

export interface SlackCredentials {
	accessToken: string;
	refreshToken: string;
	expiresAt?: number;
}

export function securityOptions(signal?: AbortSignal) {
	return {
		encoding: "utf8" as const,
		timeout: KEYCHAIN_TIMEOUT_MS,
		...(signal === undefined ? {} : { signal }),
	};
}

async function runSecurity(args: string[], signal?: AbortSignal): Promise<string> {
	try {
		const { stdout } = await execFileAsync("security", args, securityOptions(signal));
		return stdout.trim();
	} catch (error) {
		if (!signal?.aborted && (error as { killed?: boolean }).killed) {
			throw new Error(`macOS Keychain command timed out after ${KEYCHAIN_TIMEOUT_MS / 1_000} seconds.`, {
				cause: error,
			});
		}
		throw error;
	}
}

export async function readCredentials(signal?: AbortSignal): Promise<SlackCredentials | undefined> {
	try {
		const payload = await runSecurity(
			["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"],
			signal,
		);
		const credentials = JSON.parse(payload) as Partial<SlackCredentials>;
		if (typeof credentials.accessToken !== "string") return undefined;

		return {
			accessToken: credentials.accessToken,
			refreshToken: typeof credentials.refreshToken === "string" ? credentials.refreshToken : "",
			...(typeof credentials.expiresAt === "number" ? { expiresAt: credentials.expiresAt } : {}),
		};
	} catch (error) {
		const code = (error as { code?: number }).code;
		if (code === 44) return undefined;
		throw error;
	}
}

export async function saveCredentials(credentials: SlackCredentials, signal?: AbortSignal): Promise<void> {
	await runSecurity(
		["add-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w", JSON.stringify(credentials), "-U"],
		signal,
	);
}
