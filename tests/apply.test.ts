import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { Config, apply } from '../src/index.ts'

/**
 * A stub Harness context with just the surfaces `apply` touches.
 *
 * The projection registry folds a supplied event list on registration, so the
 * test exercises the same path the running server uses: fold → focus → snapshot
 * → render → transport.
 */
function harness(options: {
  events?: { type: string; seq: number; time: number; data: Record<string, unknown> }[]
  tokens?: { usage?: Record<string, number>; contextTokens?: number }
  agent?: boolean
} = {}) {
  const logs: { level: string; message: string; args: unknown[] }[] = []
  const payloads: unknown[] = []
  const folded = new Map<unknown, unknown>()
  const agent = {
    status: 'running',
    options: {},
    model: { current: () => ({ provider: 'mclans', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' }) },
    inbox: { nextTurn: [], nextStep: [] },
    session: {
      id: 'session-test',
      header: { id: 'session-test', createdAt: 1_790_000_000_000, cwd: '/work/dsh' },
    },
  } as unknown as Agent
  const projections = {
    register: async (definition: {
      key: string
      init: (header: unknown, inherited: number) => unknown
      apply: (state: unknown, event: unknown) => unknown
    }) => {
      const session = agent.session as unknown
      let state = definition.init(agent.session.header, 0)
      for (const event of options.events ?? []) state = definition.apply(state, event)
      folded.set(session, state)
      return { stateOf: (target: unknown) => folded.get(target), dispose: async () => {} }
    },
    snapshot: () => ({
      asOfSeq: 5,
      values: {
        ...options.tokens?.usage === undefined ? {} : { tokenUsage: options.tokens.usage },
        ...options.tokens?.contextTokens === undefined
          ? {}
          : { contextPressure: { pressureTokens: options.tokens.contextTokens } },
      },
    }),
  }
  const ctx = {
    logger: () => ({
      info: (message: string, ...args: unknown[]) => logs.push({ level: 'info', message, args }),
      warn: (message: string, ...args: unknown[]) => logs.push({ level: 'warn', message, args }),
      debug: () => {},
    }),
    effect: (factory: () => (() => void) | void) => { factory() },
    on: () => {},
    get: (name: string) => name === 'sessionProjections' ? projections : undefined,
    agents: {
      list: () => options.agent === false ? [] : [agent],
      get: (id: string) => options.agent === false ? undefined : id === agent.session.id ? agent : undefined,
    },
    sessionProjections: projections,
    transportSink: payloads,
  }
  return { ctx: ctx as unknown as Context, logs, payloads }
}

/** The logs the log transport produced, parsed back into payloads. */
function payloadsFrom(logs: { message: string; args: unknown[] }[]): unknown[] {
  return logs
    .filter(entry => entry.message.includes('log transport'))
    .map(entry => JSON.parse(String(entry.args.at(-1))))
}

/** The built-in scenario: a turn with a tool in flight. */
const busyEvents = [
  { type: 'turn/start', seq: 1, time: 1_790_000_000_000, data: { turn: 1 } },
  { type: 'step/start', seq: 2, time: 1_790_000_000_100, data: { turn: 1, step: 2 } },
  { type: 'request/header', seq: 3, time: 1_790_000_000_200, data: {
    header: { config: { provider: 'mclans', model: 'deepseek-v4.1-flash', reasoningEffort: 'high' } },
    reason: 'initial',
  } },
  { type: 'tool/call', seq: 4, time: 1_790_000_000_300, data: { turn: 1, step: 2, callId: 'c1', name: 'Bash' } },
]

test('the default configuration renders a busy session with every visible field', async () => {
  const { ctx, logs } = harness({
    events: busyEvents,
    tokens: { usage: { uncachedInputTokens: 82_300, outputTokens: 12_100, cacheReadTokens: 3_400, cacheWriteTokens: 0 }, contextTokens: 42_100 },
  })
  apply(ctx, new Config({}) as Config)
  await new Promise(resolve => setTimeout(resolve, 700))

  const payloads = payloadsFrom(logs)
  assert.equal(payloads.length, 1, 'one activity is published for the settled state')
  assert.deepEqual(payloads[0], {
    type: 0,
    details: 'Running Bash · dsh',
    state: 'deepseek-v4.1-flash · 42.1K · in 85.7K (3.4K cached) · out 12.1K',
    timestamps: { start: 1_790_000_000_000 },
    assets: { large_text: 'turn 1 · step 2', small_text: 'Running Bash' },
  })
})

test('without token-meter the related segments disappear instead of showing placeholders', async () => {
  const { ctx, logs } = harness({ events: busyEvents })
  apply(ctx, new Config({}) as Config)
  await new Promise(resolve => setTimeout(resolve, 700))

  const payloads = payloadsFrom(logs)
  assert.equal(payloads.length, 1)
  const payload = payloads[0] as { details: string; state: string }
  assert.equal(payload.details, 'Running Bash · dsh')
  assert.equal(payload.state, 'deepseek-v4.1-flash', 'no context and no usage segments remain')
})

test('with no live agent the card says Idle, and the log transport explains why it is used', async () => {
  const { ctx, logs } = harness({ agent: false })
  apply(ctx, new Config({}) as Config)
  await new Promise(resolve => setTimeout(resolve, 700))

  const payloads = payloadsFrom(logs)
  assert.deepEqual(payloads, [{ type: 0, details: 'Idle', assets: { small_text: 'Idle' } }])
  assert.ok(
    logs.some(entry => entry.level === 'info' && entry.message.includes('no discord.clientId configured')),
    'the operator is told why nothing reaches Discord',
  )
})

test('showWhenIdle: false clears the presence when no agent is live', async () => {
  const { ctx, logs } = harness({ agent: false })
  apply(ctx, new Config({ presence: { showWhenIdle: false } }) as Config)
  await new Promise(resolve => setTimeout(resolve, 700))

  const payloads = payloadsFrom(logs)
  assert.deepEqual(payloads, [null], 'the presence is cleared, never drawn as a card')
})

test('privacy switches remove the tool name and the folder from the payload', async () => {
  const { ctx, logs } = harness({ events: busyEvents })
  apply(ctx, new Config({ privacy: { showToolNames: false, showFolder: false } }) as Config)
  await new Promise(resolve => setTimeout(resolve, 700))

  const payload = payloadsFrom(logs)[0] as { details: string; state?: string }
  assert.equal(payload.details, 'Running a tool')
  assert.ok(!JSON.stringify(payload).includes('dsh'), 'the folder name never reaches the payload')
})

test('buttons are capped at two and must be absolute links', async () => {
  const { ctx, logs } = harness({ events: busyEvents })
  apply(ctx, new Config({
    discord: {
      buttons: [
        { label: 'Repo', url: 'https://example.com/repo' },
        { label: 'Docs', url: 'https://example.com/docs' },
        { label: 'Dropped', url: 'https://example.com/third' },
        { label: 'Local', url: 'file:///tmp/x' },
      ],
    },
  }) as Config)
  await new Promise(resolve => setTimeout(resolve, 700))

  const payload = payloadsFrom(logs)[0] as { buttons?: { label: string }[] }
  assert.deepEqual(payload.buttons?.map(button => button.label), ['Repo', 'Docs'])
})

test('a forced log transport with a client id names its real reason', async () => {
  const { ctx, logs } = harness({ events: busyEvents })
  apply(ctx, new Config({
    discord: { clientId: '123456789012345678' },
    connection: { transport: 'log' },
  }) as Config)
  await new Promise(resolve => setTimeout(resolve, 700))

  const first = logs.find(entry => entry.message.includes('log transport'))
  assert.ok(first !== undefined)
  assert.ok(
    !first.message.includes('no discord.clientId'),
    'a deliberately forced log transport must not claim the id is missing',
  )
})
