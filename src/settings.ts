/**
 * Turning live plugin configuration into the values the presence pipeline needs.
 *
 * The Host declares every configuration group as a volatile reference, so a
 * save from the plugin page reaches the running plugin without a restart. This
 * module is the one place that reads those references, so the values a render
 * sees and the values a reconcile compares always come from the same snapshot.
 *
 * The parsing helpers live here too, so the wire format the page edits (one
 * button per line, one label per line) is defined beside the code that reads it
 * rather than inside a browser bundle that cannot be tested here.
 *
 * @module dsh-rich-presence/settings
 */

import type { Volatile } from '@deepseek-ai/cordis'
import type { RenderConfig } from './render.ts'

/** Discord's four activity types this plugin offers. */
export type ActivityType = 0 | 2 | 3 | 5

/** One clickable card button. */
export interface PresenceButton {
  label: string
  url: string
}

/** Discord connection settings, as stored. */
export interface DiscordSettings {
  clientId: string
  activityType: ActivityType
  buttons: PresenceButton[]
}

/** Display settings, as stored. */
export interface PresenceSettings {
  details: string
  state: string
  largeText: string
  smallText: string
  largeImage: string
  smallImageRunning: string
  smallImageIdle: string
  labels: Record<string, string>
  elapsed: 'session' | 'turn' | 'off'
  truncateAt: number
  showWhenIdle: boolean
}

/** What may be published publicly. */
export interface PrivacySettings {
  showToolNames: boolean
  showFolder: boolean
}

/** Which live agent is displayed. */
export interface FocusSettings {
  mode: 'active' | 'latest'
  includeSubagents: boolean
}

/** Transport and reconnect settings, as stored. */
export interface ConnectionSettings {
  transport: 'auto' | 'ipc' | 'log'
  reconnectMs: number
  maxReconnectMs: number
  extraPipePaths: string[]
}

/** Publish rate settings, as stored. */
export interface UpdateSettings {
  debounceMs: number
  minIntervalMs: number
}

/**
 * The plugin's configuration as the running pipeline reads it.
 *
 * Each group is a volatile reference: keep the reference and call `.get()`, or
 * capture one `SettingsSnapshot` for a single operation.
 */
export interface Config {
  discord: Volatile<DiscordSettings>
  presence: Volatile<PresenceSettings>
  privacy: Volatile<PrivacySettings>
  focus: Volatile<FocusSettings>
  connection: Volatile<ConnectionSettings>
  update: Volatile<UpdateSettings>
}

/** Every stored group in plain form, with defaults resolved. */
export interface SettingsSnapshot {
  discord: DiscordSettings
  presence: PresenceSettings
  privacy: PrivacySettings
  focus: FocusSettings
  connection: ConnectionSettings
  update: UpdateSettings
}

/** Discord's own text limit, mirrored here so the page can validate without importing the renderer. */
export const MAX_TEXT = 128

/** The largest value `presence.truncateAt` may hold. */
export const MAX_TRUNCATE_AT = MAX_TEXT

/** Smallest reconnect delay the page accepts, in milliseconds. */
export const MIN_RECONNECT_MS = 100

/** Smallest maximum reconnect delay the page accepts, in milliseconds. */
export const MIN_MAX_RECONNECT_MS = 1_000

/** Built-in defaults for every group; the schema's defaults mirror these. */
export const DEFAULTS: SettingsSnapshot = {
  discord: { clientId: '', activityType: 0, buttons: [] },
  presence: {
    details: '{activity} · {folder}',
    state: '{model} · {context} · {tokens}',
    largeText: '{progress}',
    smallText: '{activity} · {subagents}',
    largeImage: '',
    smallImageRunning: '',
    smallImageIdle: '',
    labels: {},
    elapsed: 'turn',
    truncateAt: MAX_TEXT,
    showWhenIdle: true,
  },
  privacy: { showToolNames: true, showFolder: true },
  focus: { mode: 'active', includeSubagents: false },
  connection: { transport: 'auto', reconnectMs: 5_000, maxReconnectMs: 60_000, extraPipePaths: [] },
  update: { debounceMs: 400, minIntervalMs: 15_000 },
}

/**
 * Read one volatile group, falling back to its defaults.
 *
 * A loader that has not yet committed the reference, or an older stored config,
 * can leave a group absent; treating that as "use the defaults" keeps the
 * presence working instead of failing the whole plugin.
 *
 * @param reference - the volatile reference, when present.
 * @param fallback - the group's defaults.
 * @returns the group with every field present.
 */
function readGroup<T extends object>(
  reference: Volatile<T> | undefined,
  fallback: T,
): T {
  const value = reference !== undefined && typeof reference.get === 'function'
    ? reference.get() as Partial<T> | undefined
    : undefined
  if (value === undefined || value === null || typeof value !== 'object') return { ...fallback }
  return { ...fallback, ...value }
}

/**
 * Capture the live configuration as one plain snapshot.
 * @param config - the plugin's configuration references.
 * @returns every group with defaults resolved.
 */
export function readSettings(config: Config): SettingsSnapshot {
  return {
    discord: readGroup(config.discord, DEFAULTS.discord),
    presence: readGroup(config.presence, DEFAULTS.presence),
    privacy: readGroup(config.privacy, DEFAULTS.privacy),
    focus: readGroup(config.focus, DEFAULTS.focus),
    connection: readGroup(config.connection, DEFAULTS.connection),
    update: readGroup(config.update, DEFAULTS.update),
  }
}

/**
 * Project the display groups into the renderer's configuration.
 * @param settings - one configuration snapshot.
 * @returns the render configuration.
 */
