import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Volatile } from '@deepseek-ai/cordis'
import type { Config } from '../src/settings.ts'
import {
  DEFAULTS,
  formatButtons,
  formatEndpoints,
  formatLabels,
  parseButtons,
  parseEndpoints,
  parseLabels,
  readSettings,
  reconcileKeys,
  renderConfigOf,
} from '../src/settings.ts'

/** Build a volatile reference over a value, as the loader would supply. */
function ref<T extends object>(value: Partial<T>): Volatile<T> {
  return { get: () => value as T }
}

/** A configuration whose groups carry the given partial values. */
function config(overrides: {
  discord?: Partial<Config['discord'] extends Volatile<infer T> ? T : never>
  presence?: Partial<Config['presence'] extends Volatile<infer T> ? T : never>
  privacy?: Partial<Config['privacy'] extends Volatile<infer T> ? T : never>
  focus?: Partial<Config['focus'] extends Volatile<infer T> ? T : never>
  connection?: Partial<Config['connection'] extends Volatile<infer T> ? T : never>
  update?: Partial<Config['update'] extends Volatile<infer T> ? T : never>
} = {}): Config {
  return {
    discord: ref(overrides.discord ?? {}),
    presence: ref(overrides.presence ?? {}),
    privacy: ref(overrides.privacy ?? {}),
    focus: ref(overrides.focus ?? {}),
    connection: ref(overrides.connection ?? {}),
    update: ref(overrides.update ?? {}),
  }
}

test('a fully defaulted configuration reads back as the defaults', () => {
  const settings = readSettings(config())
  assert.deepEqual(settings, DEFAULTS)
})

test('stored values override their group defaults', () => {
  const settings = readSettings(config({
    discord: { clientId: '1570848316290498590', activityType: 2 },
    presence: { details: '{model}' },
    update: { minIntervalMs: 1_000 },
  }))
  assert.equal(settings.discord.clientId, '1570848316290498590')
  assert.equal(settings.discord.activityType, 2)
  assert.equal(settings.discord.buttons.length, 0, 'an omitted field keeps its default')
  assert.equal(settings.presence.details, '{model}')
  assert.equal(settings.presence.state, DEFAULTS.presence.state)
  assert.equal(settings.update.minIntervalMs, 1_000)
  assert.equal(settings.update.debounceMs, DEFAULTS.update.debounceMs)
})

test('an absent group falls back to its defaults instead of throwing', () => {
  const broken = { get: () => undefined } as unknown as Volatile<{ clientId: string }>
  const settings = readSettings({ ...config(), discord: broken } as unknown as Config)
  assert.deepEqual(settings.discord, DEFAULTS.discord)
})

test('the render configuration carries the display and label groups', () => {
  const settings = readSettings(config({
    presence: { details: 'A', state: 'B', truncateAt: 40, labels: { idle: '空闲' } },
  }))
  const rendered = renderConfigOf(settings)
  assert.equal(rendered.details, 'A')
  assert.equal(rendered.state, 'B')
  assert.equal(rendered.truncateAt, 40)
  assert.deepEqual(rendered.labels, { idle: '空闲' })
})

test('a display-only change does not invalidate the transport or the publisher', () => {
  const before = reconcileKeys(readSettings(config({ discord: { clientId: '1' } })))
  const after = reconcileKeys(readSettings(config({
    discord: { clientId: '1' },
    presence: { details: '{activity}' },
  })))
  assert.equal(after.transport, before.transport)
  assert.equal(after.update, before.update)
  assert.notEqual(after.render, before.render)
})

test('a client id change reconnects but does not rebuild the publisher', () => {
  const before = reconcileKeys(readSettings(config({ discord: { clientId: '1' } })))
  const after = reconcileKeys(readSettings(config({ discord: { clientId: '2' } })))
  assert.notEqual(after.transport, before.transport)
  assert.equal(after.update, before.update)
  assert.equal(after.render, before.render)
})

test('a rate-limit change rebuilds only the publisher', () => {
  const before = reconcileKeys(readSettings(config()))
  const after = reconcileKeys(readSettings(config({ update: { minIntervalMs: 30_000 } })))
  assert.equal(after.transport, before.transport)
  assert.notEqual(after.update, before.update)
  assert.equal(after.render, before.render)
})

