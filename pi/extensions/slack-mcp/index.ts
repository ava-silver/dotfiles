import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { authenticate } from "./auth.ts";

const AUTH_REQUIRED_MESSAGE =
	"This opens Slack in your browser. Approve the connection there to let Pi use the Slack MCP server.";

async function connectSlack(ctx: ExtensionContext, signal?: AbortSignal): Promise<{ team: string } | undefined> {
	if (!ctx.hasUI) {
		throw new Error("Slack authentication requires Pi's interactive UI. Run /slack-auth in Pi.");
	}

	const approved = await ctx.ui.confirm(
		"Connect Slack?",
		AUTH_REQUIRED_MESSAGE,
		signal === undefined ? {} : { signal },
	);
	if (!approved) return undefined;

	ctx.ui.notify("Opening Slack authorization in your browser…", "info");
	const result = await authenticate({
		...(signal === undefined ? {} : { signal }),
		onAuthorizationUrl: (url) => ctx.ui.notify(`If no browser opened, open: ${url}`, "info"),
	});
	ctx.ui.notify(`Connected to ${result.team}.`, "info");
	return result;
}

export default function slackMcpExtension(pi: ExtensionAPI): void {
	pi.registerCommand("slack-auth", {
		description: "Connect or reconnect the Slack MCP server",
		handler: async (_args, ctx) => {
			await connectSlack(ctx);
		},
	});

	pi.registerTool({
		name: "slack_auth",
		label: "Authenticate Slack",
		description: "Connect Pi's Slack MCP server. Opens a browser for the user to approve Slack access.",
		promptSnippet: "Authenticate the Slack MCP connection when authorization is required",
		promptGuidelines: [
			"When the Slack MCP reports authentication is required, use slack_auth. It requires the user to approve Slack access in their browser.",
		],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal, onUpdate, ctx) {
			onUpdate?.({
				content: [{ type: "text", text: "Waiting for Slack authorization…" }],
				details: {},
			});
			const result = await connectSlack(ctx, signal);
			if (!result) {
				return {
					content: [
						{
							type: "text",
							text: "Slack authentication was cancelled. Ask the user to run /slack-auth when they are ready.",
						},
					],
					details: { connected: false },
				};
			}

			return {
				content: [
					{
						type: "text",
						text: `Connected to ${result.team}. Retry the Slack MCP operation.`,
					},
				],
				details: { connected: true, team: result.team },
			};
		},
	});
}
