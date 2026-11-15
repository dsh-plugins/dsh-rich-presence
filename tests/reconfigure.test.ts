import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { Config, apply } from '../src/index.ts'

/**
 * Live-configuration behaviour, driven the way the loader drives it.
 *
 * The loader commits a volatile save into the same references and then emits
 * `settings/document-updated`; these tests mutate the references and emit the
 * event, which is the exact sequence the running plugin sees.
 */

/** A stub Harness with settings available, so the live listener attaches. */
function harness(options: { withSettings?: boolean } = {}) {
  const logs: { level: string; message: string; args: unknown[] }[] = []
  const listeners: { event: string; handler: (...args: unknown[]) => void }[] = []
  const folded = new Map<unknown, unknown>()
  const agent = {
    status: 'running',
    options: {},
    model: { current: () => ({ provider: 'mclans', model: 'deepseek-v4.1-flash' }) },
    inbox: { nextTurn: [], nextStep: [] },
    session: { id: 's1', header: { id: 's1', createdAt: 1_790_000_000_000, cwd: '/work/dsh' } },
  } as unknown as Agent
  const projections = {
    register: async (definition: { init: (h: unknown, i: number) => unknown; apply: (s: unknown, e: unknown) => unknown }) => {
      let state = definition.init(agent.session.header, 0)
      for (const event of [
        { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } },
        { type: 'step/start', seq: 2, time: 2, data: { turn: 1, step: 1 } },
        { type: 'tool/call', seq: 3, time: 3, data: { turn: 1, step: 1, callId: 'c', name: 'Bash' } },
      ]) state = definition.apply(state, event)
      folded.set(agent.session, state)
      return { stateOf: (s: unknown) => folded.get(s), dispose: async () => {} }
    },
    snapshot: () => ({ asOfSeq: 3, values: {} }),
  }
  const ctx = {
    logger: () => ({
      info: (message: string, ...args: unknown[]) => logs.push({ level: 'info', message, args }),
      warn: (message: string, ...args: unknown[]) => logs.push({ level: 'warn', message, args }),
      debug: (message: string, ...args: unknown[]) => logs.push({ level: 'debug', message, args }),
    }),
    effect: (factory: () => (() => void) | void) => { factory() },
    on: (event: string, handler: (...args: unknown[]) => void) => { listeners.push({ event, handler }) },
    get: (name: string) => {
      if (name === 'sessionProjections') return projections
      if (name === 'settings') return options.withSettings === false ? undefined : {}
      return undefined
    },
    agents: { list: () => [agent], get: (id: string) => id === 's1' ? agent : undefined },
    sessionProjections: projections,
  }
  return { ctx: ctx as unknown as Context, logs, listeners }
}

/** The payloads the log transport wrote, oldest first. */
function payloads(logs: { message: string; args: unknown[] }[]): unknown[] {
  return logs
    .filter(entry => entry.message.includes('log transport'))
    .map(entry => JSON.parse(String(entry.args.at(-1))))
}

/**
 * Replace one group's value behind its volatile reference, the way a save does.
 *
 * The snapshot a reference hands out is frozen, so a save cannot mutate it: the
 * loader resolves the new config and commits a fresh object into the reference.
 */
function commit(config, group, patch) {
  const reference = config[group];
  const before = reference.get();
  const next = { ...before, ...patch };
  config[group] = { get: () => next };
}

/** Emit the settings event the way the Host would after a save. */
function saved(listeners: { event: string; handler: (...args: unknown[]) => void }[]): void {
  for (const listener of listeners) {
    if (listener.event === 'settings/document-updated') listener.handler('rich-presence', 1)
  }
}

/** Wait past one debounce window. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 120))

/**
 * A configuration whose rate limits allow several publishes inside one test.
 *
 * The shipped defaults publish through the shared application id, so the id is
 * cleared here: these tests drive a local pipeline and must never open a socket
 * to whatever Discord client runs beside the suite. One test sets an id itself
 * to exercise the switch to the real transport.
 */
const fastConfig = (): Config => new Config({
  discord: { clientId: '' },
  update: { debounceMs: 10, minIntervalMs: 0 },
}) as Config

test('a live template save redraws the card without touching the connection', async () => {
  const { ctx, logs, listeners } = harness()
  const config = fastConfig()
  apply(ctx, config)
  await settle()
  const before = payloads(logs).at(-1) as { details: string }
  assert.equal(before.details, 'Running Bash · dsh')

  // The loader commits the new value into the same reference.
  commit(config, 'presence', { details: '{activity}' })
  saved(listeners)
  await settle()

  const after = payloads(logs).at(-1) as { details: string }
  assert.equal(after.details, 'Running Bash')
  assert.ok(
    logs.every(entry => !entry.message.includes('connected to the discord client')),
    'a display edit must not reconnect',
  )
})

test('a live application id save switches the transport and reconnects', async () => {
  const { ctx, logs, listeners } = harness()
  const config = fastConfig()
  apply(ctx, config)
  await settle()
  assert.equal(payloads(logs).length >= 1, true)
  const logPayloads = payloads(logs).length

  // Setting an id takes the pipeline from the log transport to a real client.
  // The client cannot reach a Discord client under test, so this asserts the
  // switch happened rather than that a connection was made.
  commit(config, 'discord', { clientId: '123456789012345678' })
  saved(listeners)
  await settle()

  assert.equal(
    logs.filter(entry => entry.message.includes('log transport')).length,
    logPayloads,
    'no further payload goes to the log once the transport switched',
  )
})

test('a live privacy save withholds the tool name on the next render', async () => {
  const { ctx, logs, listeners } = harness()
  const config = fastConfig()
  apply(ctx, config)
  await settle()

  commit(config, 'privacy', { showToolNames: false })
  saved(listeners)
  await settle()

  const last = payloads(logs).at(-1) as { details: string }
  assert.equal(last.details, 'Running a tool · dsh')
})

test('without the settings service no listener is attached and nothing changes', async () => {
  const { ctx, logs, listeners } = harness({ withSettings: false })
  const config = fastConfig()
  apply(ctx, config)
  await settle()

  assert.equal(
    listeners.some(listener => listener.event === 'settings/document-updated'),
    false,
    'a profile without settings must not subscribe to an event it will never receive',
  )
  commit(config, 'presence', { details: '{activity}' })
  await settle()
  const last = payloads(logs).at(-1) as { details: string }
  assert.equal(last.details, 'Running Bash · dsh', 'the static value keeps rendering')
})

test('an unrelated namespace does not rebuild anything', async () => {
  const { ctx, logs, listeners } = harness()
  const config = fastConfig()
  apply(ctx, config)
  await settle()
  const count = payloads(logs).length

  for (const listener of listeners) {
    if (listener.event === 'settings/document-updated') listener.handler('some-other-plugin', 1)
  }
  await settle()

  assert.equal(payloads(logs).length, count, 'a foreign namespace is ignored')
})

test('repeated saves of the same value do not resend an identical payload', async () => {
  const { ctx, logs, listeners } = harness()
  const config = fastConfig()
  apply(ctx, config)
  await settle()
  const count = payloads(logs).length

  // The value does not actually differ, so the render key is unchanged.
  saved(listeners)
  await settle()
  assert.equal(payloads(logs).length, count)
})
