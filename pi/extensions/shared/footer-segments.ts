/**
 * Shared registry for transient powerline footer segments.
 *
 * Extensions that want a colored segment in the right-hand side of the footer
 * can call `registerTransientSegment` / clear with `null`. The footer reads
 * the registry on every render and re-renders whenever it changes.
 *
 * Usage (from any extension in the same process):
 *
 *   import { registerTransientSegment } from "../shared/footer-segments.ts";
 *
 *   // Show a segment:
 *   registerTransientSegment("my-ext", { text: "⟳ loading", bg: "#81c8be", fg: "#232634" });
 *
 *   // Clear it:
 *   registerTransientSegment("my-ext", null);
 */

export type TransientSegment = {
	/** Visible text — plain, no ANSI codes. Padded with spaces by the renderer. */
	text: string;
	/** Hex background color for the segment, e.g. "#81c8be". */
	bg: string;
	/** Hex foreground color for the text, e.g. "#232634". */
	fg: string;
};

// Module-level singleton: one shared instance per process.
const registry = new Map<string, TransientSegment>();
let onChangeCallback: (() => void) | undefined;

/**
 * Register or clear a transient segment. Segments appear in insertion order,
 * left-to-right, before the built-in right-side segments (context %, time, cost).
 */
export function registerTransientSegment(key: string, segment: TransientSegment | null): void {
	if (segment === null) {
		if (!registry.has(key)) return; // no-op, skip needless re-render
		registry.delete(key);
	} else {
		registry.set(key, segment);
	}
	onChangeCallback?.();
}

/** Read all active transient segments in insertion order. */
export function getTransientSegments(): ReadonlyMap<string, TransientSegment> {
	return registry;
}

/**
 * Called once by the footer extension. Returns a cleanup function.
 * Only one callback is active at a time (the footer owns this).
 */
export function setTransientOnChange(fn: () => void): () => void {
	onChangeCallback = fn;
	return () => {
		if (onChangeCallback === fn) onChangeCallback = undefined;
	};
}
