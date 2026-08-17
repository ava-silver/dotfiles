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
const TOKEN_REQUEST_TIMEOUT_MS = 30_000;
export const OPEN_TIMEOUT_MS = 10_000;
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

export function withDeadline(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
	const deadline = AbortSignal.timeout(timeoutMs);
	return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

export function openOptions(signal?: AbortSignal) {
	return {
		timeout: OPEN_TIMEOUT_MS,
		...(signal === undefined ? {} : { signal }),
	};
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
	return `${AUTH_ENDPOINT}?${params.toString()}`;
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

			response.writeHead(200, {
				"cache-control": "no-store",
				"content-type": "text/html; charset=utf-8",
			});
			response.end(authenticationCompletePage);
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

async function exchangeCode(
	code: string,
	verifier: string,
	signal?: AbortSignal,
): Promise<{ credentials: SlackCredentials; team: string }> {
	const response = await fetch(TOKEN_ENDPOINT, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: SLACK_CLIENT_ID,
			code,
			redirect_uri: REDIRECT_URI,
			code_verifier: verifier,
		}),
		signal: withDeadline(signal, TOKEN_REQUEST_TIMEOUT_MS),
	});
	const payload = (await response.json()) as TokenResponse;

	if (!response.ok || !payload.ok || !payload.access_token) {
		throw new Error(`Slack token exchange failed: ${payload.error ?? response.statusText}`);
	}

	return {
		credentials: {
			accessToken: payload.access_token,
			refreshToken: payload.refresh_token ?? "",
			...(payload.expires_in === undefined ? {} : { expiresAt: Date.now() + payload.expires_in * 1_000 }),
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
	void execFileAsync("open", [url], openOptions(options.signal)).catch(() => {
		// The URL is surfaced to the caller so it can be opened manually.
	});

	const code = await authorization;
	const { credentials, team } = await exchangeCode(code, verifier, options.signal);
	await saveCredentials(credentials, options.signal);
	return { team };
}

export async function refreshCredentials(refreshToken: string, signal?: AbortSignal): Promise<SlackCredentials> {
	const response = await fetch(TOKEN_ENDPOINT, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			client_id: SLACK_CLIENT_ID,
			refresh_token: refreshToken,
		}),
		signal: withDeadline(signal, TOKEN_REQUEST_TIMEOUT_MS),
	});
	const payload = (await response.json()) as TokenResponse;

	if (!response.ok || !payload.ok || !payload.access_token) {
		throw new Error(`Slack token refresh failed: ${payload.error ?? response.statusText}`);
	}

	const credentials: SlackCredentials = {
		accessToken: payload.access_token,
		refreshToken: payload.refresh_token ?? refreshToken,
		...(payload.expires_in === undefined ? {} : { expiresAt: Date.now() + payload.expires_in * 1_000 }),
	};
	await saveCredentials(credentials, signal);
	return credentials;
}

const authenticationCompletePage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Slack connected</title>
  <style>
    :root {
      color: #f8f8f8;
      background: #1d1c1d;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }

    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      overflow: hidden;
      background:
        radial-gradient(circle at 12% 12%, #4a154b 0, transparent 34%),
        radial-gradient(circle at 88% 88%, #1264a3 0, transparent 30%),
        #1d1c1d;
    }

    main {
      width: min(100% - 40px, 540px);
      padding: 48px;
      text-align: center;
      border: 1px solid rgb(255 255 255 / 14%);
      border-radius: 28px;
      background: rgb(36 35 36 / 82%);
      box-shadow: 0 24px 80px rgb(0 0 0 / 35%);
      backdrop-filter: blur(18px);
    }

    .mark {
      width: 76px;
      height: 76px;
      margin: 0 auto 28px;
      display: grid;
      place-items: center;
      border-radius: 24px;
      background: white;
      box-shadow: 0 12px 28px rgb(0 0 0 / 28%);
    }

    .mark img { width: 52px; height: 52px; }

    h1 {
      margin: 0;
      font-size: clamp(32px, 8vw, 44px);
      line-height: 1.08;
      letter-spacing: -.04em;
    }

    p {
      max-width: 360px;
      margin: 18px auto 0;
      color: #d1d2d3;
      font-size: 17px;
      line-height: 1.55;
    }

    .return {
      margin-top: 32px;
      padding-top: 24px;
      border-top: 1px solid rgb(255 255 255 / 12%);
      color: #9f9fa0;
      font-size: 14px;
    }

    @media (max-width: 520px) {
      main { padding: 36px 26px; }
    }

    @media (prefers-reduced-motion: no-preference) {
      .mark { animation: settle .5s cubic-bezier(.2, .9, .2, 1.2) both; }
      @keyframes settle { from { opacity: 0; transform: scale(.65) rotate(-12deg); } }
    }
  </style>
</head>
<body>
  <main>
    <div class="mark">
      <svg width="127" height="127" xmlns="http://www.w3.org/2000/svg">
        <path d="M27.2 80c0 7.3-5.9 13.2-13.2 13.2C6.7 93.2.8 87.3.8 80c0-7.3 5.9-13.2 13.2-13.2h13.2V80zm6.6 0c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V80z" fill="#E01E5A"/>
        <path d="M47 27c-7.3 0-13.2-5.9-13.2-13.2C33.8 6.5 39.7.6 47 .6c7.3 0 13.2 5.9 13.2 13.2V27H47zm0 6.7c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H13.9C6.6 60.1.7 54.2.7 46.9c0-7.3 5.9-13.2 13.2-13.2H47z" fill="#36C5F0"/>
        <path d="M99.9 46.9c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H99.9V46.9zm-6.6 0c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V13.8C66.9 6.5 72.8.6 80.1.6c7.3 0 13.2 5.9 13.2 13.2v33.1z" fill="#2EB67D"/>
        <path d="M80.1 99.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V99.8h13.2zm0-6.6c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33.1c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H80.1z" fill="#ECB22E"/>
      </svg>
    </div>
    <h1>You’re connected</h1>
    <p>Slack is ready to use in Pi. Return to your terminal to continue.</p>
    <div class="return">You can safely close this tab.</div>
  </main>
</body>
</html>`;
