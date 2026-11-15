/**
 * Show the running agent as Discord Rich Presence.
 *
 * The displayed phase, turn, and token figures all come from committed session
 * events, so a reopened session shows the same thing it showed before, and no
 * second copy of the transcript is kept in memory.
 *
 * Every configuration group is a volatile reference, so the plugin page can
 * save a change without a restart: the loader commits the new values into those
 * references and this module rebuilds only the pipeline layer that changed.
 *
 * @module dsh-rich-presence
 */

import z from '@deepseek-ai/schemastery'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ProjectionHandle, ProjectionKeySelection } from '@deepseek-ai/dsh-session-projection'
import { ACTIVITY_KEY, activityProjection, type ActivityState } from './activity.ts'
import { DiscordClient, type ClientConfig } from './discord/client.ts'
import type { ClientLogger } from './discord/client.ts'
import { FocusTracker, countSubagents, snapshotOf, type ProjectionReadout } from './focus.ts'
import { Publisher, LogTransport, type Transport } from './publish.ts'
import { DEFAULT_MODEL_IMAGES, renderActivity, type ActivityPayload, type UsageTotals } from './render.ts'
import {
  DEFAULT_CLIENT_ID,
  DEFAULT_KEYS,
  DEFAULTS,
  publishesToDiscord,
  readSettings,
  reconcileKeys,
  renderConfigOf,
  type ConnectionSettings,
  type DiscordSettings,
  type FocusSettings,
  type PresenceSettings,
  type PrivacySettings,
  type SettingsSnapshot,
  type UpdateSettings,
} from './settings.ts'

/** Cordis plugin name. */
export const name = 'rich-presence'

/**
 * Services this plugin registers into.
 *
 * `settings` is deliberately absent: the plugin must run in profiles that do not
 * compose it, so the live-update listener attaches only when the service exists.
 */
export const inject = ['agents', 'sessionProjections']

/** Discord limits `details`, `state`, and the two hover texts to 128 characters. */
const TEXT_LIMIT = 128

/**
 * Plugin configuration, every field defaulted so the row needs no settings.
 *
 * Each group is declared volatile by the schema below, so the plugin page can
 * save a change without restarting.
 */
export interface Config {
  /** Discord application id and card decoration. */
  discord: Volatile<DiscordSettings>
  /** Display templates, labels, and timers. */
  presence: Volatile<PresenceSettings>
  /** What may be published publicly. */
  privacy: Volatile<PrivacySettings>
  /** Which live agent is displayed. */
  focus: Volatile<FocusSettings>
  /** Transport and reconnect behaviour. */
  connection: Volatile<ConnectionSettings>
  /** Publish rate limits. */
  update: Volatile<UpdateSettings>
}

/** Schemastery validation; invalid values fail at load. */
export const Config = z.object({
  discord: z.object({
    clientId: z.string().default(DEFAULT_CLIENT_ID)
      .description('Discord application id. Defaults to the DSH application, whose uploaded artwork the model rules name, so a fresh install publishes immediately. Replace it to publish under your own application; clear it to write payloads to the log instead.'),
    activityType: z.union([0, 2, 3, 5]).default(0)
      .description('Activity type: 0 playing, 2 listening, 3 watching, 5 competing.'),
    buttons: z.array(z.object({
      label: z.string(),
      url: z.string(),
    })).default([])
      .description('At most two buttons shown on the activity card.'),
  }).volatile().default({}),
  presence: z.object({
    details: z.string().min(1).default('{activity} · {folder}')
      .description('Template for the first text line.'),
    state: z.string().min(1).default('{model} · {context} · {tokens}')
      .description('Template for the second text line.'),
    largeText: z.string().default('{progress}')
      .description('Template for the large-image hover text.'),
    smallText: z.string().default('{activity} · {subagents}')
      .description('Template for the small-image hover text.'),
    largeImage: z.string().default('')
      .description('Asset name of the large image, uploaded to the Discord application.'),
    modelImages: z.array(z.object({
      asset: z.string(),
      patterns: z.array(z.string()),
    })).default(DEFAULT_MODEL_IMAGES)
      .description('Rules that pick the large image from the running model: a keyword matches when it is the start of one word of the model id, and the first matching rule wins. An unmatched model uses largeImage.'),
    smallImageRunning: z.string().default('deepseek_harness')
      .description('Asset name of the small image while the agent works.'),
    smallImageIdle: z.string().default('deepseek_harness')
      .description('Asset name of the small image while the agent is idle.'),
    labels: z.dict(z.string()).default({})
      .description('Phase wording overrides, such as { thinking: "思考" }. Keys: approval, compacting, tool ({tool} is replaced), toolHidden, thinking, working, queued, idle.'),
    elapsed: z.union(['session', 'turn', 'off']).default('turn')
      .description('Which start time the elapsed timer counts from. "session" replays the original start time on a resumed session.'),
    truncateAt: z.number().min(2).max(TEXT_LIMIT).default(TEXT_LIMIT)
      .description('Maximum characters per text field.'),
    showWhenIdle: z.boolean().default(true)
      .description('Publish an activity when no agent is running.'),
  }).volatile().default({}),
  privacy: z.object({
    showToolNames: z.boolean().default(true)
      .description('Display the name of the running tool.'),
    showFolder: z.boolean().default(true)
      .description('Display the base name of the session working directory.'),
  }).volatile().default({}),
  focus: z.object({
    mode: z.union(['active', 'latest']).default('active')
      .description('Prefer the running session, or the most recently active one.'),
    includeSubagents: z.boolean().default(false)
      .description('Allow a delegated session to be the displayed one.'),
  }).volatile().default({}),
  connection: z.object({
    transport: z.union(['auto', 'ipc', 'log']).default('auto')
      .description('Transport to use; auto picks ipc when a client id is set.'),
    reconnectMs: z.number().min(100).default(5_000)
      .description('Backoff floor in milliseconds.'),
    maxReconnectMs: z.number().min(1_000).default(60_000)
      .description('Backoff ceiling in milliseconds.'),
    extraPipePaths: z.array(z.string()).default([])
      .description('Extra Discord IPC endpoints tried before the platform defaults.'),
  }).volatile().default({}),
  update: z.object({
    debounceMs: z.number().min(0).default(400)
      .description('Quiet time after the last change before a send.'),
    minIntervalMs: z.number().min(0).default(15_000)
      .description('Minimum spacing between two sends.'),
  }).volatile().default({}),
})

