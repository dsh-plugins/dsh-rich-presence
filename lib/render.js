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
/** Default model-image rules, one per model family the plugin recognises. */
export const DEFAULT_MODEL_IMAGES = [
    // Anthropic ids carry `claude-`, and gateways often keep only the tier word.
    { asset: 'claude', patterns: ['claude', 'anthropic', 'sonnet', 'opus', 'haiku', 'fable'] },
    { asset: 'deepseek', patterns: ['deepseek'] },
    { asset: 'gemini', patterns: ['gemini'] },
    // Z.ai still ships `glm-4.6v`; chatglm and zhipu are the older spellings.
    { asset: 'glm', patterns: ['glm', 'chatglm', 'zhipu'] },
    // `o1`/`o3`/`o4` are OpenAI's own short names and never appear alone in another vendor's id.
    { asset: 'gpt', patterns: ['gpt', 'openai', 'chatgpt', 'o1', 'o3', 'o4'] },
    { asset: 'grok', patterns: ['grok'] },
    // Kimi's gateway aliases in the wild are `k3`, `k3-256k`, and `kimi-for-coding`.
    { asset: 'kimi', patterns: ['kimi', 'moonshot', 'k2', 'k3'] },
    { asset: 'qwen', patterns: ['qwen', 'qwq', 'qianwen'] },
];
/** Splits a model id into the words a pattern is matched against. */
const MODEL_WORD_SEPARATOR = /[^a-z0-9]+/;
/**
 * Choose the large image for one model id.
 *
 * Matching is per word rather than per substring: a pattern must be a prefix of
 * a whole word of the model id. Substring matching would let `o1` claim
 * `sao10k/l3.1-euryale-70b` and `o4` claim `upstage/solar-pro4`, which silently
 * shows one vendor's logo for another vendor's model.
 *
 * @param model - model id of the selected route.
 * @param rules - configured rules, in priority order.
 * @returns the matching asset name, or `undefined` when nothing matches.
 */
export function modelImageOf(model, rules) {
    if (model === undefined || rules === undefined)
        return undefined;
    const words = model.toLowerCase().trim().split(MODEL_WORD_SEPARATOR).filter(word => word.length > 0);
    if (words.length === 0)
        return undefined;
    for (const rule of rules) {
        if (rule.asset.trim().length === 0)
            continue;
        for (const pattern of rule.patterns) {
            // A hand-written pattern may carry punctuation the section allows nowhere
            // else; skipping it keeps the remaining rules working.
            const needle = pattern.toLowerCase().trim();
            if (!/^[a-z0-9]+$/.test(needle))
                continue;
            if (words.some(word => word.startsWith(needle)))
                return rule.asset.trim();
        }
    }
    return undefined;
}
/** Discord's own hard limit for `details`, `state`, `large_text`, and `small_text`. */
export const DISCORD_TEXT_LIMIT = 128;
/** Separator between template segments; an empty segment is dropped whole. */
const SEGMENT_SEPARATOR = ' · ';
/** Placeholder syntax: `{name}`. */
const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;
/** Stateless twin of {@link PLACEHOLDER}, safe to use with `RegExp.test`. */
const HAS_PLACEHOLDER = /\{[a-zA-Z][a-zA-Z0-9]*\}/;
/**
 * A parenthesized or bracketed group holding exactly one placeholder, such as
 * `({folder})`. Braces are not group delimiters because they spell placeholders.
 */
const OPTIONAL_GROUP = /\(\s*(\{[a-zA-Z][a-zA-Z0-9]*\})\s*\)|\[\s*(\{[a-zA-Z][a-zA-Z0-9]*\})\s*\]/g;
/** Punctuation left dangling at a segment edge once a placeholder vanished. */
const EDGE_PUNCTUATION = /^[\s,;:/|·\-–—]+|[\s,;:/|·\-–—]+$/g;
/** A bracket pair left holding nothing but separators after substitution. */
const EMPTY_GROUP = /\(\s*[·,;:/|–—-]*\s*\)|\[\s*[·,;:/|–—-]*\s*\]/g;
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
export function formatCompactTokens(value) {
    if (!Number.isFinite(value) || value < 0)
        return '0';
    const rounded = Math.round(value);
    const scaled = (candidate) => candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10);
    if (rounded < 1_000)
        return String(rounded);
    if (rounded < 1_000_000) {
        const thousands = scaled(rounded / 1_000);
        // 999 999 rounds to "1000K", which reads as a different magnitude than 1M.
        return thousands === '1000' ? '1M' : `${thousands}K`;
    }
    const millions = scaled(rounded / 1_000_000);
    return millions === '1000' ? '1B' : `${millions}M`;
}
/**
 * Render the elapsed-timer start time.
 * @param config - display policy.
 * @param snapshot - current snapshot.
 * @returns the epoch-millisecond start, or `undefined` when no timer is shown.
 */
