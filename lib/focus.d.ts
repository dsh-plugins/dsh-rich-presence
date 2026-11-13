/**
 * Choosing which live agent the presence describes, and reading its state.
 *
 * Discord has one presence per user, but DSH may run several agents at once
 * (a top-level session plus the subagents it delegates to). This module picks
 * the session worth showing and turns it into a {@link PresenceSnapshot}.
 *
 * @module dsh-rich-presence/focus
 */
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Session } from '@deepseek-ai/dsh-session';
import type { ActivityState } from './activity.ts';
import type { PresenceSnapshot, UsageTotals } from './render.ts';
/** How to break a tie between several live agents. */
export type FocusMode = 'active' | 'latest';
/** Projection values the snapshot reads, all optional because token-meter may be absent. */
export interface ProjectionReadout {
    /** Whole-log provider usage, when the token-meter projection is mounted. */
    usage?: UsageTotals;
    /** Latest provider-reported prompt size, when the token-meter projection is mounted. */
    contextTokens?: number;
}
/**
 * Track the live agents and the last time each one did something.
 *
 * An agent becomes a candidate when it is created and stops being one when it
 * is disposed, so a closed session cannot hold the presence.
 */
export declare class FocusTracker {
    private readonly agents;
    /**
     * Record one live agent.
     * @param agent - the agent that was created.
     * @param now - epoch milliseconds of the observation.
     */
    track(agent: Agent, now?: number): void;
    /**
     * Record activity on one agent, so `active` focus prefers it later.
     * @param agent - the agent that did something.
     * @param now - epoch milliseconds of the observation.
     */
    touch(agent: Agent, now?: number): void;
    /**
     * Stop tracking a disposed agent.
     * @param agent - the agent that was disposed.
     */
    forget(agent: Agent): void;
    /**
     * Every tracked agent, newest activity first.
     * @returns a fresh array of live agents.
     */
    ranked(): Agent[];
    /**
     * Choose the agent to describe.
     *
     * `active` prefers an agent that is currently running over a more recently
     * touched idle one: the presence should follow the work, not the clock.
     * Subagents are excluded unless asked for, because the parent session is the
     * one the user opened.
     *
     * @param mode - tie-breaking rule.
     * @param includeSubagents - whether delegated sessions may be displayed.
     * @returns the chosen agent, or `undefined` when none qualifies.
     */
    select(mode: FocusMode, includeSubagents: boolean): Agent | undefined;
}
/**
 * Read the durable activity facts for one session.
 * @param handle - the registered activity projection handle.
 * @param session - the session to read.
 * @returns the folded state; the empty state when the unit has no cell yet.
 */
export declare function readActivity(handle: {
    stateOf(session: Session): ActivityState;
}, session: Session): ActivityState;
/**
 * Count the live sessions a set of tracked agents does not include.
 * @param tracked - the agents this plugin knows about.
 * @param subject - the agent being displayed, which is not one of its own subagents.
 * @returns the number of other delegated sessions among them.
 */
export declare function countSubagents(tracked: readonly Agent[], subject: Agent): number;
/**
 * Build a snapshot from one agent and its projections.
 *
 * Each datum degrades independently: a missing projection removes one segment
 * from the display instead of blanking the whole presence.
 *
 * @param agent - the agent to describe.
 * @param activity - its folded activity state.
 * @param readout - optional token-meter values for the same session.
 * @param subagents - how many delegated sessions are live alongside it.
 * @returns the snapshot the renderer consumes.
 */
export declare function snapshotOf(agent: Agent, activity: ActivityState, readout: ProjectionReadout, subagents: number): PresenceSnapshot;