test('privacy and rate keys are distinct values, not all equal strings', () => {
  const on = reconcileKeys(readSettings(config()))
  const off = reconcileKeys(readSettings(config({ privacy: { showToolNames: false, showFolder: false } })))
  assert.notEqual(on.render, off.render, 'false must not collide with true')
})

test('a padded client id is compared trimmed, so a whitespace edit never reconnects', () => {
  const plain = reconcileKeys(readSettings(config({ discord: { clientId: '123' } })))
  const padded = reconcileKeys(readSettings(config({ discord: { clientId: '  123  ' } })))
  assert.equal(padded.transport, plain.transport)
})

test('buttons parse one pair per line and keep their order', () => {
  const parsed = parseButtons('Repo | https://example.com/repo\nDocs | https://example.com/docs')
  assert.deepEqual(parsed.entries, [
    { label: 'Repo', url: 'https://example.com/repo' },
    { label: 'Docs', url: 'https://example.com/docs' },
  ])
  assert.deepEqual(parsed.errors, [])
})

test('a URL may contain the separator, so the first pipe ends the label', () => {
  const parsed = parseButtons('Search | https://example.com/?q=a|b')
  assert.deepEqual(parsed.entries, [{ label: 'Search', url: 'https://example.com/?q=a|b' }])
  assert.deepEqual(parsed.errors, [])
})

test('malformed button lines are reported, never silently dropped', () => {
  const parsed = parseButtons([
    'no separator here',
    '| https://example.com/nolabel',
    'Local | file:///tmp/x',
    'Good | https://example.com/ok',
  ].join('\n'))
  assert.deepEqual(parsed.entries, [{ label: 'Good', url: 'https://example.com/ok' }])
  assert.equal(parsed.errors.length, 3)
  assert.match(parsed.errors[0] ?? '', /Expected "label \| url"/)
  assert.match(parsed.errors[1] ?? '', /Missing button label/)
  assert.match(parsed.errors[2] ?? '', /http/)
})

test('blank lines are ignored on every parser', () => {
  assert.deepEqual(parseButtons('\n\n  \nRepo | https://a.b\n\n').entries, [{ label: 'Repo', url: 'https://a.b' }])
  assert.deepEqual(parseLabels('\n\nidle: 空闲\n\n').entries, { idle: '空闲' })
  assert.deepEqual(parseEndpoints('\n \\\\.\\pipe\\x \n\n'), ['\\\\.\\pipe\\x'])
})

test('labels split on the first colon so values may contain colons', () => {
  const parsed = parseLabels('tool: Running {tool}\nnote: a: b')
  assert.deepEqual(parsed.entries, { tool: 'Running {tool}', note: 'a: b' })
  assert.deepEqual(parsed.errors, [])
})

test('a label key must be a plain word', () => {
  const parsed = parseLabels('bad key: value\nidle: 空闲\n: nothing')
  assert.deepEqual(parsed.entries, { idle: '空闲' })
  assert.equal(parsed.errors.length, 2)
})

test('each formatter round-trips through its parser', () => {
  const buttons = [{ label: 'Repo', url: 'https://example.com/repo' }, { label: 'Docs', url: 'https://example.com/docs' }]
  assert.deepEqual(parseButtons(formatButtons(buttons)).entries, buttons)

  const labels = { idle: '空闲', thinking: '思考' }
  assert.deepEqual(parseLabels(formatLabels(labels)).entries, labels)

  const endpoints = ['\\\\.\\pipe\\discord-ipc-9', '/tmp/discord-ipc-9']
  assert.deepEqual(parseEndpoints(formatEndpoints(endpoints)), endpoints)
})

test('empty input formats to an empty string', () => {
  assert.equal(formatButtons([]), '')
  assert.equal(formatLabels({}), '')
  assert.equal(formatEndpoints([]), '')
})

test('label formatting is sorted so an unchanged set never looks edited', () => {
  assert.equal(formatLabels({ b: '2', a: '1' }), 'a: 1\nb: 2')
})
