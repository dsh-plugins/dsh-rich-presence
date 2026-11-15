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
import { DEFAULT_MODEL_IMAGES } from "./render.js";
/** Discord's own text limit, mirrored here so the page can validate without importing the renderer. */
export const MAX_TEXT = 128;
/** The largest value `presence.truncateAt` may hold. */
export const MAX_TRUNCATE_AT = MAX_TEXT;
/** Smallest reconnect delay the page accepts, in milliseconds. */
export const MIN_RECONNECT_MS = 100;
/** Smallest maximum reconnect delay the page accepts, in milliseconds. */
export const MIN_MAX_RECONNECT_MS = 1_000;
/** Built-in defaults for every group; the schema's defaults mirror these. */
export const DEFAULTS = {
    discord: { clientId: '', activityType: 0, buttons: [] },
    presence: {
        details: '{activity} · {folder}',
        state: '{model} · {context} · {tokens}',
        largeText: '{progress}',
        smallText: '{activity} · {subagents}',
        largeImage: '',
        modelImages: DEFAULT_MODEL_IMAGES.map(rule => ({ asset: rule.asset, patterns: [...rule.patterns] })),
        smallImageRunning: 'deepseek_harness',
        smallImageIdle: 'deepseek_harness',
        labels: {},
        elapsed: 'turn',
        truncateAt: MAX_TEXT,
        showWhenIdle: true,
    },
    privacy: { showToolNames: true, showFolder: true },
    focus: { mode: 'active', includeSubagents: false },
    connection: { transport: 'auto', reconnectMs: 5_000, maxReconnectMs: 60_000, extraPipePaths: [] },
    update: { debounceMs: 400, minIntervalMs: 15_000 },
};
/**
 * Read one volatile group, falling back to its defaults.
 *
 * A loader that has not yet committed the reference, or an older stored config,
 * can leave a group absent; treating that as "use the defaults" keeps the
 * presence working instead of failing the whole plugin.
 *
 * @param reference - the volatile reference, when present.
 * @param fallback - the group's defaults.
 * @returns the group with every field present.
 */
function readGroup(reference, fallback) {
    const value = reference !== undefined && typeof reference.get === 'function'
        ? reference.get()
        : undefined;
    if (value === undefined || value === null || typeof value !== 'object')
        return { ...fallback };
    return { ...fallback, ...value };
}
/**
 * Capture the live configuration as one plain snapshot.
 * @param config - the plugin's configuration references.
 * @returns every group with defaults resolved.
 */
export function readSettings(config) {
    return {
        discord: readGroup(config.discord, DEFAULTS.discord),
        presence: readGroup(config.presence, DEFAULTS.presence),
        privacy: readGroup(config.privacy, DEFAULTS.privacy),
        focus: readGroup(config.focus, DEFAULTS.focus),
        connection: readGroup(config.connection, DEFAULTS.connection),
        update: readGroup(config.update, DEFAULTS.update),
    };
}
/**
 * Project the display groups into the renderer's configuration.
 * @param settings - one configuration snapshot.
 * @returns the render configuration.
 */
