import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * Static guards for the browser half.
 *
 * The artifact is a hand-written module-loader bundle, so it cannot be imported
 * by Node. These checks pin the things that silently break the page instead: the
 * slot and key it registers under, the services it waits for, and the absence of
 * imports the module table cannot resolve.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const client = readFileSync(join(root, 'client.js'), 'utf8')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>
  files: string[]
  dsh: { client?: { platform?: string; inject?: string[]; immediately?: boolean } }
}

test('the client bundle registers into the official bundle-config slot', () => {
  assert.match(client, /ctx\.slots\.inject\('plugins\.bundle\.config'/)
  assert.match(client, /name: 'plugins\.bundle\.config'/)
})

test('the registration key is the bundle package name the page looks up', () => {
  // PluginsPage renders the slot with `entryKey: pkg.name`, so a mismatched key
  // means the form silently never appears.
  assert.equal(manifest.exports['./client'], './client.js')
  const registration = client.slice(client.indexOf("ctx.slots.register({"))
  const key = registration.match(/key: '([^']+)'/)?.[1]
  assert.equal(key, '@local/rich-presence', 'the slot key must equal the package name')
  assert.equal(manifest.exports['.'].default, './lib/index.js')
})

test('the bundle declares the canonical browser entry for this bundle family', () => {
  assert.equal(manifest.dsh.client?.platform, 'web')
  assert.match(client, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(client, /id: '@local\/rich-presence'/)
  // A page registered behind `immediately` is prefetched on every boot; the
  // official configuration pages load on demand instead.
  assert.equal(manifest.dsh.client?.immediately, undefined)
})

test('every inject entry is a package the boot graph provides', () => {
  const inject = manifest.dsh.client?.inject ?? []
  assert.deepEqual(inject, [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-ui-plugin-manager',
  ])
  // The module graph rejects a request the platform table cannot answer, so the
  // plugin's own waits must be usable through `ctx.slots`, `ctx.locale`,
  // `ctx.configForms` only.
  assert.match(client, /inject: \['slots', 'locale', 'configForms'\]/)
})

test('the artifact requires only the baseline module table', () => {
  const requires = [...client.matchAll(/require\('([^']+)'\)/g)].map(match => match[1])
  assert.deepEqual([...new Set(requires)], ['react'], 'only react is available to a bundle factory')
})

test('the artifact imports no Harness client package as a value', () => {
  assert.doesNotMatch(client, /@deepseek-ai\//, 'a bundle must not import or require another Harness package')
  assert.doesNotMatch(client, /\bimport\s/, 'the factory form takes what it needs from require')
})

test('the artifact writes no DOM outside its own subtree', () => {
  // A stylesheet is the one permitted global; anything else (document.body,
  // documentElement, a second app root) would violate the UI rules.
  const globalWrites = [...client.matchAll(/document\.(body|documentElement)/g)]
  assert.equal(globalWrites.length, 0)
})

test('the stylesheet is injected and removed by the component, not at module scope', () => {
  assert.match(client, /document\.createElement\('style'\)/)
  assert.match(client, /return \(\) => \{ tag\.remove\(\); \}/)
})

test('visible text goes through the locale seat, never a hard-coded string in the view', () => {
  assert.match(client, /ctx\.locale\.register\('richPresence'/)
  assert.match(client, /locale: 'richPresence'/)
  // Both languages the bundle ships must be registered.
  assert.match(client, /en: \{/)
  assert.match(client, /zh: \{/)
})

test('the form reads the entry through configForms because this slot supplies none', () => {
  assert.match(client, /ctx\.configForms\.get\('rich-presence'\)|configForms/)
  // The slot owner passes `{ view }` only for a bundle page, so depending on a
  // `form` prop would render an empty page.
  assert.match(client, /view === 'summary'/)
})

test('styles use theme tokens rather than literal colors', () => {
  const styleBlock = client.slice(client.indexOf('const CSS = ['), client.indexOf('].join(\'\')'))
  const literals = [...styleBlock.matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g)]
  assert.equal(literals.length, 0, 'a literal color cannot follow the host theme')
  assert.ok(styleBlock.includes('var(--dsw-alias-'), 'the form must style with theme tokens')
})

test('the artifact never claims a save it did not make', () => {
  // A refused write must surface, not be swallowed into a success notice.
  assert.match(client, /if \(accepted\)/)
  assert.match(client, /saveFailed/)
})

test('client.js is included in the published file list', () => {
  assert.ok(manifest.files.includes('client.js'))
})

/** Evaluate the artifact the way the module loader does, without a DOM. */
function evaluateBundle(): {
  inject: string[]
  dictionaries: Map<string, Record<string, Record<string, string>>>
  slot: { name: string; key?: string; locale?: string; view: (props: unknown) => unknown }
} {
  let registration: {
    id: string
    exports: {
      inject: string[]
      apply(ctx: unknown): void
    }
  } | undefined
  const dictionaries = new Map<string, Record<string, Record<string, string>>>()
  let slot: { name: string; key?: string; locale?: string; view: (props: unknown) => unknown } | undefined

  const react = {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
    useState: (value: unknown) => [value, () => {}],
    useEffect: () => {},
    useMemo: (fn: () => unknown) => fn(),
  }
  const fakeWindow = {
    __ModuleLoader__: {
      load({ id, factory }: { id: string; factory: (r: (s: string) => unknown) => unknown }) {
        registration = { id, exports: factory(() => react) as never }
      },
    },
  }
  // The factory closes over `window`; the artifact is a classic script, so this
  // mirrors how the loader hands it the page global.
  new Function('window', 'document', client)(fakeWindow, {
    createElement: () => ({ setAttribute() {}, appendChild() {}, remove() {} }),
    head: { appendChild() {} },
  })
  const ctx = {
    effect: (factory: () => unknown) => { factory() },
    locale: { register: (ns: string, table: Record<string, Record<string, string>>) => { dictionaries.set(ns, table) } },
    slots: {
      inject: (_name: string, register: () => void) => { register() },
      register: (options: never, view: never) => { slot = { ...options, view } },
    },
  }
  registration?.exports.apply(ctx)
  if (registration === undefined || slot === undefined) throw new Error('the bundle registered nothing')
  return { inject: registration.exports.inject, dictionaries, slot }
}

test('the bundle applies and registers exactly one configuration page', () => {
  const bundle = evaluateBundle()
  assert.deepEqual(bundle.inject, ['slots', 'locale', 'configForms'])
  assert.equal(bundle.slot.name, 'plugins.bundle.config')
  assert.equal(bundle.slot.key, '@local/rich-presence')
  assert.equal(bundle.slot.locale, 'richPresence')
})

test('every locale carries the same keys, so no language falls back mid-form', () => {
  const { dictionaries } = evaluateBundle()
  const table = dictionaries.get('richPresence')
  assert.ok(table !== undefined)
  const languages = Object.keys(table)
  assert.deepEqual(languages.sort(), ['en', 'zh'])
  const en = Object.keys(table.en ?? {}).sort()
  const zh = Object.keys(table.zh ?? {}).sort()
  assert.deepEqual(zh, en, 'a key missing from one language renders as a raw key')
})

test('the summary view answers for an absent, a published, and a log-only configuration', () => {
  const { slot } = evaluateBundle()
  const t = (key: string) => key
  const summary = (value: unknown) => slot.view({
    view: 'summary',
    t,
    form: { getSnapshot: () => ({ status: 'ready', value }) },
  })
  assert.equal(summary({ discord: { clientId: '' }, connection: { transport: 'auto' } }), 'summaryNoId')
  assert.equal(summary({ discord: { clientId: '1' }, connection: { transport: 'auto' } }), 'summaryConnected')
  assert.equal(summary({ discord: { clientId: '1' }, connection: { transport: 'log' } }), 'summaryLog')
  assert.equal(summary(undefined), 'summaryNoId', 'an unread configuration must not claim to publish')
})