/** Selected transport plus the hooks the plugin needs to drive it. */
interface ChosenTransport {
  transport: Transport
  /** Connection settings, present only for the IPC transport. */
  client?: DiscordClient
  /** Whether the transport can produce a visible result at all. */
  label: 'ipc' | 'log'
}

/** Projection keys read for one session; both are optional at runtime. */
const TOKEN_KEYS = ['tokenUsage', 'contextPressure']

/**
 * Read the token-meter projections for one session.
 *
 * The keys are registered by `dsh-token-meter`, which this plugin does not
 * require and does not import: an unmounted meter simply contributes nothing
 * and the related segments disappear from the display. The payloads are read
 * structurally so a different meter version degrades to "no figures" instead
 * of a type or runtime error.
 *
 * @param ctx - plugin context, used to reach the projection registry.
 * @param session - the session to read.
 * @returns whichever token values are available.
 */
function readTokens(ctx: Context, session: Session): ProjectionReadout {
  const projections = ctx.get('sessionProjections')
  if (projections === undefined) return {}
  // The keys live in dsh-token-meter's own projection map augmentation, which
  // this optional dependency deliberately does not import at type level.
  const selection = TOKEN_KEYS as unknown as ProjectionKeySelection
  const { values } = projections.snapshot(session, selection) as { values: Record<string, unknown> }
  const usage = readUsage(values.tokenUsage)
  const contextTokens = readNumber(readField(values.contextPressure, 'pressureTokens'))
  return {
    ...usage === undefined ? {} : { usage },
    ...contextTokens === undefined ? {} : { contextTokens },
  }
}

/**
 * Read one field of an unknown payload.
 * @param value - the payload.
 * @param key - field name.
 * @returns the field, or `undefined` for a non-object payload.
 */
function readField(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  return (value as Record<string, unknown>)[key]
}

/**
 * Read a token count.
 * @param value - candidate value.
 * @returns the count, or `undefined` when it is absent or not a number.
 */
function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * Read accumulated provider usage.
 * @param value - the `tokenUsage` projection value.
 * @returns the four buckets, or `undefined` when the projection is absent.
 */
function readUsage(value: unknown): UsageTotals | undefined {
  const input = readNumber(readField(value, 'uncachedInputTokens'))
  const output = readNumber(readField(value, 'outputTokens'))
  if (input === undefined || output === undefined) return undefined
  return {
    uncachedInputTokens: input,
    outputTokens: output,
    cacheReadTokens: readNumber(readField(value, 'cacheReadTokens')) ?? 0,
    cacheWriteTokens: readNumber(readField(value, 'cacheWriteTokens')) ?? 0,
  }
}

/**
 * Choose the transport from one configuration snapshot.
 * @param settings - the current configuration.
 * @param logger - destination for connection outcomes.
 * @returns the transport and the client driving it, when one exists.
 */
