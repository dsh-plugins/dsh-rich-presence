/**
 * Turning live plugin configuration into the values the presence pipeline needs.
 *
 * The Host declares every configuration group as a volatile reference, so a
 * save from the plugin page reaches the running plugin without a restart. This
 * module is the one place that reads those references, so the values a render
 * sees and the values a reconcile compares always come from the same snapshot.
 *
 * The parsing helpers live here too, so the wire format the page edits (one
 * button per line, one label per line) is defined beside the code that reads it
 * rather than inside a browser bundle that cannot be tested here.
 *
 * @module dsh-rich-presence/settings
 */
import type { Volatile } from '@deepseek-ai/cordis';
import type { RenderConfig } from './render.ts';
/** Discord's four activity types this plugin offers. */
export type ActivityType = 0 | 2 | 3 | 5;
/** One clickable card button. */
export interface PresenceButton {
    label: string;
    url: string;
}
/** Discord connection settings, as stored. */
export interface DiscordSettings {
    clientId: string;
    activityType: ActivityType;
    buttons: PresenceButton[];
}
/** Display settings, as stored. */
export interface PresenceSettings {
    details: string;
    state: string;
    largeText: string;
    smallText: string;
    largeImage: string;
    smallImageRunning: string;
    smallImageIdle: string;
    labels: Record<string, string>;
    elapsed: 'session' | 'turn' | 'off';
    truncateAt: number;
    showWhenIdle: boolean;
}
/** What may be published publicly. */
export interface PrivacySettings {
    showToolNames: boolean;
    showFolder: boolean;
}
/** Which live agent is displayed. */
export interface FocusSettings {
    mode: 'active' | 'latest';
    includeSubagents: boolean;
}
/** Transport and reconnect settings, as stored. */
export interface ConnectionSettings {
    transport: 'auto' | 'ipc' | 'log';
    reconnectMs: number;
    maxReconnectMs: number;
    extraPipePaths: string[];
}
/** Publish rate settings, as stored. */
export interface UpdateSettings {
    debounceMs: number;
    minIntervalMs: number;
}
/**
 * The plugin's configuration as the running pipeline reads it.
 *
 * Each group is a volatile reference: keep the reference and call `.get()`, or
 * capture one `SettingsSnapshot` for a single operation.
 */
export interface Config {
    discord: Volatile<DiscordSettings>;
    presence: Volatile<PresenceSettings>;
    privacy: Volatile<PrivacySettings>;
    focus: Volatile<FocusSettings>;
    connection: Volatile<ConnectionSettings>;
    update: Volatile<UpdateSettings>;
}
/** Every stored group in plain form, with defaults resolved. */
export interface SettingsSnapshot {
    discord: DiscordSettings;
    presence: PresenceSettings;
    privacy: PrivacySettings;
    focus: FocusSettings;
    connection: ConnectionSettings;
    update: UpdateSettings;
}
/** Discord's own text limit, mirrored here so the page can validate without importing the renderer. */
export declare const MAX_TEXT = 128;
/** The largest value `presence.truncateAt` may hold. */
export declare const MAX_TRUNCATE_AT = 128;
/** Smallest reconnect delay the page accepts, in milliseconds. */
export declare const MIN_RECONNECT_MS = 100;
/** Smallest maximum reconnect delay the page accepts, in milliseconds. */
export declare const MIN_MAX_RECONNECT_MS = 1000;
/** Built-in defaults for every group; the schema's defaults mirror these. */
export declare const DEFAULTS: SettingsSnapshot;
/**
 * Capture the live configuration as one plain snapshot.
 * @param config - the plugin's configuration references.
 * @returns every group with defaults resolved.
 */
export declare function readSettings(config: Config): SettingsSnapshot;
/**
 * Project the display groups into the renderer's configuration.
 * @param settings - one configuration snapshot.
 * @returns the render configuration.
 */
export declare function renderConfigOf(settings: SettingsSnapshot): RenderConfig;
/** Which layers a configuration change invalidates. */
export interface ReconcileKeys {
    /** Reconnect when this changes: the transport and the application id. */
    transport: string;
    /** Replace the publisher when this changes. */
    update: string;
    /** Re-render the card when this changes. */
    render: string;
}
/**
 * Summarize a snapshot into the comparisons a reconcile needs.
 *
 * Splitting the snapshot this way is what lets a template edit redraw the card
 * without dropping the Discord connection, and a reconnect-delay edit avoid a
 * repaint.
 *
 * @param settings - one configuration snapshot.
 * @returns one stable key per layer.
 */
export declare function reconcileKeys(settings: SettingsSnapshot): ReconcileKeys;
/** The layer keys of {@link DEFAULTS}, so a first reconcile compares like with like. */
export declare const DEFAULT_KEYS: ReconcileKeys;
/** One parsed line, or the reason it was rejected. */
export interface ParseResult<T> {
    /** Accepted entries, in input order. */
    entries: T[];
    /** Human-readable problems, one per rejected line. */
    errors: string[];
}
/** The result of parsing a block of `key: value` lines into one record. */
export interface ParseResultMap {
    /** Accepted overrides, keyed by placeholder name. */
    entries: Record<string, string>;
    /** Human-readable problems, one per rejected line. */
    errors: string[];
}
/**
 * Parse the button text area: one `label | url` pair per line.
 *
 * Order is preserved and the caller decides the two-button limit, so a rejected
 * third button is reported rather than silently dropped here.
 *
 * @param text - multi-line button input.
 * @returns accepted buttons and one error per malformed line.
 */
export declare function parseButtons(text: string): ParseResult<PresenceButton>;
/**
 * Serialize buttons back into the text area format.
 * @param buttons - stored buttons.
 * @returns one line per button.
 */
export declare function formatButtons(buttons: readonly PresenceButton[]): string;
/**
 * Parse the label text area: one `key: value` pair per line.
 *
 * The value may contain colons, so only the first separator counts.
 *
 * @param text - multi-line label input.
 * @returns a single record of accepted overrides and one error per malformed line.
 */
export declare function parseLabels(text: string): ParseResultMap;
/**
 * Serialize label overrides back into the text area format.
 * @param labels - stored overrides.
 * @returns one `key: value` line per override, sorted for a stable display.
 */
export declare function formatLabels(labels: Record<string, string>): string;
/**
 * Parse the extra-endpoint text area: one endpoint per line.
 * @param text - multi-line endpoint input.
 * @returns accepted endpoints; blank lines contribute nothing.
 */
export declare function parseEndpoints(text: string): string[];
/**
 * Serialize endpoints back into the text area format.
 * @param endpoints - stored endpoints.
 * @returns one line per endpoint.
 */
export declare function formatEndpoints(endpoints: readonly string[]): string;
