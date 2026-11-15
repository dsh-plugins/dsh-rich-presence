import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Volatile } from '@deepseek-ai/cordis'
import type { Config } from '../src/settings.ts'
import {
  DEFAULT_CLIENT_ID,
  DEFAULTS,
  formatButtons,
  formatEndpoints,
  formatLabels,
  formatModelImages,
  parseButtons,
  parseEndpoints,
  parseLabels,
  parseModelImages,
  publishesToDiscord,
  readSettings,
  reconcileKeys,
  renderConfigOf,
} from '../src/settings.ts'
import { DEFAULT_MODEL_IMAGES, modelImageOf } from '../src/render.ts'

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

test('the shipped model-image rules cover the published families in priority order', () => {
  const rules = DEFAULTS.presence.modelImages
  assert.deepEqual(rules.map(rule => rule.asset), ['claude', 'deepseek', 'gemini', 'glm', 'gpt', 'grok', 'kimi', 'qwen'])
  for (const rule of rules) {
    assert.ok(rule.patterns.length > 0, `${rule.asset} must match at least one keyword`)
  }
  // The defaults must not share array instances with the constant, or a save
  // that mutates one would leak into every other snapshot.
  assert.notEqual(DEFAULTS.presence.modelImages, DEFAULT_MODEL_IMAGES)
  assert.notEqual(DEFAULTS.presence.modelImages[0]?.patterns, DEFAULT_MODEL_IMAGES[0]?.patterns)
})

test('the default rules map real model ids to their family', () => {
  const cases: [string, string | undefined][] = [
    ['deepseek-v4.1-flash', 'deepseek'],
    ['deepseek-v4-pro', 'deepseek'],
    ['claude-sonnet-5.5', 'claude'],
    ['claude-haiku-4.5', 'claude'],
    ['gemini-3.8-flash', 'gemini'],
    ['glm-5.3', 'glm'],
    ['glm-4.6v', 'glm'],
    ['gpt-6.1-sol', 'gpt'],
    ['gpt-image-2.5', 'gpt'],
    ['openai/o4-mini', 'gpt'],
    ['grok-4.20', 'grok'],
    ['kimi-k3.1-pro', 'kimi'],
    ['kimi-k2-thinking', 'kimi'],
    ['k3', 'kimi'],
    ['k3-256k', 'kimi'],
    ['kimi-for-coding', 'kimi'],
    ['qwen3.8-max', 'qwen'],
    ['qwen-plus', 'qwen'],
    ['my-private-model', undefined],
    ['sao10k/l3.1-euryale-70b', undefined],
  ]
  for (const [model, expected] of cases) {
    assert.equal(modelImageOf(model, DEFAULTS.presence.modelImages), expected, model)
  }
})

test('the small image defaults to the DSH badge', () => {
  assert.equal(DEFAULTS.presence.smallImageRunning, 'deepseek_harness')
  assert.equal(DEFAULTS.presence.smallImageIdle, 'deepseek_harness')
})

test('model-image rules parse one per line and keep their order', () => {
  const parsed = parseModelImages('claude: claude, anthropic\nkimi: kimi, k3\n  \ngpt: gpt, o3')
  assert.deepEqual(parsed.entries, [
    { asset: 'claude', patterns: ['claude', 'anthropic'] },
    { asset: 'kimi', patterns: ['kimi', 'k3'] },
    { asset: 'gpt', patterns: ['gpt', 'o3'] },
  ])
  assert.deepEqual(parsed.errors, [])
})

test('malformed model-image lines are reported, never silently dropped', () => {
  const parsed = parseModelImages([
    'no separator here',
    'bad asset: x',
    'bad_asset!: x',
    'empty: ',
    ', x: y',
    'punct: o3-mini',
    'Good: ok, fine',
  ].join('\n'))
  assert.deepEqual(parsed.entries, [{ asset: 'Good', patterns: ['ok', 'fine'] }])
  assert.equal(parsed.errors.length, 6)
  assert.match(parsed.errors[0] ?? '', /Expected "asset: keyword/)
  assert.match(parsed.errors[1] ?? '', /letters, digits, and underscores/)
  assert.match(parsed.errors[3] ?? '', /Missing model keyword/)
  assert.match(parsed.errors[4] ?? '', /letters, digits, and underscores/)
  assert.match(parsed.errors[5] ?? '', /Model keywords use letters and digits/)
})

test('the model-image formatter round-trips and keeps the priority order', () => {
  const rules = DEFAULTS.presence.modelImages
  assert.deepEqual(parseModelImages(formatModelImages(rules)).entries, rules)
  assert.equal(formatModelImages([]), '')
  // Order is preserved rather than sorted, because the first match wins.
  assert.equal(
    formatModelImages([{ asset: 'z', patterns: ['b'] }, { asset: 'a', patterns: ['a'] }]),
    'z: b\na: a',
  )
})

test('editing the model-image rules redraws the card without touching the connection', () => {
  const before = reconcileKeys(readSettings(config({ discord: { clientId: '1' } })))
  const after = reconcileKeys(readSettings(config({
    discord: { clientId: '1' },
    presence: { modelImages: [{ asset: 'mine', patterns: ['x'] }] },
  })))
  assert.notEqual(after.render, before.render, 'the card must be re-rendered')
  assert.equal(after.transport, before.transport, 'the Discord connection survives the edit')
  assert.equal(after.update, before.update)
})

test('a fresh install publishes through the shared application, with no setup', () => {
  // The bundle is meant to work the moment it is installed, so the shipped id
  // is the one whose uploaded artwork the model rules name.
  assert.equal(DEFAULT_CLIENT_ID, '1570848316290498590')
  assert.equal(DEFAULTS.discord.clientId, DEFAULT_CLIENT_ID)
  assert.equal(
    publishesToDiscord(DEFAULTS),
    true,
    'transport "auto" plus a shipped id must reach Discord rather than the log',
  )
})

test('publishing is opt-out: an empty id or a forced log transport stays local', () => {
  const empty = { ...DEFAULTS, discord: { ...DEFAULTS.discord, clientId: '' } }
  assert.equal(publishesToDiscord(empty), false)

  const forcedLog = { ...DEFAULTS, connection: { ...DEFAULTS.connection, transport: 'log' as const } }
  assert.equal(publishesToDiscord(forcedLog), false, 'a deliberately local transport ignores the id')

  const forcedIpc = { ...empty, connection: { ...DEFAULTS.connection, transport: 'ipc' as const } }
  assert.equal(publishesToDiscord(forcedIpc), true, 'asking for ipc without an id is a fallback, not a choice')

  const padded = { ...DEFAULTS, discord: { ...DEFAULTS.discord, clientId: '   ' } }
  assert.equal(publishesToDiscord(padded), false, 'whitespace is not an id')
})
