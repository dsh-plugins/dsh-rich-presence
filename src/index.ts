/**
 * Show the running agent as Discord Rich Presence.
 *
 * The displayed phase, turn, and token figures all come from committed session
 * events, so a reopened session shows the same thing it showed before, and no
 * second copy of the transcript is kept in memory.
 *
 * @module dsh-rich-presence
 */

import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ProjectionHandle, ProjectionKeySelection } from '@deepseek-ai/dsh-session-projection'
import { ACTIVITY_KEY, activityProjection, type ActivityState } from './activity.ts'
import { DiscordClient, type ClientConfig } from './discord/client.ts'
import type { ClientLogger } from './discord/client.ts'
import { FocusTracker, countSubagents, snapshotOf, type ProjectionReadout } from './focus.ts'
import { Publisher, LogTransport, type Transport } from './publish.ts'
import { renderActivity, type ActivityPayload, type RenderConfig, type UsageTotals } from './render.ts'

/** Cordis plugin name. */
export const name = 'rich-presence'

/** Services this plugin registers into. */
export const inject = ['agents', 'sessionProjections']

/** Discord limits `details`, `state`, and the two hover texts to 128 characters. */
const TEXT_LIMIT = 128

/** Plugin configuration, every field defaulted so the row needs no settings. */
export interface Config {
  discord: {
    /** Discord application id; empty falls back to the log transport. */
    clientId: string
    /** Activity type Discord renders in the "playing/listening/watching" slot. */
    activityType: 0 | 2 | 3 | 5
    /** Button labels and links, at most two. */
    buttons: { label: string; url: string }[]
  }
  presence: {
    /** Template for Discord's first text line. */
    details: string
    /** Template for Discord's second text line. */
    state: string
    /** Template for the large-image hover text. */
    largeText: string
    /** Template for the small-image hover text. */
    smallText: string
    /** Asset name of the large image; empty shows the application's icon area empty. */
    largeImage: string
    /** Asset name of the small image while the agent works. */
    smallImageRunning: string
    /** Asset name of the small image while the agent is idle. */
    smallImageIdle: string
    /** Phase wording overrides; omitted entries keep the English defaults. */
    labels: Record<string, string>
    /** Which start time the elapsed timer counts from. */
    elapsed: 'session' | 'turn' | 'off'
    /** Maximum characters per text field, capped at Discord's 128. */
    truncateAt: number
    /** Publish an activity when no agent is running. */
    showWhenIdle: boolean
  }
  privacy: {
    /** Display the name of the tool that is running. */
    showToolNames: boolean
    /** Display the base name of the session working directory. */
    showFolder: boolean
  }
  focus: {
    /** Prefer the running session, or the most recently active one. */
    mode: 'active' | 'latest'
    /** Allow a delegated session to be the displayed one. */
    includeSubagents: boolean
  }
  connection: {
    /** Transport to use; `auto` picks ipc when a client id is set. */
    transport: 'auto' | 'ipc' | 'log'
    /** Backoff floor in milliseconds. */
    reconnectMs: number
    /** Backoff ceiling in milliseconds. */
    maxReconnectMs: number
    /** Extra endpoints tried before the platform defaults. */
    extraPipePaths: string[]
  }
  update: {
    /** Quiet time after the last change before a send. */
    debounceMs: number
    /** Minimum spacing between two sends. */
    minIntervalMs: number
  }
}

