import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { Config, DEFAULT_CLIENT_ID, DEFAULTS, apply } from '../src/index.ts'
import { readSettings } from '../src/settings.ts'

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
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>()
  const folded = new Map<unknown, unknown>()
  let modelId = 'deepseek-v4.1-flash'
  const agent = {
    status: 'running',
    options: {},
    model: { current: () => ({ provider: 'mclans', model: modelId, reasoningEffort: 'high' }) },
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
      // Later payloads reach the log transport at debug level, so they are
      // recorded too: a test that switches the model mid-run needs them.
      debug: (message: string, ...args: unknown[]) => logs.push({ level: 'debug', message, args }),
    }),
    effect: (factory: () => (() => void) | void) => { factory() },
    on: (event: string, handler: (...args: unknown[]) => void) => {
      const existing = listeners.get(event) ?? []
      existing.push(handler)
      listeners.set(event, existing)
    },
    get: (name: string) => name === 'sessionProjections' ? projections : undefined,
    agents: {
      list: () => options.agent === false ? [] : [agent],
      get: (id: string) => options.agent === false ? undefined : id === agent.session.id ? agent : undefined,
    },
    sessionProjections: projections,
    transportSink: payloads,
  }
  /** Switch the route the agent reports, then let the plugin notice, as a real switch does. */
  const switchModel = (next: string): void => {
    modelId = next
    for (const handler of listeners.get('agent/status') ?? []) handler({ agent })
  }
  return { ctx: ctx as unknown as Context, logs, payloads, switchModel }
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

/**
 * A configuration that renders to the log instead of reaching Discord.
 *
 * A fresh install publishes immediately through the shared application id, so
 * a test that inspects payloads would otherwise open a socket to whatever
 * Discord client happens to be running beside the suite. Clearing the id keeps
 * the transport local while every other default stays exactly as shipped.
 *
 * @param overrides - groups to store on top of the defaults.
 * @returns the configuration to hand to {@link apply}.
 */
function offline(overrides: Record<string, unknown> = {}): Config {
  const discord = { ...(overrides.discord as Record<string, unknown> | undefined), clientId: '' }
  return new Config({ ...overrides, discord }) as Config
}

test('the default configuration renders a busy session with every visible field', async () => {
  const { ctx, logs } = harness({
    events: busyEvents,
    tokens: { usage: { uncachedInputTokens: 82_300, outputTokens: 12_100, cacheReadTokens: 3_400, cacheWriteTokens: 0 }, contextTokens: 42_100 },
  })
  apply(ctx, offline())
  await new Promise(resolve => setTimeout(resolve, 700))

  const payloads = payloadsFrom(logs)
  assert.equal(payloads.length, 1, 'one activity is published for the settled state')
  assert.deepEqual(payloads[0], {
    type: 0,
    details: 'Running Bash · dsh',
    state: 'deepseek-v4.1-flash · 42.1K · in 85.7K (3.4K cached) · out 12.1K',
    timestamps: { start: 1_790_000_000_000 },
    assets: {
      large_image: 'deepseek',
      large_text: 'turn 1 · step 2',
      small_image: 'deepseek_harness',
      small_text: 'Running Bash',
    },
  })
})

test('switching the running model switches the large image', async () => {
  // The rate limits are relaxed so the second payload is not swallowed by the
  // 15-second spacing the production defaults impose.
  const { ctx, logs, switchModel } = harness({ events: busyEvents })
  apply(ctx, offline({ update: { debounceMs: 10, minIntervalMs: 0 } }))
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal((payloadsFrom(logs)[0] as { assets?: { large_image?: string } }).assets?.large_image, 'deepseek')

  switchModel('k3')
  await new Promise(resolve => setTimeout(resolve, 60))
  const after = payloadsFrom(logs).at(-1) as { assets?: { large_image?: string } }
  assert.equal(after.assets?.large_image, 'kimi', 'a gateway alias for a kimi model picks the kimi asset')

  switchModel('my-private-model')
  await new Promise(resolve => setTimeout(resolve, 60))
  const unmatched = payloadsFrom(logs).at(-1) as { assets?: { large_image?: string } }
  assert.equal(unmatched.assets?.large_image, undefined, 'an unrecognised model falls back to the application icon')
})

