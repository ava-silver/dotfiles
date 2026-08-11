import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { type SlackCredentials, saveCredentials } from "./credentials.ts";

const execFileAsync = promisify(execFile);

export const SLACK_CLIENT_ID = "1601185624273.8899143856786";
const CALLBACK_PORT = 3118;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;
const AUTH_ENDPOINT = "https://slack.com/oauth/v2_user/authorize";
const TOKEN_ENDPOINT = "https://slack.com/api/oauth.v2.user.access";
const SCOPES = [
	"channels:history",
	"groups:history",
	"im:history",
	"mpim:history",
	"search:read.public",
	"search:read.private",
	"search:read.mpim",
	"search:read.im",
	"search:read.files",
	"search:read.users",
	"users:read",
	"users:read.email",
	"chat:write",
].join(" ");

interface TokenResponse {
	ok: boolean;
	error?: string;
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	team?: { name?: string };
}

export interface AuthenticationResult {
	team: string;
}

export interface AuthenticateOptions {
	signal?: AbortSignal;
	onAuthorizationUrl?: (url: string) => void;
}

function createPkcePair(): { verifier: string; challenge: string } {
	const verifier = randomBytes(32).toString("base64url");
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	return { verifier, challenge };
}

function authorizationUrl(challenge: string, state: string): string {
	const params = new URLSearchParams({
		client_id: SLACK_CLIENT_ID,
		response_type: "code",
		redirect_uri: REDIRECT_URI,
		scope: SCOPES,
		state,
		code_challenge: challenge,
		code_challenge_method: "S256",
	});
	return `${AUTH_ENDPOINT}?${params}`;
}

async function waitForAuthorization(expectedState: string, signal?: AbortSignal): Promise<string> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const server = createServer((request, response) => {
			const url = new URL(request.url ?? "/", REDIRECT_URI);
			if (url.pathname !== "/callback") {
				response.writeHead(404).end();
				return;
			}

			if (url.searchParams.get("state") !== expectedState) {
				response.writeHead(400, { "content-type": "text/plain" });
				response.end("State mismatch");
				return;
			}

			const error = url.searchParams.get("error");
			const code = url.searchParams.get("code");
			if (error || !code) {
				response.writeHead(400, { "content-type": "text/plain" });
				response.end("Slack authentication was cancelled or denied. You can close this tab.");
				finish(new Error(`Slack authorization failed: ${error ?? "no authorization code"}`));
				return;
			}

			response.writeHead(200, { "content-type": "text/html" });
			response.end("<h2>Slack authenticated</h2><p>You can close this tab and return to Pi.</p>");
			finish(undefined, code);
		});

		const timeout = setTimeout(() => finish(new Error("Timed out waiting for Slack authorization.")), 5 * 60_000);

		function cleanup() {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", onAbort);
			server.close();
		}

		function finish(error?: Error, code?: string) {
			if (settled) return;
			settled = true;
			cleanup();
			if (error) reject(error);
			else resolve(code!);
		}

		function onAbort() {
			finish(new Error("Slack authentication cancelled."));
		}

		signal?.addEventListener("abort", onAbort, { once: true });
		if (signal?.aborted) {
			onAbort();
			return;
		}

		server.once("error", (error) => finish(error));
		server.listen(CALLBACK_PORT, "127.0.0.1");
	});
}

async function exchangeCode(code: string, verifier: string): Promise<{ credentials: SlackCredentials; team: string }> {
	const response = await fetch(TOKEN_ENDPOINT, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: SLACK_CLIENT_ID,
			code,
			redirect_uri: REDIRECT_URI,
			code_verifier: verifier,
		}),
	});
	const payload = (await response.json()) as TokenResponse;

	if (!response.ok || !payload.ok || !payload.access_token) {
		throw new Error(`Slack token exchange failed: ${payload.error ?? response.statusText}`);
	}

	return {
		credentials: {
			accessToken: payload.access_token,
			refreshToken: payload.refresh_token ?? "",
			expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1_000 : undefined,
		},
		team: payload.team?.name ?? "your Slack workspace",
	};
}

export async function authenticate(options: AuthenticateOptions = {}): Promise<AuthenticationResult> {
	const { verifier, challenge } = createPkcePair();
	const state = randomBytes(16).toString("base64url");
	const url = authorizationUrl(challenge, state);
	const authorization = waitForAuthorization(state, options.signal);

	options.onAuthorizationUrl?.(url);
	try {
		await execFileAsync("open", [url]);
	} catch {
		// The URL is surfaced to the caller so it can be opened manually.
	}

	const code = await authorization;
	const { credentials, team } = await exchangeCode(code, verifier);
	await saveCredentials(credentials);
	return { team };
}

export async function refreshCredentials(refreshToken: string): Promise<SlackCredentials> {
	const response = await fetch(TOKEN_ENDPOINT, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			client_id: SLACK_CLIENT_ID,
			refresh_token: refreshToken,
		}),
	});
	const payload = (await response.json()) as TokenResponse;

	if (!response.ok || !payload.ok || !payload.access_token) {
		throw new Error(`Slack token refresh failed: ${payload.error ?? response.statusText}`);
	}

	const credentials: SlackCredentials = {
		accessToken: payload.access_token,
		refreshToken: payload.refresh_token ?? refreshToken,
		expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1_000 : undefined,
	};
	await saveCredentials(credentials);
	return credentials;
}