function timerStart(config, snapshot) {
    switch (config.elapsed) {
        case 'off': return undefined;
        case 'turn': return snapshot.turnStart;
        case 'session': return snapshot.sessionStart;
    }
}
/**
 * Built-in English wording for every phase; a configured override replaces one.
 *
 * `{tool}` is substituted in a tool-phase label when the tool may be named.
 */
export const DEFAULT_PHASE_LABELS = {
    approval: 'Awaiting approval',
    compacting: 'Compacting context',
    tool: 'Running {tool}',
    toolHidden: 'Running a tool',
    thinking: 'Thinking',
    working: 'Working',
    queued: 'Queued input',
    idle: 'Idle',
};
/**
 * Describe the current phase in words.
 *
 * @param snapshot - current snapshot.
 * @param showToolNames - whether the running tool may be named.
 * @param labels - phase wording, overriding the built-in English defaults.
 * @returns the phase label, or an empty string for `absent`.
 */
function phaseLabel(snapshot, showToolNames, labels) {
    const text = (key) => {
        const value = labels[key] ?? DEFAULT_PHASE_LABELS[key];
        return value;
    };
    switch (snapshot.phase) {
        case 'approval': return text('approval');
        case 'compacting': return text('compacting');
        case 'tool':
            if (snapshot.toolName === undefined || !showToolNames)
                return text('toolHidden');
            return text('tool').replace(/\{tool\}/g, snapshot.toolName);
        case 'thinking': return text('thinking');
        case 'working': return text('working');
        case 'queued': return text('queued');
        case 'idle': return text('idle');
        case 'absent': return '';
    }
}
/**
 * Build the placeholder value table for one snapshot.
 *
 * An empty value means "hide": {@link expandTemplate} drops the segment that
 * asked for it, so a missing datum shortens the line instead of leaving a gap.
 *
 * @param snapshot - current snapshot.
 * @param showToolNames - whether tool names may be displayed.
 * @param showFolder - whether the working directory name may be displayed.
 * @returns placeholder name to display text.
 */
function placeholders(snapshot, showToolNames, showFolder, labels) {
    return {
        activity: phaseLabel(snapshot, showToolNames, labels),
        model: snapshot.model ?? '',
        provider: snapshot.provider ?? '',
        effort: snapshot.effort ?? '',
        context: contextText(snapshot),
        tokens: usageText(snapshot.usage),
        folder: showFolder ? snapshot.folder ?? '' : '',
        progress: progressText(snapshot),
        turn: snapshot.turn === undefined ? '' : String(snapshot.turn),
        step: snapshot.step === undefined ? '' : String(snapshot.step),
        subagents: snapshot.subagents > 0
            ? `${snapshot.subagents} ${snapshot.subagents === 1 ? 'subagent' : 'subagents'}`
            : '',
    };
}
/**
 * Render the turn/step progress placeholder as one compound value.
 *
 * Keeping both numbers in a single placeholder means an unknown position hides
 * the whole segment instead of leaving a stray `turn .` behind; `{turn}` and
 * `{step}` remain available separately for templates that want one of them.
 *
 * @param snapshot - current snapshot.
 * @returns `turn 4.2`, `step 3`, or an empty string.
 */
function progressText(snapshot) {
    const parts = [];
    if (snapshot.turn !== undefined)
        parts.push(`turn ${snapshot.turn}`);
    if (snapshot.step !== undefined)
        parts.push(`step ${snapshot.step}`);
    return parts.join(' · ');
}
/**
 * Render the context-occupancy placeholder.
 *
 * Degrades from `42.1K/128K (33%)` to `42.1K` when the route advertised no
 * capacity, and to an empty string when no provider usage exists yet.
 *
 * @param snapshot - current snapshot.
 * @returns the display text, possibly empty.
 */
function contextText(snapshot) {
    if (snapshot.contextTokens === undefined)
        return '';
    const used = formatCompactTokens(snapshot.contextTokens);
    const window = snapshot.contextWindow;
    if (window === undefined || window <= 0)
        return used;
    const share = Math.min(100, Math.round((snapshot.contextTokens / window) * 100));
    return `${used}/${formatCompactTokens(window)} (${share}%)`;
}
/**
 * Render the cumulative-usage placeholder for the large-image hover text.
 * @param usage - whole-log provider usage.
 * @returns the display text, or an empty string when nothing was reported.
 */