export function renderConfigOf(settings: SettingsSnapshot): RenderConfig {
  const { presence } = settings
  return {
    details: presence.details,
    state: presence.state,
    largeText: presence.largeText,
    smallText: presence.smallText,
    largeImage: presence.largeImage,
    smallImageRunning: presence.smallImageRunning,
    smallImageIdle: presence.smallImageIdle,
    labels: presence.labels,
    elapsed: presence.elapsed,
    truncateAt: presence.truncateAt,
    showWhenIdle: presence.showWhenIdle,
  }
}

/** Which layers a configuration change invalidates. */
export interface ReconcileKeys {
  /** Reconnect when this changes: the transport and the application id. */
  transport: string
  /** Replace the publisher when this changes. */
  update: string
  /** Re-render the card when this changes. */
  render: string
}

/**
 * Summarize a snapshot into the comparisons a reconcile needs.
 *
 * Splitting the snapshot this way is what lets a template edit redraw the card
 * without dropping the Discord connection, and a reconnect-delay edit avoid a
 * repaint.
 *
 * @param settings - one configuration snapshot.
 * @returns one stable key per layer.
 */
export function reconcileKeys(settings: SettingsSnapshot): ReconcileKeys {
  const { connection, discord, presence, privacy, update } = settings
  return {
    transport: JSON.stringify([
      connection.transport,
      discord.clientId.trim(),
      connection.reconnectMs,
      connection.maxReconnectMs,
      connection.extraPipePaths,
    ]),
    update: JSON.stringify([update.debounceMs, update.minIntervalMs]),
    render: JSON.stringify([
      JSON.stringify(discord.activityType),
      discord.buttons,
      presence.details,
      presence.state,
      presence.largeText,
      presence.smallText,
      presence.largeImage,
      presence.smallImageRunning,
      presence.smallImageIdle,
      presence.labels,
      presence.elapsed,
      presence.truncateAt,
      presence.showWhenIdle,
      JSON.stringify(privacy.showToolNames),
      JSON.stringify(privacy.showFolder),
    ]),
  }
}

/** The layer keys of {@link DEFAULTS}, so a first reconcile compares like with like. */
export const DEFAULT_KEYS: ReconcileKeys = reconcileKeys(DEFAULTS)

/** One parsed line, or the reason it was rejected. */
export interface ParseResult<T> {
  /** Accepted entries, in input order. */
  entries: T[]
  /** Human-readable problems, one per rejected line. */
  errors: string[]
}

/** The result of parsing a block of `key: value` lines into one record. */
export interface ParseResultMap {
  /** Accepted overrides, keyed by placeholder name. */
  entries: Record<string, string>
  /** Human-readable problems, one per rejected line. */
  errors: string[]
}

/**
 * Split text into non-empty trimmed lines.
 * @param text - multi-line input.
 * @returns one entry per non-empty line.
 */
function lines(text: string): string[] {
  return text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0)
}

/**
 * Parse the button text area: one `label | url` pair per line.
 *
 * Order is preserved and the caller decides the two-button limit, so a rejected
 * third button is reported rather than silently dropped here.
 *
 * @param text - multi-line button input.
 * @returns accepted buttons and one error per malformed line.
 */
export function parseButtons(text: string): ParseResult<PresenceButton> {
  const entries: PresenceButton[] = []
  const errors: string[] = []
  for (const line of lines(text)) {
    // The label is a short word and never contains the separator, while a URL
    // legitimately can, so the FIRST separator ends the label.
    const separator = line.indexOf('|')
    if (separator < 0) {
      errors.push(`Expected "label | url": ${line}`)
      continue
    }
    const label = line.slice(0, separator).trim()
    const url = line.slice(separator + 1).trim()
    if (label.length === 0) {
      errors.push(`Missing button label: ${line}`)
      continue
    }
    if (!/^https?:\/\//.test(url)) {
      errors.push(`Button URL must start with http:// or https://: ${line}`)
      continue
    }
    entries.push({ label, url })
  }
  return { entries, errors }
}

/**
 * Serialize buttons back into the text area format.
 * @param buttons - stored buttons.
 * @returns one line per button.
 */
export function formatButtons(buttons: readonly PresenceButton[]): string {
  return buttons.map(button => `${button.label} | ${button.url}`).join('\n')
}

/**
 * Parse the label text area: one `key: value` pair per line.
 *
 * The value may contain colons, so only the first separator counts.
 *
 * @param text - multi-line label input.
 * @returns a single record of accepted overrides and one error per malformed line.
 */
export function parseLabels(text: string): ParseResultMap {
  const records: Record<string, string> = {}
  const errors: string[] = []
  for (const line of lines(text)) {
    const separator = line.indexOf(':')
    if (separator <= 0) {
      errors.push(`Expected "key: value": ${line}`)
      continue
    }
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key)) {
      errors.push(`Label key must be a plain word: ${key}`)
      continue
    }
    records[key] = value
  }
  return { entries: records, errors }
}

/**
 * Serialize label overrides back into the text area format.
 * @param labels - stored overrides.
 * @returns one `key: value` line per override, sorted for a stable display.
 */
export function formatLabels(labels: Record<string, string>): string {
  return Object.keys(labels).sort().map(key => `${key}: ${labels[key]}`).join('\n')
}

/**
 * Parse the extra-endpoint text area: one endpoint per line.
 * @param text - multi-line endpoint input.
 * @returns accepted endpoints; blank lines contribute nothing.
 */
export function parseEndpoints(text: string): string[] {
  return lines(text)
}

/**
 * Serialize endpoints back into the text area format.
 * @param endpoints - stored endpoints.
 * @returns one line per endpoint.
 */
export function formatEndpoints(endpoints: readonly string[]): string {
  return endpoints.join('\n')
}