test('without token-meter the related segments disappear instead of showing placeholders', async () => {
  const { ctx, logs } = harness({ events: busyEvents })
  apply(ctx, offline())
  await new Promise(resolve => setTimeout(resolve, 700))

  const payloads = payloadsFrom(logs)
  assert.equal(payloads.length, 1)
  const payload = payloads[0] as { details: string; state: string }
  assert.equal(payload.details, 'Running Bash · dsh')
  assert.equal(payload.state, 'deepseek-v4.1-flash', 'no context and no usage segments remain')
})

test('with no live agent the card says Idle, and the log transport explains why it is used', async () => {
  const { ctx, logs } = harness({ agent: false })
  apply(ctx, offline())
  await new Promise(resolve => setTimeout(resolve, 700))

  const payloads = payloadsFrom(logs)
  assert.deepEqual(payloads, [{ type: 0, details: 'Idle', assets: { small_image: 'deepseek_harness', small_text: 'Idle' } }])
  assert.ok(
    logs.some(entry => entry.level === 'info' && entry.message.includes('no discord.clientId configured')),
    'the operator is told why nothing reaches Discord',
  )
})

test('showWhenIdle: false clears the presence when no agent is live', async () => {
  const { ctx, logs } = harness({ agent: false })
  apply(ctx, offline({ presence: { showWhenIdle: false } }))
  await new Promise(resolve => setTimeout(resolve, 700))

  const payloads = payloadsFrom(logs)
  assert.deepEqual(payloads, [null], 'the presence is cleared, never drawn as a card')
})

test('privacy switches remove the tool name and the folder from the payload', async () => {
  const { ctx, logs } = harness({ events: busyEvents })
  apply(ctx, offline({ privacy: { showToolNames: false, showFolder: false } }))
  await new Promise(resolve => setTimeout(resolve, 700))

  const payload = payloadsFrom(logs)[0] as { details: string; state?: string }
  assert.equal(payload.details, 'Running a tool')
  assert.ok(!JSON.stringify(payload).includes('dsh'), 'the folder name never reaches the payload')
})

test('buttons are capped at two and must be absolute links', async () => {
  const { ctx, logs } = harness({ events: busyEvents })
  apply(ctx, offline({
    discord: {
      buttons: [
        { label: 'Repo', url: 'https://example.com/repo' },
        { label: 'Docs', url: 'https://example.com/docs' },
        { label: 'Dropped', url: 'https://example.com/third' },
        { label: 'Local', url: 'file:///tmp/x' },
      ],
    },
  }))
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

  // The reason is the first argument of the formatted line, not part of the
  // message, so reading `message` alone would assert nothing.
  const first = logs.find(entry => entry.message.includes('log transport'))
  assert.ok(first !== undefined)
  const reason = String(first.args[0])
  assert.ok(
    reason.includes('connection.transport is "log"'),
    'a deliberately forced log transport must name the choice, not a missing id',
  )
  assert.ok(
    !reason.includes('no discord.clientId'),
    'the id is present, so blaming it would send the reader hunting for a bug',
  )
})

test('the schema default and the runtime default agree, so the page shows what the Host uses', () => {
  // Two places hold the shipped id: the schema (what the configuration page
  // reads back) and DEFAULTS (what the pipeline falls back to). If they drift,
  // a fresh install publishes through one application while the page displays
  // an empty field, and the first save silently switches the card.
  const stored = new Config({}).discord.get()
  assert.equal(stored.clientId, DEFAULTS.discord.clientId)
  assert.equal(stored.clientId, DEFAULT_CLIENT_ID)
  assert.equal(readSettings(new Config({})).discord.clientId, DEFAULT_CLIENT_ID)
})

test('clearing the application id is the documented way to switch publishing off', async () => {
  const { ctx, logs } = harness({ events: busyEvents })
  apply(ctx, offline())
  await new Promise(resolve => setTimeout(resolve, 700))
  assert.ok(payloadsFrom(logs).length > 0, 'the payload still renders, it just goes to the log')
  assert.ok(
    logs.some(entry => entry.level === 'info' && entry.message.includes('no discord.clientId configured')),
    'the operator is told why nothing reaches Discord',
  )
})

test('forcing the Discord transport without an id explains the fallback', async () => {
  const { ctx, logs } = harness({ events: busyEvents })
  apply(ctx, offline({ connection: { transport: 'ipc' } }))
  await new Promise(resolve => setTimeout(resolve, 700))
  assert.ok(
    logs.some(entry => entry.level === 'warn' && entry.message.includes('discord.clientId is empty')),
    'an explicitly requested transport that cannot run must say so',
  )
})
