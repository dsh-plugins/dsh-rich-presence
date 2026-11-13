/**
 * Choosing which live agent the presence describes, and reading its state.
 *
 * Discord has one presence per user, but DSH may run several agents at once
 * (a top-level session plus the subagents it delegates to). This module picks
 * the session worth showing and turns it into a {@link PresenceSnapshot}.
 *
 * @module dsh-rich-presence/focus
 */
import { basename } from 'node:path';
import { phaseOf } from "./activity.js";
/**
 * Track the live agents and the last time each one did something.
 *
 * An agent becomes a candidate when it is created and stops being one when it
 * is disposed, so a closed session cannot hold the presence.
 */
export class FocusTracker {
    agents = new Map();
    /**
     * Record one live agent.
     * @param agent - the agent that was created.
     * @param now - epoch milliseconds of the observation.
     */
    track(agent, now = Date.now()) {
        this.agents.set(agent, now);
    }
    /**
     * Record activity on one agent, so `active` focus prefers it later.
     * @param agent - the agent that did something.
     * @param now - epoch milliseconds of the observation.
     */
    touch(agent, now = Date.now()) {
        if (this.agents.has(agent))
            this.agents.set(agent, now);
    }
    /**
     * Stop tracking a disposed agent.
     * @param agent - the agent that was disposed.
     */
    forget(agent) {
        this.agents.delete(agent);
    }
    /**
     * Every tracked agent, newest activity first.
     * @returns a fresh array of live agents.
     */
    ranked() {
        return [...this.agents.entries()]
            .sort((left, right) => right[1] - left[1])
            .map(([agent]) => agent);
    }
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
    select(mode, includeSubagents) {
        const ranked = this.ranked().filter(agent => includeSubagents || agent.session.header.origin !== 'subagent');
        const candidates = ranked.length === 0 ? this.ranked() : ranked;
        if (mode === 'latest')
            return candidates[0];
        return candidates.find(agent => agent.status === 'running') ?? candidates[0];
    }
}
/**
 * Read the durable activity facts for one session.
 * @param handle - the registered activity projection handle.
 * @param session - the session to read.
 * @returns the folded state; the empty state when the unit has no cell yet.
 */
export function readActivity(handle, session) {
    return handle.stateOf(session);
}
/**
 * Read whether any input is waiting for the agent.
 * @param agent - the agent to inspect.
 * @returns whether a turn or a step has pending input.
 */
function hasQueuedInput(agent) {
    const inbox = agent.inbox;
    return inbox.nextTurn.length > 0 || inbox.nextStep.length > 0;
}
/**
 * Resolve the model route currently selected for the agent.
 * @param agent - the agent to inspect.
 * @param activity - folded activity, used when the agent has no live selection.
 * @returns the route fields that are known.
 */
function routeOf(agent, activity) {
    const current = agent.model.current();
    const model = current?.model ?? activity.model ?? agent.options.model;
    const provider = current?.provider ?? activity.provider ?? agent.options.provider;
    const effort = current?.reasoningEffort ?? activity.effort ?? agent.options.reasoningEffort;
    return {
        ...typeof model === 'string' && model.length > 0 ? { model } : {},
        ...typeof provider === 'string' && provider.length > 0 ? { provider } : {},
        ...typeof effort === 'string' && effort.length > 0 ? { effort } : {},
    };
}
/**
 * Count the live sessions a set of tracked agents does not include.
 * @param tracked - the agents this plugin knows about.
 * @param subject - the agent being displayed, which is not one of its own subagents.
 * @returns the number of other delegated sessions among them.
 */
export function countSubagents(tracked, subject) {
    return tracked.filter(agent => agent !== subject && agent.session.header.origin === 'subagent').length;
}
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
export function snapshotOf(agent, activity, readout, subagents) {
    const session = agent.session;
    const folder = session.header.cwd;
    const base = phaseOf(activity);
    const phase = base === 'idle' && hasQueuedInput(agent) ? 'queued' : base;
    const route = routeOf(agent, activity);
    return {
        phase,
        ...phase === 'tool' && activity.toolName !== null ? { toolName: activity.toolName } : {},
        ...route,
        ...readout.contextTokens === undefined ? {} : { contextTokens: readout.contextTokens },
        ...activity.contextWindow === null ? {} : { contextWindow: activity.contextWindow },
        ...readout.usage === undefined ? {} : { usage: readout.usage },
        ...folder === undefined || folder.length === 0 ? {} : { folder: basename(folder) },
        ...activity.turn === null ? {} : { turn: activity.turn },
        ...activity.step === null ? {} : { step: activity.step },
        subagents,
        sessionStart: session.header.createdAt,
        ...activity.turnStart === null ? {} : { turnStart: activity.turnStart },
    };
}
