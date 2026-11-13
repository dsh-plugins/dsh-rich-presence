import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ActivityPayload } from '../src/render.ts'
import { Publisher, type Transport } from '../src/publish.ts'

/** A transport that records what it was asked to send. */
function recorder(): { sent: (ActivityPayload | null)[]; transport: Transport } {
  const sent: (ActivityPayload | null)[] = []
  return { sent, transport: { send: activity => sent.push(activity) } }
}

/** A controllable clock. */
function clock(start = 0) {
  let now = start
  return {
    now: () => now,
    advance: (ms: number) => { now += ms },
  }
}

/** Wait for real time to pass. */
const settle = (ms = 0): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

test('the debounce coalesces a burst into one send of the newest value', async () => {
  const { sent, transport } = recorder()
  const publisher = new Publisher({ debounceMs: 20, minIntervalMs: 0 }, transport)
  try {
    publisher.offer(() => ({ details: 'one' }))
    publisher.offer(() => ({ details: 'two' }))
    publisher.offer(() => ({ details: 'three' }))
    assert.equal(sent.length, 0, 'nothing is sent before the debounce elapses')
    await settle(60)
    assert.deepEqual(sent, [{ details: 'three' }])
  } finally {
    publisher.dispose()
  }
})

test('the rate limit holds a change back until the interval passes', async () => {
  const { sent, transport } = recorder()
  const time = clock()
  const publisher = new Publisher({ debounceMs: 10, minIntervalMs: 100 }, transport, time.now)
  try {
    publisher.offer(() => ({ details: 'first' }))
    publisher.flush()
    assert.deepEqual(sent, [{ details: 'first' }], 'a flush bypasses the limit')

    publisher.offer(() => ({ details: 'second' }))
    await settle(80)
    assert.equal(sent.length, 1, 'still inside the minimum interval')
    time.advance(200)
    await settle(80)
    assert.deepEqual(sent.at(-1), { details: 'second' })
  } finally {
    publisher.dispose()
  }
})

test('an unchanged payload is not sent again', async () => {
  const { sent, transport } = recorder()
  const publisher = new Publisher({ debounceMs: 5, minIntervalMs: 0 }, transport)
  try {
    publisher.offer(() => ({ details: 'same' }))
    await settle(30)
    publisher.offer(() => ({ details: 'same' }))
    await settle(30)
    assert.equal(sent.length, 1)
  } finally {
    publisher.dispose()
  }
})

test('a source is resolved when the update is sent, not when it is offered', async () => {
  const { sent, transport } = recorder()
  const publisher = new Publisher({ debounceMs: 20, minIntervalMs: 0 }, transport)
  let value: ActivityPayload | null = { details: 'stale' }
  try {
    publisher.offer(() => value)
    value = { details: 'fresh' }
    await settle(60)
    assert.deepEqual(sent, [{ details: 'fresh' }])
  } finally {
    publisher.dispose()
  }
})

test('a clearing source sends null', async () => {
  const { sent, transport } = recorder()
  const publisher = new Publisher({ debounceMs: 5, minIntervalMs: 0 }, transport)
  try {
    publisher.offer(() => ({ details: 'shown' }))
    await settle(30)
    publisher.offer(() => null)
    await settle(30)
    assert.deepEqual(sent, [{ details: 'shown' }, null])
  } finally {
    publisher.dispose()
  }
})

test('dispose drops a pending update', async () => {
  const { sent, transport } = recorder()
  const publisher = new Publisher({ debounceMs: 30, minIntervalMs: 0 }, transport)
  publisher.offer(() => ({ details: 'never' }))
  publisher.dispose()
  await settle(80)
  assert.equal(sent.length, 0)
})

test('flush before any offer sends nothing', () => {
  const { sent, transport } = recorder()
  const publisher = new Publisher({ debounceMs: 5, minIntervalMs: 0 }, transport)
  publisher.flush()
  assert.equal(sent.length, 0)
  publisher.dispose()
})

test('a throwing source is reported and dropped, never thrown at the caller', async () => {
  const { sent, transport } = recorder()
  const failures: unknown[] = []
  const publisher = new Publisher({ debounceMs: 5, minIntervalMs: 0 }, transport, Date.now, error => failures.push(error))
  try {
    publisher.offer(() => { throw new Error('projection unavailable') })
    await settle(30)
    assert.equal(sent.length, 0)
    assert.equal(failures.length, 1)
    assert.match(String(failures[0]), /projection unavailable/)

    // The publisher stays usable after a failure.
    publisher.offer(() => ({ details: 'recovered' }))
    await settle(30)
    assert.deepEqual(sent, [{ details: 'recovered' }])
  } finally {
    publisher.dispose()
  }
})

test('a throwing transport is reported and does not retry the same payload', async () => {
  const failures: unknown[] = []
  let attempts = 0
  const publisher = new Publisher(
    { debounceMs: 5, minIntervalMs: 0 },
    { send: () => { attempts += 1; throw new Error('socket gone') } },
    Date.now,
    error => failures.push(error),
  )
  try {
    publisher.offer(() => ({ details: 'same' }))
    await settle(30)
    publisher.offer(() => ({ details: 'same' }))
    await settle(30)
    assert.equal(attempts, 1)
    assert.equal(failures.length, 1)
  } finally {
    publisher.dispose()
  }
})
