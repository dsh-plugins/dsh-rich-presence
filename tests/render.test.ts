import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PresenceSnapshot, RenderConfig } from '../src/render.ts'
import {
  DEFAULT_MODEL_IMAGES,
  DISCORD_TEXT_LIMIT,
  expandTemplate,
  fitField,
  formatCompactTokens,
  modelImageOf,
  renderActivity,
} from '../src/render.ts'

const config: RenderConfig = {
  details: '{activity} · {folder}',
  state: '{model} · {context} · {tokens}',
  largeText: '{tokens}',
  smallText: '{activity} · {progress} · {subagents}',
  largeImage: '',
  smallImageRunning: '',
  smallImageIdle: '',
  elapsed: 'session',
  truncateAt: 128,
  showWhenIdle: true,
}

const busy: PresenceSnapshot = {
  phase: 'tool',
  toolName: 'Bash',
  model: 'deepseek-v4.1-flash',
  provider: 'mclans',
  contextTokens: 42_100,
  contextWindow: 128_000,
  usage: { uncachedInputTokens: 82_300, outputTokens: 12_100, cacheReadTokens: 3_400, cacheWriteTokens: 0 },
  folder: 'dsh',
  turn: 4,
  step: 2,
  subagents: 0,
  sessionStart: 1_760_000_000_000,
  turnStart: 1_760_000_100_000,
}

test('compact token counts match the statistics strip', () => {
  assert.equal(formatCompactTokens(0), '0')
  assert.equal(formatCompactTokens(517), '517')
  assert.equal(formatCompactTokens(999.6), '1K')
  assert.equal(formatCompactTokens(1_000), '1K')
  assert.equal(formatCompactTokens(12_200), '12.2K')
  assert.equal(formatCompactTokens(517_000), '517K')
  assert.equal(formatCompactTokens(999_999), '1M', 'a rounded-up thousand promotes to the next unit')
  assert.equal(formatCompactTokens(999_999_999), '1B')
  assert.equal(formatCompactTokens(1_200_000), '1.2M')
  assert.equal(formatCompactTokens(Number.NaN), '0')
  assert.equal(formatCompactTokens(-5), '0')
})

test('a full snapshot fills every configured slot', () => {
  const activity = renderActivity(busy, config, true, true)
  assert.deepEqual(activity, {
    details: 'Running Bash · dsh',
    state: 'deepseek-v4.1-flash · 42.1K/128K (33%) · in 85.7K (3.4K cached) · out 12.1K',
    timestamps: { start: 1_760_000_000_000 },
    assets: {
      large_text: 'in 85.7K (3.4K cached) · out 12.1K',
      small_text: 'Running Bash · turn 4 · step 2',
    },
  })
})

test('a missing value shortens the line instead of leaving a dangling separator', () => {
  const activity = renderActivity({ phase: 'idle', subagents: 0 }, config, true, true)
  assert.equal(activity?.details, 'Idle')
  assert.equal(activity?.state, undefined)
})

test('the state line keeps the model alone when no usage was reported', () => {
  const activity = renderActivity({ phase: 'thinking', model: 'kimi-for-coding', subagents: 0 }, config, true, false)
  assert.equal(activity?.state, 'kimi-for-coding')
  assert.equal(activity?.details, 'Thinking')
})

test('context falls back to a bare count without an advertised window', () => {
  const activity = renderActivity({ phase: 'working', model: 'm', contextTokens: 5_000, subagents: 0 }, config, true, true)
  assert.equal(activity?.state, 'm · 5K')
})

test('a bracketed optional group disappears with its placeholder', () => {
  assert.deepEqual(expandTemplate('{activity} ({folder})', { activity: 'Idle', folder: '' }), ['Idle'])
  assert.deepEqual(expandTemplate('{activity} ({folder})', { activity: 'Idle', folder: 'dsh' }), ['Idle (dsh)'])
  assert.deepEqual(expandTemplate('provider: {provider}', { provider: '' }), [])
})

test('an empty segment collapses without duplicating separators', () => {
  assert.deepEqual(expandTemplate('{activity} · {model} · {context}', { activity: 'Idle', model: '', context: '' }), ['Idle'])
  assert.deepEqual(expandTemplate('{activity} · {model} · {context}', { activity: '', model: '', context: '' }), [])
})