/** Schemastery validation; invalid values fail at load. */
export const Config: z<Config> = z.object({
  discord: z.object({
    clientId: z.string().default('')
      .description('Discord application id. Empty keeps the plugin running with the log transport.'),
    activityType: z.union([0, 2, 3, 5]).default(0)
      .description('Activity type: 0 playing, 2 listening, 3 watching, 5 competing.'),
    buttons: z.array(z.object({
      label: z.string(),
      url: z.string(),
    })).default([])
      .description('At most two buttons shown on the activity card.'),
  }).default({}),
  presence: z.object({
    details: z.string().min(1).default('{activity} · {folder}')
      .description('Template for the first text line.'),
    state: z.string().min(1).default('{model} · {context} · {tokens}')
      .description('Template for the second text line.'),
    largeText: z.string().default('{progress}')
      .description('Template for the large-image hover text. Discord shows it only when presence.largeImage names an uploaded asset.'),
    smallText: z.string().default('{activity} · {subagents}')
      .description('Template for the small-image hover text. Discord shows it only when a presence.smallImage* name is set.'),
    largeImage: z.string().default('')
      .description('Asset name of the large image, uploaded to the Discord application.'),
    smallImageRunning: z.string().default('')
      .description('Asset name of the small image while the agent works.'),
    smallImageIdle: z.string().default('')
      .description('Asset name of the small image while the agent is idle.'),
    labels: z.dict(z.string()).default({})
      .description('Phase wording overrides, such as { thinking: "思考" }. Keys: approval, compacting, tool ({tool} is replaced), toolHidden, thinking, working, queued, idle.'),
    elapsed: z.union(['session', 'turn', 'off']).default('turn')
      .description('Which start time the elapsed timer counts from. "session" replays the original start time on a resumed session.'),
    truncateAt: z.number().min(2).max(TEXT_LIMIT).default(TEXT_LIMIT)
      .description('Maximum characters per text field.'),
    showWhenIdle: z.boolean().default(true)
      .description('Publish an activity when no agent is running.'),
  }).default({}),
  privacy: z.object({
    showToolNames: z.boolean().default(true)
      .description('Display the name of the running tool.'),
    showFolder: z.boolean().default(true)
      .description('Display the base name of the session working directory.'),
  }).default({}),
  focus: z.object({
    mode: z.union(['active', 'latest']).default('active')
      .description('Prefer the running session, or the most recently active one.'),
    includeSubagents: z.boolean().default(false)
      .description('Allow a delegated session to be the displayed one.'),
  }).default({}),
  connection: z.object({
    transport: z.union(['auto', 'ipc', 'log']).default('auto')
      .description('Transport to use; auto picks ipc when a client id is set.'),
    reconnectMs: z.number().min(100).default(5_000)
      .description('Backoff floor in milliseconds.'),
    maxReconnectMs: z.number().min(1_000).default(60_000)
      .description('Backoff ceiling in milliseconds.'),
    extraPipePaths: z.array(z.string()).default([])
      .description('Extra Discord IPC endpoints tried before the platform defaults.'),
  }).default({}),
  update: z.object({
    debounceMs: z.number().min(0).default(400)
      .description('Quiet time after the last change before a send.'),
    minIntervalMs: z.number().min(0).default(15_000)
      .description('Minimum spacing between two sends.'),
  }).default({}),
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
 * Choose the transport from configuration and the presence of a client id.
 * @param config - validated plugin configuration.
 * @param logger - destination for connection outcomes.
 * @returns the transport and the client driving it, when one exists.
 */
function chooseTransport(config: Config, logger: ClientLogger): ChosenTransport {
  const clientId = config.discord.clientId.trim()
  const wantsIpc = config.connection.transport === 'ipc'
    || (config.connection.transport === 'auto' && clientId.length > 0)
  if (!wantsIpc) return { transport: new LogTransport(logger, 'no discord.clientId configured'), label: 'log' }
  if (clientId.length === 0) {
    logger.warn('rich-presence: connection.transport is "ipc" but discord.clientId is empty; falling back to the log transport')
    return { transport: new LogTransport(logger, 'connection.transport is "ipc" without a client id'), label: 'log' }
  }
  const clientConfig: ClientConfig = {
    clientId,
    reconnectMs: config.connection.reconnectMs,
    maxReconnectMs: config.connection.maxReconnectMs,
    extraPipePaths: config.connection.extraPipePaths,
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
        config.connection.reconnectMs,
        config.connection.maxReconnectMs,
      )
    }
  })
  return { transport: { send: activity => client.update(activity) }, client, label: 'ipc' }
}

