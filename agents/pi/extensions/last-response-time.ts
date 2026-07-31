import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "last-response-time";

function formatElapsed(elapsedMs: number): string {
	const seconds = Math.max(0, Math.floor(elapsedMs / 1_000));
	if (seconds < 60) return `${seconds}s ago`;

	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;

	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;

	return `${Math.floor(hours / 24)}d ago`;
}

function lastAssistantTimestamp(ctx: ExtensionContext): number | undefined {
	let timestamp: number | undefined;
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			timestamp = entry.message.timestamp;
		}
	}
	return timestamp;
}

export default function lastResponseTimeExtension(pi: ExtensionAPI): void {
	let lastResponseAt: number | undefined;
	let refreshTimer: ReturnType<typeof setInterval> | undefined;

	function render(ctx: ExtensionContext): void {
		if (!lastResponseAt) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}

		const clockTime = new Intl.DateTimeFormat(undefined, {
			hour: "numeric",
			minute: "2-digit",
		}).format(lastResponseAt);
		const label = `󰥔 ${formatElapsed(Date.now() - lastResponseAt)} · ${clockTime}`;
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", label));
	}

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		lastResponseAt = lastAssistantTimestamp(ctx);
		render(ctx);
		refreshTimer = setInterval(() => render(ctx), 5_000);
	});

	pi.on("message_end", (event, ctx) => {
		if (ctx.mode !== "tui" || event.message.role !== "assistant") return;
		lastResponseAt = Date.now();
		render(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (refreshTimer) clearInterval(refreshTimer);
		refreshTimer = undefined;
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