function chooseTransport(settings: SettingsSnapshot, logger: ClientLogger): ChosenTransport {
  const { connection, discord } = settings
  const clientId = discord.clientId.trim()
  if (!publishesToDiscord(settings)) {
    // Name the reason the person actually chose: a forced local transport is a
    // decision, while a missing id is the default they have not changed.
    const reason = connection.transport === 'log'
      ? 'connection.transport is "log"'
      : 'no discord.clientId configured'
    return { transport: new LogTransport(logger, reason), label: 'log' }
  }
  if (clientId.length === 0) {
    logger.warn('rich-presence: connection.transport is "ipc" but discord.clientId is empty; falling back to the log transport')
    return { transport: new LogTransport(logger, 'connection.transport is "ipc" without a client id'), label: 'log' }
  }
  const clientConfig: ClientConfig = {
    clientId,
    reconnectMs: connection.reconnectMs,
    maxReconnectMs: connection.maxReconnectMs,
    extraPipePaths: connection.extraPipePaths,
  }
  // Report the first outage of each cycle once, at warning level: a user whose
  // Discord client is closed otherwise sees an unchanged profile and no clue.
  let unreachableWarned = false
  const client = new DiscordClient(clientConfig, logger, state => {
    if (state === 'ready') {
      unreachableWarned = false
      logger.info('rich-presence: connected to the discord client')
      return
    }
    if (state === 'closed' && !unreachableWarned) {
      unreachableWarned = true
      logger.warn(
        'rich-presence: cannot reach a running Discord desktop client; retrying in the background every %d–%d ms',
        connection.reconnectMs,
        connection.maxReconnectMs,
      )
    }
  })
  return { transport: { send: activity => client.update(activity) }, client, label: 'ipc' }
}

/**
 * Attach the payload decoration Discord accepts but no template produces.
 * @param activity - the rendered text fields.
 * @param settings - the current configuration.
 * @returns the activity, or `null` when nothing should be sent.
 */
