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
  name: string
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
  // Pinned to the manifest rather than a second copy of the literal, so a
  // rename only has to be made in one place and a mismatch fails here.
  assert.equal(manifest.name, '@dsh-plugin/dsh-rich-presence')
  assert.equal(key, manifest.name, 'the slot key must equal the package name')
  assert.equal(manifest.exports['.'].default, './lib/index.js')
})

test('the bundle declares the canonical browser entry for this bundle family', () => {
  assert.equal(manifest.dsh.client?.platform, 'web')
  assert.match(client, /window\.__ModuleLoader__\.load\(\{/)
  assert.ok(
    client.includes(`id: '${manifest.name}'`),
    'the module id must equal the package name the page looks up',
  )
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
function evaluateBundle(options: { configForms?: 'present' | 'absent' } = {}): {
  inject: string[]
  dictionaries: Map<string, Record<string, Record<string, string>>>
  slot: { name: string; key?: string; locale?: string; view: (props: unknown) => unknown }
  formRequests: string[]
  subscribed: () => number
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
  const formRequests: string[] = []
  let listeners = 0

  const snapshot = {
    status: 'ready',
    value: { discord: { clientId: '1', activityType: 0, buttons: [] }, connection: { transport: 'auto' } },
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
  }
  const react = {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
    useState: (value: unknown) => [typeof value === 'function' ? (value as () => unknown)() : value, () => {}],
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
    ...options.configForms === 'absent' ? {} : {
      configForms: {
        get: (id: string) => {
          formRequests.push(id)
          return {
            getSnapshot: () => snapshot,
            subscribe: () => { listeners += 1; return () => {} },
            mutate: async () => true,
          }
        },
      },
    },
  }
  registration?.exports.apply(ctx)
  if (registration === undefined || slot === undefined) throw new Error('the bundle registered nothing')
  return { inject: registration.exports.inject, dictionaries, slot, formRequests, subscribed: () => listeners }
}

/**
 * Expand element wrappers until a host element or a plain value appears.
 *
 * The registered entry is a wrapper that binds the resolved form, so one call
 * only proves the wrapper ran; the bug this guards against lived one level
 * deeper, in the component that read an absent `form` prop.
 */
function render(element: unknown, depth = 6): unknown {
  let current = element
  for (let step = 0; step < depth; step += 1) {
    if (typeof current !== 'object' || current === null) return current
    const node = current as { type?: unknown; props?: Record<string, unknown> }
    if (typeof node.type !== 'function') return current
    current = (node.type as (props: unknown) => unknown)(node.props)
  }
  return current
}

/** Read one rendered element's className, tolerating a non-element result. */
function classNameOf(element: unknown): string | undefined {
  const node = element as { props?: { className?: string } } | string | undefined
  return typeof node === 'object' && node !== null ? node.props?.className : undefined
}

test('the bundle applies and registers exactly one configuration page', () => {
  const bundle = evaluateBundle()
  assert.deepEqual(bundle.inject, ['slots', 'locale', 'configForms'])
  assert.equal(bundle.slot.name, 'plugins.bundle.config')
  assert.equal(bundle.slot.key, '@dsh-plugin/dsh-rich-presence')
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
  const summary = (value: unknown) => render(slot.view({
    view: 'summary',
    t,
    form: { getSnapshot: () => ({ status: 'ready', value }) },
  }))
  assert.equal(summary({ discord: { clientId: '' }, connection: { transport: 'auto' } }), 'summaryNoId')
  assert.equal(summary({ discord: { clientId: '1' }, connection: { transport: 'auto' } }), 'summaryConnected')
  assert.equal(summary({ discord: { clientId: '1' }, connection: { transport: 'log' } }), 'summaryLog')
  assert.equal(summary(undefined), 'summaryNoId', 'an unread configuration must not claim to publish')
})

test('the page view resolves its own form, because this slot supplies none', () => {
  // The page calls renderSlot('plugins.bundle.config', { view: 'page' }) with no
  // form, so a view that reads `props.form` renders nothing: React throws on the
  // first `undefined.getSnapshot()` and the whole slot entry is dropped.
  const bundle = evaluateBundle()
  assert.deepEqual(bundle.formRequests, ['rich-presence'], 'the entry id is the form namespace')
  const rendered = render(bundle.slot.view({ view: 'page', t: (key: string) => key }))
  assert.equal(classNameOf(rendered), 'rp-form', 'the page view must render without a form prop')
})

test('a bundle page never crashes when the form service is missing', () => {
  const bundle = evaluateBundle({ configForms: 'absent' })
  const rendered = render(bundle.slot.view({ view: 'page', t: (key: string) => key }))
  assert.equal(classNameOf(rendered), 'rp-status', 'it explains the absence instead of throwing')
})

test('a form supplied by the owner still wins, so the view is reusable in another slot', () => {
  const bundle = evaluateBundle()
  const ownerForm = { getSnapshot: () => ({ status: 'ready', value: { discord: { clientId: '' } } }) }
  const summary = render(bundle.slot.view({ view: 'summary', t: (key: string) => key, form: ownerForm }))
  assert.equal(summary, 'summaryNoId', 'the owner form was read, not the resolved one')
})

/**
 * Theme tokens this build defines, read from a running page's computed style.
 *
 * A token name that does not exist resolves to nothing, so the declaration is
 * dropped silently: an input loses its border and a label loses its colour, and
 * the page looks unstyled instead of reporting anything. That is exactly what an
 * invented name costs, so the names are pinned here.
 */
const KNOWN_TOKENS = new Set([
  '--dsw-radius-sm', '--dsw-radius-md', '--dsw-radius-lg',
  '--dsw-focus-ring-width', '--dsw-focus-ring-color',
  '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3', '--dsw-alias-bg-layer-4',
  '--dsw-alias-bg-base', '--dsw-alias-bg-module-platform', '--dsw-alias-bg-overlay',
  '--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-border-l3', '--dsw-alias-border-l4',
  '--dsw-alias-border-selected', '--dsw-alias-border-l2-darkmode-thin',
  '--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary',
  '--dsw-alias-label-primary-foreground', '--dsw-alias-label-primary-inverted', '--dsw-alias-label-on-color',
  '--dsw-alias-label-error', '--dsw-alias-label-caption', '--dsw-alias-label-dimmed',
  '--dsw-alias-fill-l1', '--dsw-alias-fill-l2', '--dsw-alias-fill-tsp-secondary',
  '--dsw-alias-interactive-bg-hover', '--dsw-alias-interactive-bg-active',
  '--dsw-alias-interactive-bg-hover-danger', '--dsw-alias-interactive-bg-hover-solid',
  '--dsw-alias-button-primary-fill', '--dsw-alias-button-primary-hover', '--dsw-alias-button-primary-dimmed',
  '--dsw-alias-button-ghost-active-border', '--dsw-alias-button-ghost-active-fill',
  '--dsw-alias-state-business-primary', '--dsw-alias-state-error-primary', '--dsw-alias-state-warn-label',
  '--dsw-alias-brand-primary', '--dsw-alias-brand-text',
  '--dsw-alias-switch-thumb',
  '--dsw-alias-card-fill', '--dsw-alias-card-fill-hover',
])

test('every theme token the form uses exists in this build', () => {
  const used = [...new Set([...client.matchAll(/var\((--dsw-[a-z0-9-]+)/g)].map(match => match[1]))]
  assert.ok(used.length > 0, 'the form must style with theme tokens')
  const unknown = used.filter(token => !KNOWN_TOKENS.has(token))
  assert.deepEqual(unknown, [], 'an unknown token name silently drops the declaration')
})

test('the form does not fall back to a boot-only token vocabulary', () => {
  // `--dsh-boot-*` exists only while the boot screen renders, so a control that
  // relies on it has no colour once the app is up.
  assert.doesNotMatch(client, /var\(--dsh-boot-/)
})

test('each control is styled, so no field renders as a bare browser element', () => {
  const css = client.slice(client.indexOf('const CSS = ['), client.indexOf("].join('')"))
  const markup = new Set(
    [...client.matchAll(/className: '([^']+)'/g)].flatMap(match => match[1].split(' ')).filter(name => name.startsWith('rp-')),
  )
  const styled = new Set([...css.matchAll(/\.(rp-[a-z-]+)/g)].map(match => match[1]))
  assert.deepEqual([...markup].filter(name => !styled.has(name)), [], 'every rendered class has a rule')
})
