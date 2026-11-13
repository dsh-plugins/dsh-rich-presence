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
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
/** The projection key this unit owns; host-only, so no client view exists. */
export declare const ACTIVITY_KEY = "richPresenceActivity";
/** Which phase the agent was in. */
export type AgentPhase = 'approval' | 'compacting' | 'tool' | 'thinking' | 'working' | 'idle';
/** Folded lifecycle facts for one session. */
export interface ActivityState {
    /** Turn that has started and not ended, when one is open. */
    turn: number | null;
    /** Step that has started and not ended, when one is open. */
    step: number | null;
    /** Epoch milliseconds of the open turn's start. */
    turnStart: number | null;
    /** Name of the tool whose `tool/call` has no `tool/result` yet. */
    toolName: string | null;
    /** Approvals asked and not yet answered. */
    approvals: number;
    /** Compactions started and not yet ended. */
    compactions: number;
    /** Model id recorded by the newest `request/header`. */
    model: string | null;
    /** Provider id recorded by the newest `request/header`. */
    provider: string | null;
    /** Reasoning effort recorded by the newest `request/header`. */
    effort: string | null;
    /** Route capacity recorded by the newest `request/context` or `request/header`. */
    contextWindow: number | null;
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
export declare function applyActivity(state: ActivityState, event: SessionEvent): ActivityState;
/**
 * Build the projection definition for the activity unit.
 * @returns the definition to register on the projection registry.
 */
export declare function activityProjection(): ProjectionDefinition<typeof ACTIVITY_KEY, ActivityState>;
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
export declare function phaseOf(state: ActivityState): AgentPhase;