test('tool names are withheld while the phase wording survives', () => {
  const activity = renderActivity(busy, config, false, false)
  assert.equal(activity?.details, 'Running a tool')
  assert.equal(activity?.assets?.small_text, 'Running a tool · turn 4 · step 2')
})

test('the elapsed timer follows its configured origin', () => {
  assert.deepEqual(renderActivity(busy, { ...config, elapsed: 'turn' }, true, true)?.timestamps, {
    start: 1_760_000_100_000,
  })
  assert.equal(renderActivity(busy, { ...config, elapsed: 'off' }, true, true)?.timestamps, undefined)
})

test('an idle presence is omitted when it is configured away', () => {
  assert.equal(renderActivity({ phase: 'absent', subagents: 0 }, { ...config, showWhenIdle: false }, true, true), undefined)
})

test('nothing to say produces no activity at all', () => {
  const empty: RenderConfig = { ...config, details: '{model}', state: '{folder}' }
  assert.equal(renderActivity({ phase: 'absent', subagents: 0 }, empty, true, true), undefined)
})

test('overlong fields are truncated with an ellipsis', () => {
  const long = 'x'.repeat(200)
  const activity = renderActivity({ phase: 'tool', toolName: long, subagents: 0 }, config, true, true)
  assert.equal(activity?.details?.length, DISCORD_TEXT_LIMIT)
  assert.ok(activity?.details?.endsWith('…'))
})

test('a field Discord would reject as too short is dropped', () => {
  assert.equal(fitField('I', 128), undefined)
  assert.equal(fitField('o', 128), undefined)
  assert.equal(fitField('ok', 128), 'ok')
  assert.equal(fitField('  ', 128), undefined)
})

test('image assets follow the phase and are omitted when unconfigured', () => {
  const images = { ...config, largeImage: 'logo', smallImageRunning: 'busy', smallImageIdle: 'rest' }
  const running = renderActivity(busy, images, true, true)
  assert.equal(running?.assets?.large_image, 'logo')
  assert.equal(running?.assets?.small_image, 'busy')

  const idle = renderActivity({ phase: 'idle', subagents: 0 }, images, true, true)
  assert.equal(idle?.assets?.small_image, 'rest')

  // With no agent at all, nothing names an activity, so no card is produced.
  assert.equal(renderActivity({ phase: 'absent', subagents: 0 }, images, true, true), undefined)

  // Hover text is emitted with its image, since that is the only place Discord shows it.
  assert.equal(running?.assets?.large_text, 'in 85.7K (3.4K cached) · out 12.1K')
  assert.equal(running?.assets?.small_text, 'Running Bash · turn 4 · step 2')

  // No image names: the large slot falls back to the application icon, so the
  // hover text is still worth sending.
  const bare = renderActivity({ phase: 'idle', subagents: 0 }, config, true, true)
  assert.deepEqual(bare?.assets, { small_text: 'Idle' })
})

test('phase labels can be replaced for another display language', () => {
  const labels = { thinking: '思考', tool: '正在运行 {tool}', toolHidden: '正在运行工具', idle: '空闲' }
  const localized = { ...config, labels }
  assert.equal(renderActivity({ phase: 'thinking', subagents: 0 }, localized, true, true)?.details, '思考')
  assert.equal(renderActivity({ phase: 'tool', toolName: 'Bash', subagents: 0 }, localized, true, true)?.details, '正在运行 Bash')
  assert.equal(renderActivity({ phase: 'tool', toolName: 'Bash', subagents: 0 }, localized, false, true)?.details, '正在运行工具')
  assert.equal(renderActivity({ phase: 'idle', subagents: 0 }, localized, true, true)?.details, '空闲')
  // An omitted key keeps the built-in wording.
  assert.equal(renderActivity({ phase: 'working', subagents: 0 }, localized, true, true)?.details, 'Working')
})

test('a label without the tool placeholder does not lose the tool name silently', () => {
  const labels = { tool: 'Busy' }
  const activity = renderActivity({ phase: 'tool', toolName: 'Bash', subagents: 0 }, { ...config, labels }, true, true)
  assert.equal(activity?.details, 'Busy')
})

