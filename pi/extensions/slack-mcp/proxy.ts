#!/usr/bin/env bun
import { createInterface } from "node:readline";

import { refreshCredentials } from "./auth.ts";
import { readCredentials } from "./credentials.ts";

const MCP_URL = "https://mcp.slack.com/mcp";
const AUTH_REQUIRED =
	"Slack authentication required. Call slack_auth to open Slack authorization; the user must approve it in their browser.";

interface JsonRpcRequest {
	jsonrpc?: string;
	id?: string | number | null;
}

function log(message: string): void {
	process.stderr.write(`[slack-mcp-proxy] ${message}\n`);
}

function errorResponse(request: JsonRpcRequest | undefined, code: number, message: string): string {
	return JSON.stringify({
		jsonrpc: "2.0",
		id: request?.id ?? null,
		error: { code, message },
	});
}

async function forward(body: string, accessToken: string): Promise<Response> {
	return fetch(MCP_URL, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${accessToken}`,
		},
		body,
	});
}

async function handle(line: string): Promise<string> {
	let request: JsonRpcRequest;
	try {
		request = JSON.parse(line) as JsonRpcRequest;
	} catch {
		return errorResponse(undefined, -32700, "Invalid JSON-RPC request.");
	}

	const credentials = await readCredentials();
	if (!credentials?.accessToken) {
		return errorResponse(request, -32001, AUTH_REQUIRED);
	}

	let response = await forward(line, credentials.accessToken);
	if (response.status !== 401) return response.text();

	if (!credentials.refreshToken) {
		return errorResponse(request, -32001, AUTH_REQUIRED);
	}

	try {
		const refreshed = await refreshCredentials(credentials.refreshToken);
		response = await forward(line, refreshed.accessToken);
	} catch (error) {
		log(`Token refresh failed: ${error instanceof Error ? error.message : String(error)}`);
		return errorResponse(request, -32001, AUTH_REQUIRED);
	}

	if (response.status === 401) return errorResponse(request, -32001, AUTH_REQUIRED);
	return response.text();
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
	if (!line.trim()) continue;

	try {
		process.stdout.write(`${await handle(line)}\n`);
	} catch (error) {
		log(`Request failed: ${error instanceof Error ? error.message : String(error)}`);
		process.stdout.write(`${errorResponse(undefined, -32603, "Slack MCP request failed. Retry the operation.")}\n`);
	}
}
