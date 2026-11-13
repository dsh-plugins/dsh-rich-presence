/**
 * The host-only projection unit that folds a session log into one activity
 * state.
 *
 * Every value the presence shows comes from committed events, so a reopened
 * session derives the same phase and position it had before: `apply` is pure
 * and returns the same reference for events it does not care about, which
 * makes an unchanged log free.
 *
 * Events belonging to other packages — approvals and compaction — are read
 * structurally rather than through their module declarations. The fold runs
 * over every committed event of every session, so an unfamiliar payload must
 * degrade to "not interesting" instead of throwing and failing the projection.
 *
 * @module dsh-rich-presence/activity
 */
import { z } from 'zod';
/** The projection key this unit owns; host-only, so no client view exists. */
export const ACTIVITY_KEY = 'richPresenceActivity';
/** The state schema; the registry validates a restored checkpoint against it. */
const activityStateSchema = z.object({
    turn: z.number().int().nonnegative().nullable(),
    step: z.number().int().nonnegative().nullable(),
    turnStart: z.number().int().nonnegative().nullable(),
    toolName: z.string().nullable(),
    approvals: z.number().int().nonnegative(),
    compactions: z.number().int().nonnegative(),
    model: z.string().nullable(),
    provider: z.string().nullable(),
    effort: z.string().nullable(),
    contextWindow: z.number().int().positive().nullable(),
});
/**
 * The empty activity state for a session with no events yet.
 * @returns a fresh state; never shared between sessions.
 */
function initialState() {
    return {
        turn: null,
        step: null,
        turnStart: null,
        toolName: null,
        approvals: 0,
        compactions: 0,
        model: null,
        provider: null,
        effort: null,
        contextWindow: null,
    };
}
/**
 * Read a non-negative integer field.
 * @param data - event payload.
 * @param key - field name.
 * @returns the value, or `undefined` when absent or not a non-negative integer.
 */
function readCount(data, key) {
    const value = data[key];
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
/**
 * Read a non-empty string field.
 * @param data - event payload.
 * @param key - field name.
 * @returns the value, or `undefined` when absent or not a non-empty string.
 */
function readName(data, key) {
    const value = data[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
/**
 * Read the model route recorded in one request header.
 * @param header - the `header` field of a `request/header` event.
 * @returns whichever route fields the header carries.
 */
function routeOf(header) {
    if (typeof header !== 'object' || header === null)
        return {};
    const config = header.config;
    if (typeof config !== 'object' || config === null)
        return {};
    const record = config;
    const model = readName(record, 'model');
    const provider = readName(record, 'provider');
    const effort = readName(record, 'reasoningEffort');
    return {
        ...model === undefined ? {} : { model },
        ...provider === undefined ? {} : { provider },
        ...effort === undefined ? {} : { effort },
    };
}
/**
 * Read the route capacity a context or header event carries.
 * @param event - structural event view.
 * @returns the capacity in tokens, or `undefined` when the event carries none.
 */
function windowOf(event) {
    if (event.type === 'request/context') {
        const value = event.data.contextWindow;
        return typeof value === 'number' && value > 0 ? value : undefined;
    }
    const header = event.data.header;
    if (typeof header !== 'object' || header === null)
        return undefined;
    const context = header.context;
    if (typeof context !== 'object' || context === null)
        return undefined;
    const value = context.contextWindow;
    return typeof value === 'number' && value > 0 ? value : undefined;
}
/**
 * Fold one event into the activity state.
 *
 * The state is treated as immutable: an event that changes nothing returns the
 * same reference so the projection registry performs no downstream work.
 *
 * @param state - state covering every earlier event.
 * @param event - the next committed event.
 * @returns the next state, or `state` when the event is uninteresting.
 */
export function applyActivity(state, event) {
    const view = event;
    const data = view.data;
    if (typeof view.type !== 'string' || typeof data !== 'object' || data === null)
        return state;
    switch (view.type) {
        case 'turn/start': {
            const turn = readCount(data, 'turn');
            if (turn === undefined || state.turn === turn)
                return state;
            return { ...state, turn, turnStart: view.time, step: null, toolName: null };
        }
        case 'turn/end':
            if (state.turn === null && state.step === null && state.toolName === null)
                return state;
            return { ...state, turn: null, step: null, turnStart: null, toolName: null };
        case 'step/start': {
            const step = readCount(data, 'step');
            const turn = readCount(data, 'turn');
            if (step === undefined)
                return state;
            const nextTurn = turn ?? state.turn;
            if (state.step === step && state.turn === nextTurn)
                return state;
            return { ...state, step, turn: nextTurn };
        }
        case 'step/end':
            return state.step === null && state.toolName === null ? state : { ...state, step: null, toolName: null };
        case 'tool/call': {
            const name = readName(data, 'name');
            if (name === undefined || state.toolName === name)
                return state;
            return { ...state, toolName: name };
        }
        case 'tool/result':
            return state.toolName === null ? state : { ...state, toolName: null };
        case 'approval/asked':
            return { ...state, approvals: state.approvals + 1 };
        case 'approval/decided':
            return state.approvals === 0 ? state : { ...state, approvals: state.approvals - 1 };
        case 'compaction/start':
            return { ...state, compactions: state.compactions + 1 };
        case 'compaction/end':
            return state.compactions === 0 ? state : { ...state, compactions: state.compactions - 1 };
        case 'request/header': {
            const route = routeOf(data.header);
            const contextWindow = windowOf(view) ?? state.contextWindow;
            const model = route.model ?? state.model;
            const provider = route.provider ?? state.provider;
            const effort = route.effort ?? null;
            if (model === state.model && provider === state.provider
                && effort === state.effort && contextWindow === state.contextWindow)
                return state;
            return { ...state, model, provider, effort, contextWindow };
        }
        case 'request/context': {
            const contextWindow = windowOf(view);
            if (contextWindow === undefined || contextWindow === state.contextWindow)
                return state;
            return { ...state, contextWindow };
        }
        default:
            return state;
    }
}
/**
 * Build the projection definition for the activity unit.
 * @returns the definition to register on the projection registry.
 */
export function activityProjection() {
    return {
        key: ACTIVITY_KEY,
        stateSchema: activityStateSchema,
        // Bump whenever a field is added, removed, or folded differently, so a
        // persisted checkpoint from an older build is discarded instead of seeding
        // the fold with a shape it no longer produces.
        stateVersion: 1,
        // Header and inherited count are accepted but not folded: a resumed session
        // re-derives its open turn from the log tail, and no metadata survives.
        init: (_header, _inheritedEventCount) => initialState(),
        apply: applyActivity,
    };
}
/**
 * Reduce one activity state to the phase the presence displays.
 *
 * Approval outranks compaction because an unanswered question blocks the user,
 * and both outrank ordinary work because they explain why the agent is not
 * making progress. A tool outranks an open step because the step spends most of
 * its life streaming, which reads better as "thinking" until a tool is running.
 *
 * @param state - folded lifecycle facts.
 * @returns the phase to display; `idle` when nothing is in flight.
 */
export function phaseOf(state) {
    if (state.approvals > 0)
        return 'approval';
    if (state.compactions > 0)
        return 'compacting';
    if (state.toolName !== null)
        return 'tool';
    if (state.step !== null)
        return 'thinking';
    if (state.turn !== null)
        return 'working';
    return 'idle';
}