export function renderConfigOf(settings) {
    const { presence } = settings;
    return {
        details: presence.details,
        state: presence.state,
        largeText: presence.largeText,
        smallText: presence.smallText,
        largeImage: presence.largeImage,
        modelImages: presence.modelImages,
        smallImageRunning: presence.smallImageRunning,
        smallImageIdle: presence.smallImageIdle,
        labels: presence.labels,
        elapsed: presence.elapsed,
        truncateAt: presence.truncateAt,
        showWhenIdle: presence.showWhenIdle,
    };
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
export function reconcileKeys(settings) {
    const { connection, discord, presence, privacy, update } = settings;
    return {
        transport: JSON.stringify([
            connection.transport,
            discord.clientId.trim(),
            connection.reconnectMs,
            connection.maxReconnectMs,
            connection.extraPipePaths,
        ]),
        update: JSON.stringify([update.debounceMs, update.minIntervalMs]),
        render: JSON.stringify([
            JSON.stringify(discord.activityType),
            discord.buttons,
            presence.details,
            presence.state,
            presence.largeText,
            presence.smallText,
            presence.largeImage,
            presence.modelImages,
            presence.smallImageRunning,
            presence.smallImageIdle,
            presence.labels,
            presence.elapsed,
            presence.truncateAt,
            presence.showWhenIdle,
            JSON.stringify(privacy.showToolNames),
            JSON.stringify(privacy.showFolder),
        ]),
    };
}
/** The layer keys of {@link DEFAULTS}, so a first reconcile compares like with like. */
export const DEFAULT_KEYS = reconcileKeys(DEFAULTS);
/**
 * Split text into non-empty trimmed lines.
 * @param text - multi-line input.
 * @returns one entry per non-empty line.
 */
function lines(text) {
    return text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
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
export function parseButtons(text) {
    const entries = [];
    const errors = [];
    for (const line of lines(text)) {
        // The label is a short word and never contains the separator, while a URL
        // legitimately can, so the FIRST separator ends the label.
        const separator = line.indexOf('|');
        if (separator < 0) {
            errors.push(`Expected "label | url": ${line}`);
            continue;
        }
        const label = line.slice(0, separator).trim();
        const url = line.slice(separator + 1).trim();
        if (label.length === 0) {
            errors.push(`Missing button label: ${line}`);
            continue;
        }
        if (!/^https?:\/\//.test(url)) {
            errors.push(`Button URL must start with http:// or https://: ${line}`);
            continue;
        }
        entries.push({ label, url });
    }
    return { entries, errors };
}
/**
 * Serialize buttons back into the text area format.
 * @param buttons - stored buttons.
 * @returns one line per button.
 */
export function formatButtons(buttons) {
    return buttons.map(button => `${button.label} | ${button.url}`).join('\n');
}
/**
 * Parse the label text area: one `key: value` pair per line.
 *
 * The value may contain colons, so only the first separator counts.
 *
 * @param text - multi-line label input.
 * @returns a single record of accepted overrides and one error per malformed line.
 */
export function parseLabels(text) {
    const records = {};
    const errors = [];
    for (const line of lines(text)) {
        const separator = line.indexOf(':');
        if (separator <= 0) {
            errors.push(`Expected "key: value": ${line}`);
            continue;
        }
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key)) {
            errors.push(`Label key must be a plain word: ${key}`);
            continue;
        }
        records[key] = value;
    }
    return { entries: records, errors };
}
/**
 * Serialize label overrides back into the text area format.
 * @param labels - stored overrides.
 * @returns one `key: value` line per override, sorted for a stable display.
 */
export function formatLabels(labels) {
    return Object.keys(labels).sort().map(key => `${key}: ${labels[key]}`).join('\n');
}
/**
 * Parse the model-image text area: one `asset: keyword, keyword` rule per line.
 *
 * The asset name is what Discord looks up, so it is held to the same character
 * set the developer portal accepts; a keyword is matched against one word of
 * the model id, so punctuation there can never match and is rejected here
 * rather than failing silently at render time.
 *
 * Line order is the priority order, so it is preserved rather than sorted.
 *
 * @param text - multi-line rule input.
 * @returns accepted rules in input order and one error per malformed line.
 */
export function parseModelImages(text) {
    const entries = [];
    const errors = [];
    for (const line of lines(text)) {
        const separator = line.indexOf(':');
        if (separator < 0) {
            errors.push(`Expected "asset: keyword, keyword": ${line}`);
            continue;
        }
        const asset = line.slice(0, separator).trim();
        const patterns = line.slice(separator + 1).split(',').map(pattern => pattern.trim()).filter(pattern => pattern.length > 0);
        if (!/^[A-Za-z0-9_]+$/.test(asset)) {
            errors.push(`Image asset names use letters, digits, and underscores: ${line}`);
            continue;
        }
        if (patterns.length === 0) {
            errors.push(`Missing model keyword: ${line}`);
            continue;
        }
        const bad = patterns.find(pattern => !/^[A-Za-z0-9]+$/.test(pattern));
        if (bad !== undefined) {
            errors.push(`Model keywords use letters and digits: ${bad}`);
            continue;
        }
        entries.push({ asset, patterns });
    }
    return { entries, errors };
}
/**
 * Serialize model-image rules back into the text area format.
 * @param rules - stored rules, in priority order.
 * @returns one line per rule.
 */
export function formatModelImages(rules) {
    return rules.map(rule => `${rule.asset}: ${rule.patterns.join(', ')}`).join('\n');
}
/**
 * Parse the extra-endpoint text area: one endpoint per line.
 * @param text - multi-line endpoint input.
 * @returns accepted endpoints; blank lines contribute nothing.
 */
export function parseEndpoints(text) {
    return lines(text);
}
/**
 * Serialize endpoints back into the text area format.
 * @param endpoints - stored endpoints.
 * @returns one line per endpoint.
 */
export function formatEndpoints(endpoints) {
    return endpoints.join('\n');
}
