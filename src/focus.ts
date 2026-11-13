/**
 * Choosing which live agent the presence describes, and reading its state.
 *
 * Discord has one presence per user, but DSH may run several agents at once
 * (a top-level session plus the subagents it delegates to). This module picks
 * the session worth showing and turns it into a {@link PresenceSnapshot}.
 *
 * @module dsh-rich-presence/focus
 */

import { basename } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ActivityState } from './activity.ts'
import { phaseOf } from './activity.ts'
import type { PresenceSnapshot, UsageTotals } from './render.ts'

/** How to break a tie between several live agents. */
export type FocusMode = 'active' | 'latest'

/** Projection values the snapshot reads, all optional because token-meter may be absent. */
export interface ProjectionReadout {
  /** Whole-log provider usage, when the token-meter projection is mounted. */
  usage?: UsageTotals
  /** Latest provider-reported prompt size, when the token-meter projection is mounted. */
  contextTokens?: number
}

/**
 * Track the live agents and the last time each one did something.
 *
 * An agent becomes a candidate when it is created and stops being one when it
 * is disposed, so a closed session cannot hold the presence.
 */
export class FocusTracker {
  private readonly agents = new Map<Agent, number>()

  /**
   * Record one live agent.
   * @param agent - the agent that was created.
   * @param now - epoch milliseconds of the observation.
   */
  track(agent: Agent, now: number = Date.now()): void {
    this.agents.set(agent, now)
  }

  /**
   * Record activity on one agent, so `active` focus prefers it later.
   * @param agent - the agent that did something.
   * @param now - epoch milliseconds of the observation.
   */
  touch(agent: Agent, now: number = Date.now()): void {
    if (this.agents.has(agent)) this.agents.set(agent, now)
  }

  /**
   * Stop tracking a disposed agent.
   * @param agent - the agent that was disposed.
   */
  forget(agent: Agent): void {
    this.agents.delete(agent)
  }

  /**
   * Every tracked agent, newest activity first.
   * @returns a fresh array of live agents.
   */
  ranked(): Agent[] {
    return [...this.agents.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([agent]) => agent)
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
  select(mode: FocusMode, includeSubagents: boolean): Agent | undefined {
    const ranked = this.ranked().filter(agent => includeSubagents || agent.session.header.origin !== 'subagent')
    const candidates = ranked.length === 0 ? this.ranked() : ranked
    if (mode === 'latest') return candidates[0]
    return candidates.find(agent => agent.status === 'running') ?? candidates[0]
  }
}

/**
 * Read the durable activity facts for one session.
 * @param handle - the registered activity projection handle.
 * @param session - the session to read.
 * @returns the folded state; the empty state when the unit has no cell yet.
 */
export function readActivity(
  handle: { stateOf(session: Session): ActivityState },
  session: Session,
): ActivityState {
  return handle.stateOf(session)
}

/**
 * Read whether any input is waiting for the agent.
 * @param agent - the agent to inspect.
 * @returns whether a turn or a step has pending input.
 */
function hasQueuedInput(agent: Agent): boolean {
  const inbox = agent.inbox
  return inbox.nextTurn.length > 0 || inbox.nextStep.length > 0
}

/**
 * Resolve the model route currently selected for the agent.
 * @param agent - the agent to inspect.
 * @param activity - folded activity, used when the agent has no live selection.
 * @returns the route fields that are known.
 */
function routeOf(agent: Agent, activity: ActivityState): { model?: string; provider?: string; effort?: string } {
  const current = agent.model.current()
  const model = current?.model ?? activity.model ?? agent.options.model
  const provider = current?.provider ?? activity.provider ?? agent.options.provider
  const effort = current?.reasoningEffort ?? activity.effort ?? agent.options.reasoningEffort
  return {
    ...typeof model === 'string' && model.length > 0 ? { model } : {},
    ...typeof provider === 'string' && provider.length > 0 ? { provider } : {},
    ...typeof effort === 'string' && effort.length > 0 ? { effort } : {},
  }
}

/**
 * Count the live sessions a set of tracked agents does not include.
 * @param tracked - the agents this plugin knows about.
 * @param subject - the agent being displayed, which is not one of its own subagents.
 * @returns the number of other delegated sessions among them.
 */
export function countSubagents(tracked: readonly Agent[], subject: Agent): number {
  return tracked.filter(agent => agent !== subject && agent.session.header.origin === 'subagent').length
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
export function snapshotOf(
  agent: Agent,
  activity: ActivityState,
  readout: ProjectionReadout,
  subagents: number,
): PresenceSnapshot {
  const session = agent.session
  const folder = session.header.cwd
  const base = phaseOf(activity)
  const phase: PresenceSnapshot['phase'] = base === 'idle' && hasQueuedInput(agent) ? 'queued' : base
  const route = routeOf(agent, activity)
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
  }
}
