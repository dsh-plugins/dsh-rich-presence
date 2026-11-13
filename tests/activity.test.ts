import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ActivityState } from '../src/activity.ts'
import { applyActivity, phaseOf } from '../src/activity.ts'

/** Build a minimal committed event for the fold. */
function event(type: string, data: Record<string, unknown>, time = 1_000): SessionEvent {
  return { type, seq: 0, time, data } as unknown as SessionEvent
}

/** The empty state, spelled out so a fold bug cannot hide behind a helper. */
const empty: ActivityState = {
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
}

/** Fold a sequence of events from the empty state. */
function fold(events: SessionEvent[]): ActivityState {
  return events.reduce(applyActivity, empty)
}

test('an uninteresting event returns the same reference', () => {
  const first = applyActivity(empty, event('user/message', { role: 'user' }))
  assert.equal(first, empty)
  const second = applyActivity(empty, event('assistant/message', {}))
  assert.equal(second, empty)
})

test('a turn opens with its start time and closes to the empty state', () => {
  const open = fold([event('turn/start', { turn: 3 }, 5_000)])
  assert.equal(open.turn, 3)
  assert.equal(open.turnStart, 5_000)
  assert.equal(phaseOf(open), 'working')

  const closed = fold([event('turn/start', { turn: 3 }, 5_000), event('turn/end', { turn: 3 })])
  assert.deepEqual(closed, empty)
  assert.equal(phaseOf(closed), 'idle')
})

test('a repeated turn/start does not rewrite the start time', () => {
  const once = fold([event('turn/start', { turn: 1 }, 5_000)])
  const twice = applyActivity(once, event('turn/start', { turn: 1 }, 9_000))
  assert.equal(twice, once)
})

test('a step outranks an open turn, and a tool outranks both', () => {
  const stepping = fold([event('turn/start', { turn: 1 }), event('step/start', { turn: 1, step: 2 })])
  assert.equal(stepping.step, 2)
  assert.equal(phaseOf(stepping), 'thinking')

  const running = applyActivity(stepping, event('tool/call', { turn: 1, step: 2, callId: 'c1', name: 'Bash' }))
  assert.equal(running.toolName, 'Bash')
  assert.equal(phaseOf(running), 'tool')

  const done = applyActivity(running, event('tool/result', { turn: 1, step: 2 }))
  assert.equal(done.toolName, null)
  assert.equal(phaseOf(done), 'thinking')
})

test('a step end clears a tool call that never reported a result', () => {
  const state = fold([
    event('turn/start', { turn: 1 }),
    event('step/start', { turn: 1, step: 1 }),
    event('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'Bash' }),
    event('step/end', { turn: 1, step: 1 }),
  ])
  assert.equal(state.toolName, null)
  assert.equal(state.step, null)
})

test('approvals count up and down and never go negative', () => {
  const asked = fold([event('approval/asked', { id: 'a' }), event('approval/asked', { id: 'b' })])
  assert.equal(asked.approvals, 2)
  assert.equal(phaseOf(asked), 'approval')

  const denied = applyActivity(asked, event('approval/decided', { id: 'a' }))
  assert.equal(denied.approvals, 1)

  const extra = applyActivity(applyActivity(denied, event('approval/decided', {})), event('approval/decided', {}))
  assert.equal(extra.approvals, 0)
  assert.equal(applyActivity(empty, event('approval/decided', {})), empty)
})

test('compaction outranks a running tool', () => {
  const state = fold([
    event('turn/start', { turn: 1 }),
    event('step/start', { turn: 1, step: 1 }),
    event('tool/call', { turn: 1, step: 1, callId: 'c', name: 'Bash' }),
    event('compaction/start', { compactionId: 'k' }),
  ])
  assert.equal(phaseOf(state), 'compacting')
  assert.equal(phaseOf(applyActivity(state, event('compaction/end', { compactionId: 'k' }))), 'tool')
})

test('an approval outranks compaction', () => {
  const state = fold([
    event('compaction/start', { compactionId: 'k' }),
    event('approval/asked', { id: 'a' }),
  ])
  assert.equal(phaseOf(state), 'approval')
})

test('a request header records the route and its capacity', () => {
  const state = fold([
    event('request/header', {
      header: { config: { provider: 'mclans', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' }, context: { contextWindow: 128_000 } },
    }),
  ])
  assert.equal(state.provider, 'mclans')
  assert.equal(state.model, 'deepseek-v4.1-flash')
  assert.equal(state.effort, 'high')
  assert.equal(state.contextWindow, 128_000)
})

test('request/context supplies capacity on its own', () => {
  const state = fold([event('request/context', { provider: 'p', model: 'm', contextWindow: 256_000 })])
  assert.equal(state.contextWindow, 256_000)
  assert.equal(state.model, null, 'capacity alone does not name a route')
})

test('a malformed payload is ignored instead of throwing', () => {
  const cases: SessionEvent[] = [
    event('turn/start', {}),
    event('turn/start', { turn: 'three' }),
    event('step/start', {}),
    event('tool/call', { name: '' }),
    event('request/header', { header: 'not-a-header' }),
    event('request/context', { contextWindow: -5 }),
    event('turn/end', null as unknown as Record<string, unknown>),
  ]
  for (const malformed of cases) {
    assert.doesNotThrow(() => applyActivity(empty, malformed))
  }
})

test('a header without a route keeps the previous one', () => {
  const established = fold([
    event('request/header', { header: { config: { provider: 'p', model: 'm' } } }),
  ])
  const later = applyActivity(established, event('request/header', { header: { config: {} } }))
  assert.equal(later, established)
})
