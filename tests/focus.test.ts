import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FocusTracker, countSubagents, snapshotOf } from '../src/focus.ts'
import type { ActivityState } from '../src/activity.ts'

/** Minimal agent surface the selection and snapshot code reads. */
function fakeAgent(options: {
  id: string
  status?: 'idle' | 'running'
  subagent?: boolean
  cwd?: string
  model?: string
  provider?: string
  queued?: number
  createdAt?: number
}): Agent {
  const header = {
    id: options.id,
    createdAt: options.createdAt ?? 1_000,
    ...options.cwd === undefined ? {} : { cwd: options.cwd },
    ...options.subagent === true ? { origin: 'subagent' as const } : {},
  }
  const queued = options.queued ?? 0
  return {
    status: options.status ?? 'idle',
    options: {
      ...options.model === undefined ? {} : { model: options.model },
      ...options.provider === undefined ? {} : { provider: options.provider },
    },
    model: {
      current: () => options.model === undefined ? undefined : { provider: options.provider ?? 'p', model: options.model },
    },
    session: { header },
    inbox: {
      nextTurn: Array.from({ length: queued }, () => ({})),
      nextStep: [],
    },
  } as unknown as Agent
}

const idleActivity: ActivityState = {
  turn: null,
  step: null,
  turnStart: null,
  toolName: null,
  approvals: 0,
  compactions: 0,
  model: 'from-log',
  provider: 'from-log-provider',
  effort: null,
  contextWindow: 128_000,
}

test('active focus prefers a running agent over a more recent idle one', () => {
  const tracker = new FocusTracker()
  const idle = fakeAgent({ id: 'idle', status: 'idle' })
  const running = fakeAgent({ id: 'running', status: 'running' })
  tracker.track(idle, 1_000)
  tracker.track(running, 500)
  assert.equal(tracker.select('active', false), running)
})

test('latest focus ignores status and takes the newest activity', () => {
  const tracker = new FocusTracker()
  const idle = fakeAgent({ id: 'idle', status: 'idle' })
  const running = fakeAgent({ id: 'running', status: 'running' })
  tracker.track(running, 500)
  tracker.track(idle, 1_000)
  assert.equal(tracker.select('latest', false), idle)
})

test('subagents are skipped unless they are allowed, with a fallback', () => {
  const tracker = new FocusTracker()
  const parent = fakeAgent({ id: 'parent' })
  const child = fakeAgent({ id: 'child', subagent: true })
  tracker.track(parent, 500)
  tracker.track(child, 1_000)
  assert.equal(tracker.select('latest', false), parent)
  assert.equal(tracker.select('latest', true), child)

  const onlyChild = new FocusTracker()
  onlyChild.track(child, 1_000)
  assert.equal(onlyChild.select('latest', false), child, 'the only live agent is shown even when delegated')
})

test('a disposed agent leaves the ranking', () => {
  const tracker = new FocusTracker()
  const first = fakeAgent({ id: 'first' })
  const second = fakeAgent({ id: 'second' })
  tracker.track(first, 1_000)
  tracker.track(second, 2_000)
  tracker.forget(second)
  assert.deepEqual(tracker.ranked(), [first])
  assert.equal(tracker.select('latest', false), first)
})

test('touching an untracked agent does not enroll it', () => {
  const tracker = new FocusTracker()
  const agent = fakeAgent({ id: 'a' })
  tracker.touch(agent, 5_000)
  assert.equal(tracker.select('latest', false), undefined)
})

test('subagents are counted apart from the displayed agent', () => {
  const parent = fakeAgent({ id: 'parent' })
  const child = fakeAgent({ id: 'child', subagent: true })
  const other = fakeAgent({ id: 'other', subagent: true })
  assert.equal(countSubagents([parent, child, other], parent), 2)
  assert.equal(countSubagents([parent, child, other], child), 1)
})

test('a snapshot carries the live route and the folded capacity', () => {
  const agent = fakeAgent({ id: 'a', cwd: '/work/dsh', model: 'kimi-for-coding', provider: 'mclans' })
  const snapshot = snapshotOf(agent, idleActivity, { contextTokens: 5_000, usage: {
    uncachedInputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 0,
  } }, 1)
  assert.equal(snapshot.model, 'kimi-for-coding')
  assert.equal(snapshot.provider, 'mclans')
  assert.equal(snapshot.contextWindow, 128_000)
  assert.equal(snapshot.contextTokens, 5_000)
  assert.equal(snapshot.folder, 'dsh')
  assert.equal(snapshot.subagents, 1)
  assert.equal(snapshot.phase, 'idle')
})

test('the live route wins over the one recorded in the log', () => {
  const agent = fakeAgent({ id: 'a' })
  const snapshot = snapshotOf(agent, idleActivity, {}, 0)
  assert.equal(snapshot.model, 'from-log')
  assert.equal(snapshot.provider, 'from-log-provider')
})

test('queued input turns an idle agent into a queued one', () => {
  const agent = fakeAgent({ id: 'a', queued: 2 })
  assert.equal(snapshotOf(agent, idleActivity, {}, 0).phase, 'queued')
})

test('a missing projection leaves its field off the snapshot', () => {
  const agent = fakeAgent({ id: 'a' })
  const snapshot = snapshotOf(agent, idleActivity, {}, 0)
  assert.equal(snapshot.usage, undefined)
  assert.equal(snapshot.contextTokens, undefined)
  assert.equal(snapshot.folder, undefined)
})