/**
 * Attach the payload decoration Discord accepts but no template produces.
 * @param activity - the rendered text fields.
 * @param config - validated plugin configuration.
 * @returns the activity, or `undefined` when nothing should be sent.
 */
function decorate(activity: ActivityPayload | undefined, config: Config): ActivityPayload | null {
  if (activity === undefined) return null
  const buttons = config.discord.buttons
    .filter(button => button.label.length > 0 && /^https?:\/\//.test(button.url))
    .slice(0, 2)
  return {
    type: config.discord.activityType,
    ...activity,
    ...buttons.length === 0 ? {} : { buttons },
  }
}

/**
 * Register the projection, the transport, and the update triggers.
 * @param ctx - plugin context owning every registration.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const logger = ctx.logger('rich-presence')
  const chosen = chooseTransport(config, logger)
  const focus = new FocusTracker()
  const publisher = new Publisher(
    config.update,
    chosen.transport,
    Date.now,
    error => logger.warn('rich-presence: cannot render an activity: %o', error),
  )
  const renderConfig: RenderConfig = {
    details: config.presence.details,
    state: config.presence.state,
    largeText: config.presence.largeText,
    smallText: config.presence.smallText,
    largeImage: config.presence.largeImage,
    smallImageRunning: config.presence.smallImageRunning,
    smallImageIdle: config.presence.smallImageIdle,
    labels: config.presence.labels,
    elapsed: config.presence.elapsed,
    truncateAt: config.presence.truncateAt,
    showWhenIdle: config.presence.showWhenIdle,
  }

  let handle: ProjectionHandle<ActivityState> | undefined

  /** Read the selected agent's projection state, tolerating a not-yet-registered unit. */
  const activityOf = (session: Session): ActivityState | undefined => {
    try {
      return handle?.stateOf(session)
    } catch (error) {
      logger.debug('rich-presence: cannot read activity state: %o', error)
      return undefined
    }
  }

  /** Produce the activity that should be displayed right now. */
  const resolve = (): ActivityPayload | null => {
    const agent = focus.select(config.focus.mode, config.focus.includeSubagents)
    if (agent === undefined) {
      if (!config.presence.showWhenIdle) return null
      // With no agent at all, the honest card is the same one an idle agent
      // shows: the presence is on, nothing is running.
      return decorate(renderActivity({ phase: 'idle', subagents: 0 }, renderConfig, false, false), config)
    }
    const activity = activityOf(agent.session)
    if (activity === undefined) return null
    const snapshot = snapshotOf(
      agent,
      activity,
      readTokens(ctx, agent.session),
      countSubagents(focus.ranked(), agent),
    )
    return decorate(
      renderActivity(snapshot, renderConfig, config.privacy.showToolNames, config.privacy.showFolder),
      config,
    )
  }

  /** Recompute and, if it changed, publish. */
  const refresh = (): void => {
    publisher.offer(resolve)
  }

  if (chosen.client !== undefined) {
    ctx.effect(() => {
      chosen.client?.start()
      return () => chosen.client?.dispose()
    }, 'rich-presence: discord connection')
  }

  ctx.effect(() => () => publisher.dispose(), 'rich-presence: publisher')

  ctx.effect(() => {
    let disposed = false
    void ctx.sessionProjections.register(activityProjection()).then(
      registered => {
        if (disposed) {
          void registered.dispose()
          return
        }
        handle = registered
        refresh()
      },
      (error: unknown) => {
        logger.warn('rich-presence: cannot register the activity projection: %o', error)
      },
    )
    return () => {
      disposed = true
    }
  }, 'rich-presence: activity projection')

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

  if (chosen.label === 'log') {
    logger.info(
      'rich-presence: no discord.clientId configured; activities are written to this log. Set discord.clientId to a Discord application id to publish them.',
    )
  }
  refresh()
}

/** Re-exported so the locale resource and the plugin row share one key. */
export { ACTIVITY_KEY }