test('a model id picks its family image, and the first matching rule wins', () => {
  assert.equal(modelImageOf('deepseek-v4.1-flash', DEFAULT_MODEL_IMAGES), 'deepseek')
  assert.equal(modelImageOf('gpt-6-astra', DEFAULT_MODEL_IMAGES), 'gpt')
  assert.equal(modelImageOf('claude-opus-4.8', DEFAULT_MODEL_IMAGES), 'claude')
  assert.equal(modelImageOf('gemini-4-hydrogen', DEFAULT_MODEL_IMAGES), 'gemini')
  assert.equal(modelImageOf('glm-5.3-flash', DEFAULT_MODEL_IMAGES), 'glm')
  assert.equal(modelImageOf('grok-4.7', DEFAULT_MODEL_IMAGES), 'grok')
  assert.equal(modelImageOf('qwen3.8-max', DEFAULT_MODEL_IMAGES), 'qwen')
  assert.equal(modelImageOf('DeepSeek-V4-Pro', DEFAULT_MODEL_IMAGES), 'deepseek', 'matching ignores case')

  // A gateway alias keeps the family name only in its short form.
  assert.equal(modelImageOf('k3', DEFAULT_MODEL_IMAGES), 'kimi')
  assert.equal(modelImageOf('k3-256k', DEFAULT_MODEL_IMAGES), 'kimi')
  assert.equal(modelImageOf('kimi-for-coding-highspeed', DEFAULT_MODEL_IMAGES), 'kimi')

  const custom = [
    { asset: 'first', patterns: ['shared'] },
    { asset: 'second', patterns: ['shared', 'other'] },
  ]
  assert.equal(modelImageOf('shared-model', custom), 'first', 'line order is priority order')
  assert.equal(modelImageOf('other-model', custom), 'second')
})

test('a keyword must start a word, so short OpenAI names cannot claim another vendor', () => {
  // Substring matching would let `o1` claim `sao10k` and `o4` claim `solar-pro4`,
  // which shows the wrong vendor's logo with no visible error.
  assert.equal(modelImageOf('sao10k/l3.1-euryale-70b', DEFAULT_MODEL_IMAGES), undefined)
  assert.equal(modelImageOf('upstage/solar-pro4', DEFAULT_MODEL_IMAGES), undefined)
  assert.equal(modelImageOf('openai/o3-pro', DEFAULT_MODEL_IMAGES), 'gpt')
  // A later word still counts: `qwen3` starts with the keyword `qwen`.
  assert.equal(modelImageOf('vllm-hosted/qwen3-coder', DEFAULT_MODEL_IMAGES), 'qwen')
})

test('an unknown or absent model has no family image', () => {
  assert.equal(modelImageOf(undefined, DEFAULT_MODEL_IMAGES), undefined)
  assert.equal(modelImageOf('', DEFAULT_MODEL_IMAGES), undefined)
  assert.equal(modelImageOf('my-private-model', DEFAULT_MODEL_IMAGES), undefined)
  assert.equal(modelImageOf('deepseek-v4.1-flash', undefined), undefined)
  assert.equal(modelImageOf('deepseek-v4.1-flash', []), undefined)
  // A hand-written pattern with punctuation can never match a word, so it is
  // skipped instead of being compared literally.
  assert.equal(modelImageOf('deepseek-v4.1-flash', [{ asset: 'broken', patterns: ['deep-seek'] }]), undefined)
  assert.equal(modelImageOf('deepseek-v4.1-flash', [{ asset: '  ', patterns: ['deepseek'] }]), undefined)
})

test('the large image follows the model and falls back to the fixed asset', () => {
  const rules = DEFAULT_MODEL_IMAGES
  const withRules = { ...config, largeImage: 'logo', modelImages: rules }

  const kimi = renderActivity({ phase: 'idle', subagents: 0, model: 'k3' }, withRules, true, true)
  assert.equal(kimi?.assets?.large_image, 'kimi')
  assert.equal(kimi?.assets?.large_text, undefined, 'no usage means no hover text')

  const unknown = renderActivity({ phase: 'idle', subagents: 0, model: 'my-private-model' }, withRules, true, true)
  assert.equal(unknown?.assets?.large_image, 'logo', 'an unmatched model keeps the fixed asset')

  const noModel = renderActivity({ phase: 'idle', subagents: 0 }, withRules, true, true)
  assert.equal(noModel?.assets?.large_image, 'logo')

  // With no fixed asset either, the key disappears so Discord shows the
  // application icon rather than a broken image.
  const bare = renderActivity({ phase: 'idle', subagents: 0, model: 'my-private-model' }, { ...config, modelImages: rules }, true, true)
  assert.equal(bare?.assets?.large_image, undefined)
})