function decorate(activity: ActivityPayload | undefined, settings: SettingsSnapshot): ActivityPayload | null {
  if (activity === undefined) return null
  const buttons = settings.discord.buttons
    .filter(button => button.label.length > 0 && /^https?:\/\//.test(button.url))
    .slice(0, 2)
  return {
    type: settings.discord.activityType,
    ...activity,
    ...buttons.length === 0 ? {} : { buttons },
  }
}

/**
 * The live publish pipeline: the transport, the publisher, and the projection
 * handle whose data both consume.
 *
 * A configuration save rebuilds the layers that the change invalidates — the
 * Discord connection, the rate limiter, or nothing but the card — so a template
 * edit never drops a working connection.
 */
class Pipeline {
  private chosen: ChosenTransport
  private publisher: Publisher
  private settings: SettingsSnapshot
  private keys = DEFAULT_KEYS
  private handle: ProjectionHandle<ActivityState> | undefined
  private readonly ctx: Context
  private readonly focus: FocusTracker
  private readonly logger: ReturnType<Context['logger']>

  /**
   * @param ctx - plugin context, used for the registry and the agent list.
   * @param focus - the tracked live agents.
   * @param logger - where connection and render failures are reported.
   * @param settings - the configuration snapshot to build from.
   */
  constructor(
    ctx: Context,
    focus: FocusTracker,
    logger: ReturnType<Context['logger']>,
    settings: SettingsSnapshot,
  ) {
    this.ctx = ctx
    this.focus = focus
    this.logger = logger
    this.settings = settings
    this.chosen = chooseTransport(settings, this.logger)
    this.publisher = this.createPublisher()
    this.keys = reconcileKeys(settings)
    this.chosen.client?.start()
    if (this.chosen.label === 'log' && settings.discord.clientId.trim().length === 0) {
      this.logger.info(
        'rich-presence: no discord.clientId configured; activities are written to this log. Set discord.clientId to a Discord application id to publish them.',
      )
    }
  }

  /** Read the selected agent's projection state, tolerating a not-yet-registered unit. */
  private activityOf(session: Session): ActivityState | undefined {
    try {
      return this.handle?.stateOf(session)
    } catch (error) {
      this.logger.debug('rich-presence: cannot read activity state: %o', error)
      return undefined
    }
  }

  /** Build a publisher over the current transport and rate limits. */
  private createPublisher(): Publisher {
    return new Publisher(
      this.settings.update,
      this.chosen.transport,
      Date.now,
      error => this.logger.warn('rich-presence: cannot render an activity: %o', error),
    )
  }

  /**
   * Attach the activity projection once the registry accepts it.
   * @param ctx - plugin context owning the registration.
   */
  registerProjection(ctx: Context): void {
    let disposed = false
    void ctx.sessionProjections.register(activityProjection()).then(
      registered => {
        if (disposed) {
          void registered.dispose()
          return
        }
        this.handle = registered
        this.refresh()
      },
      (error: unknown) => {
        this.logger.warn('rich-presence: cannot register the activity projection: %o', error)
      },
    )
    ctx.effect(() => () => {
      disposed = true
    }, 'rich-presence: activity projection owner')
  }

  /** Produce the activity that should be displayed right now. */
  private resolve(): ActivityPayload | null {
    const { focus, privacy, presence } = this.settings
    const agent = this.focus.select(focus.mode, focus.includeSubagents)
    if (agent === undefined) {
      if (!presence.showWhenIdle) return null
      // With no agent at all, the honest card is the same one an idle agent
      // shows: the presence is on, nothing is running.
      return decorate(renderActivity({ phase: 'idle', subagents: 0 }, renderConfigOf(this.settings), false, false), this.settings)
    }
    const activity = this.activityOf(agent.session)
    if (activity === undefined) return null
    const snapshot = snapshotOf(
      agent,
      activity,
      readTokens(this.ctx, agent.session),
      countSubagents(this.focus.ranked(), agent),
    )
    return decorate(
      renderActivity(snapshot, renderConfigOf(this.settings), privacy.showToolNames, privacy.showFolder),
      this.settings,
    )
  }

  /** Recompute and, if it changed, publish. */
  refresh(): void {
    this.publisher.offer(() => this.resolve())
  }

  /**
   * Apply a new configuration snapshot.
   *
   * Only the layers whose own key moved are rebuilt, and the card is always
   * recomputed last so the person sees the new wording immediately.
   *
   * @param settings - the configuration as it now reads.
   */
  reconfigure(settings: SettingsSnapshot): void {
    const next = reconcileKeys(settings)
    const reconnect = next.transport !== this.keys.transport
    const rethrottle = next.update !== this.keys.update
    const hadClient = this.chosen.client !== undefined
    this.settings = settings
    this.keys = next

    if (reconnect) {
      this.chosen.client?.dispose()
      this.chosen = chooseTransport(settings, this.logger)
      this.chosen.client?.start()
      // The publisher holds the old transport, so a reconnect always implies a
      // new publisher even when the rate limits did not move.
      this.publisher.dispose()
      this.publisher = this.createPublisher()
    } else if (rethrottle) {
      this.publisher.dispose()
      this.publisher = this.createPublisher()
    }
    if (reconnect && hadClient && this.chosen.label === 'log') {
      this.logger.info('rich-presence: now writing activities to this log instead of Discord')
    }
    this.refresh()
  }

  /** Release the connection and the publisher. */
  dispose(): void {
    this.publisher.dispose()
    this.chosen.client?.dispose()
  }
}

/**
 * Register the projection, the transport, and the update triggers.
 * @param ctx - plugin context owning every registration.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const logger = ctx.logger('rich-presence')
  const focus = new FocusTracker()
  const pipeline = new Pipeline(ctx, focus, logger, readSettings(config))

  ctx.effect(() => () => pipeline.dispose(), 'rich-presence: pipeline')

  pipeline.registerProjection(ctx)

  const refresh = (): void => pipeline.refresh()

  // A volatile save reaches the running plugin through the loader; this event
  // reports the entry's new revision, and the pipeline reads the committed
  // values itself. Without the settings service the configuration is static.
  if (ctx.get('settings') !== undefined) {
    ctx.on('settings/document-updated', (namespace) => {
      if (namespace !== name) return
      pipeline.reconfigure(readSettings(config))
    })
  }

  const track = (agent: Agent): void => {
    focus.track(agent)
    refresh()
  }

  ctx.on('agent/created', ({ agent }) => {
    track(agent)
    return undefined
  })
  ctx.on('agent/disposed', ({ agent }) => {
    focus.forget(agent)
    refresh()
  })
  ctx.on('agent/status', ({ agent }) => {
    focus.touch(agent)
    refresh()
  })
  ctx.on('session/event', (session) => {
    const agent = ctx.agents.get(session.id)
    if (agent === undefined) return
    focus.touch(agent)
    refresh()
  })

  for (const agent of ctx.agents.list()) track(agent)

  refresh()
}

/** Re-exported so the locale resource and the plugin row share one key. */
export { ACTIVITY_KEY }

/** Re-exported for the plugin page's copy of the defaults. */
export { DEFAULTS }

/** Re-exported so the shipped application id has one declaration. */
export { DEFAULT_CLIENT_ID }
