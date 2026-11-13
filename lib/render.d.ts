/**
 * Turn one presence snapshot into a Discord activity payload.
 *
 * The whole display policy lives here: which value goes to which of Discord's
 * four text slots, how a template degrades when a value is missing, and the
 * size limits Discord enforces. Keeping it pure lets the priority table be
 * tested without a socket.
 *
 * @module dsh-rich-presence/render
 */
/** Which phase the agent is in; the highest-priority display value. */
export type ActivityPhase = 'approval' | 'compacting' | 'tool' | 'thinking' | 'working' | 'queued' | 'idle' | 'absent';
/** Provider-reported usage totals for the whole durable log. */
export interface UsageTotals {
    uncachedInputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}
/** Everything one activity render may read. Every field except `phase` is optional. */
export interface PresenceSnapshot {
    /** Current agent phase. */
    phase: ActivityPhase;
    /** Name of the tool currently running, when `phase` is `tool`. */
    toolName?: string;
    /** Model id of the selected route. */
    model?: string;
    /** Provider id of the selected route. */
    provider?: string;
    /** Explicit reasoning effort of the selected route. */
    effort?: string;
    /** Latest provider-reported prompt size, in tokens. */
    contextTokens?: number;
    /** Route capacity paired with the latest prompt size, in tokens. */
    contextWindow?: number;
    /** Whole-log provider usage. */
    usage?: UsageTotals;
    /** Base name of the session working directory. */
    folder?: string;
    /** Current turn number. */
    turn?: number;
    /** Current step number within the turn. */
    step?: number;
    /** Live subagent sessions. */
    subagents: number;
    /** Epoch milliseconds when the displayed session started. */
    sessionStart?: number;
    /** Epoch milliseconds when the current turn started. */
    turnStart?: number;
}
/** The activity object Discord accepts for `SET_ACTIVITY`. */
export interface ActivityPayload {
    type?: number;
    details?: string;
    state?: string;
    timestamps?: {
        start?: number;
        end?: number;
    };
    assets?: {
        large_image?: string;
        large_text?: string;
        small_image?: string;
        small_text?: string;
    };
    buttons?: {
        label: string;
        url: string;
    }[];
}
/** Display policy, mirroring the plugin's `presence` configuration section. */
export interface RenderConfig {
    /** Template for Discord's first text line. */
    details: string;
    /** Template for Discord's second text line. */
    state: string;
    /** Template for the hover text of the large image; empty omits the text. */
    largeText: string;
    /** Template for the hover text of the small image. */
    smallText: string;
    /** Asset name of the large image, uploaded to the Discord application; empty omits it. */
    largeImage: string;
    /** Asset name of the small image while the agent works; empty omits it. */
    smallImageRunning: string;
    /** Asset name of the small image while the agent is idle; empty omits it. */
    smallImageIdle: string;
    /** Phase wording; omitted entries keep the built-in English defaults. */
    labels?: PhaseLabels;
    /** Which start time the elapsed timer counts from. */
    elapsed: 'session' | 'turn' | 'off';
    /** Maximum characters per text field, capped by Discord's own 128. */
    truncateAt: number;
    /** Send an activity at all when no agent is attached. */
    showWhenIdle: boolean;
}
/** Discord's own hard limit for `details`, `state`, `large_text`, and `small_text`. */
export declare const DISCORD_TEXT_LIMIT = 128;
/**
 * Format a token count the way the DSH statistics strip does.
 *
 * Uses decimal units so the number matches the rest of the UI: `517`, `12.2K`,
 * `517K`, `1.2M`. A count that rounds up across a unit boundary is promoted
 * rather than shown as `1000K`.
 *
 * @param value - a non-negative token count.
 * @returns the compact display string.
 */
export declare function formatCompactTokens(value: number): string;
/**
 * Built-in English wording for every phase; a configured override replaces one.
 *
 * `{tool}` is substituted in a tool-phase label when the tool may be named.
 */
export declare const DEFAULT_PHASE_LABELS: {
    readonly approval: "Awaiting approval";
    readonly compacting: "Compacting context";
    readonly tool: "Running {tool}";
    readonly toolHidden: "Running a tool";
    readonly thinking: "Thinking";
    readonly working: "Working";
    readonly queued: "Queued input";
    readonly idle: "Idle";
};
/** One label override; any subset of {@link DEFAULT_PHASE_LABELS}. */
export type PhaseLabels = Partial<Record<keyof typeof DEFAULT_PHASE_LABELS, string>>;
/**
 * Expand one template into its segments, dropping every segment that renders empty.
 *
 * A segment is delimited by ` · `. Inside a segment, a `(…)` or `[…]` group
 * holding exactly one placeholder is dropped when that placeholder is empty, so
 * `{activity} ({folder})` becomes `Running Bash` rather than `Running Bash ()`.
 *
 * @param template - template text with `{name}` placeholders.
 * @param values - placeholder values; empty means "hide".
 * @returns the rendered segments, in order, without empty entries.
 */
export declare function expandTemplate(template: string, values: Record<string, string>): string[];
/**
 * Apply Discord's text limits to one rendered field.
 *
 * Discord rejects a field shorter than two characters and truncates nothing,
 * so this returns `undefined` instead of an invalid value.
 *
 * @param text - rendered text, possibly empty.
 * @param limit - maximum characters.
 * @returns the accepted text, or `undefined` when Discord would reject it.
 */
export declare function fitField(text: string, limit: number): string | undefined;
/**
 * Render one snapshot into a Discord activity payload.
 *
 * @param snapshot - values read from the session log and live agent.
 * @param config - display policy.
 * @param showToolNames - whether tool names may be displayed.
 * @param showFolder - whether the working directory name may be displayed.
 * @returns the payload, or `undefined` when nothing should be shown at all.
 */
export declare function renderActivity(snapshot: PresenceSnapshot, config: RenderConfig, showToolNames: boolean, showFolder: boolean): ActivityPayload | undefined;