function usageText(usage) {
    if (usage === undefined)
        return '';
    const cache = usage.cacheReadTokens + usage.cacheWriteTokens;
    const input = usage.uncachedInputTokens + cache;
    if (input === 0 && usage.outputTokens === 0)
        return '';
    // Cache reads usually dominate a long session's input side; naming them
    // separately avoids a bare "in 184K" that hides where it came from.
    const inputPart = cache === 0
        ? `in ${formatCompactTokens(input)}`
        : `in ${formatCompactTokens(input)} (${formatCompactTokens(cache)} cached)`;
    return `${inputPart} · out ${formatCompactTokens(usage.outputTokens)}`;
}
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
export function expandTemplate(template, values) {
    const segments = [];
    for (const rawSegment of template.split(SEGMENT_SEPARATOR)) {
        const rendered = renderSegment(rawSegment, values);
        if (rendered.length > 0)
            segments.push(rendered);
    }
    return segments;
}
/**
 * Render one segment, dropping optional groups and dangling punctuation left by
 * an empty placeholder.
 *
 * A segment carrying placeholders is kept only when at least one of them has a
 * value: a segment made only of labels and hidden values — `turn {turn}` with
 * no turn — would otherwise display a word that describes nothing.
 *
 * @param segment - raw segment text.
 * @param values - placeholder values; empty means "hide".
 * @returns the cleaned segment; empty when nothing but hidden placeholders remained.
 */
function renderSegment(segment, values) {
    const grouped = segment.replace(OPTIONAL_GROUP, (match, paren, bracket) => {
        const name = (paren ?? bracket ?? '').slice(1, -1);
        return (values[name] ?? '').trim().length === 0 ? '' : match;
    });
    let present = false;
    const substituted = grouped.replace(PLACEHOLDER, (_match, name) => {
        const value = values[name] ?? '';
        if (value.trim().length > 0)
            present = true;
        return value;
    });
    if (!present && HAS_PLACEHOLDER.test(segment))
        return '';
    // A group that held several placeholders loses the ones that were empty; an
    // empty remainder must disappear rather than leave `( )` behind.
    return substituted.replace(EMPTY_GROUP, '').replace(EDGE_PUNCTUATION, '').trim();
}
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
export function fitField(text, limit) {
    const trimmed = text.trim();
    if (trimmed.length < 2)
        return undefined;
    const max = Math.min(limit, DISCORD_TEXT_LIMIT);
    if (trimmed.length <= max)
        return trimmed;
    return `${trimmed.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}
/**
 * Render one snapshot into a Discord activity payload.
 *
 * @param snapshot - values read from the session log and live agent.
 * @param config - display policy.
 * @param showToolNames - whether tool names may be displayed.
 * @param showFolder - whether the working directory name may be displayed.
 * @returns the payload, or `undefined` when nothing should be shown at all.
 */
export function renderActivity(snapshot, config, showToolNames, showFolder) {
    if (snapshot.phase === 'absent' && !config.showWhenIdle)
        return undefined;
    const values = placeholders(snapshot, showToolNames, showFolder, config.labels ?? {});
    const limit = Math.min(config.truncateAt, DISCORD_TEXT_LIMIT);
    const activity = {};
    const details = fitField(expandTemplate(config.details, values).join(SEGMENT_SEPARATOR), limit);
    if (details !== undefined)
        activity.details = details;
    const state = fitField(expandTemplate(config.state, values).join(SEGMENT_SEPARATOR), limit);
    if (state !== undefined)
        activity.state = state;
    const start = timerStart(config, snapshot);
    if (start !== undefined && Number.isFinite(start) && start > 0)
        activity.timestamps = { start: Math.round(start) };
    const largeText = fitField(expandTemplate(config.largeText, values).join(SEGMENT_SEPARATOR), limit);
    const smallText = fitField(expandTemplate(config.smallText, values).join(SEGMENT_SEPARATOR), limit);
    const smallImage = workingPhase(snapshot.phase) ? config.smallImageRunning : config.smallImageIdle;
    // The model decides the large image first, so switching models switches the
    // picture; an unrecognised model falls back to the fixed asset, and with no
    // asset at all the slot keeps the application icon.
    const largeImage = modelImageOf(snapshot.model, config.modelImages) ?? config.largeImage;
    // Hover text is emitted even without a configured asset name: the large image
    // slot falls back to the application's own icon, which gives the text a
    // target. A configured name that does not match an uploaded asset is dropped
    // by Discord while the text survives, so sending the text is never the
    // reason a card looks wrong.
    const assets = {
        ...largeImage.length === 0 ? {} : { large_image: largeImage },
        ...largeText === undefined ? {} : { large_text: largeText },
        ...smallImage.length === 0 ? {} : { small_image: smallImage },
        ...smallText === undefined ? {} : { small_text: smallText },
    };
    if (Object.keys(assets).length > 0)
        activity.assets = assets;
    if (activity.details === undefined && activity.state === undefined)
        return undefined;
    return activity;
}
/**
 * Whether a phase means the agent is doing something, which selects the small image.
 * @param phase - phase being displayed.
 * @returns true for every phase except idle and absent.
 */
function workingPhase(phase) {
    return phase !== 'idle' && phase !== 'absent';
}
