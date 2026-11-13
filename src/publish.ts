/**
 * Deciding when a rendered activity is worth sending.
 *
 * Discord rate-limits `SET_ACTIVITY` to roughly five updates per twenty
 * seconds, and a session produces far more interesting events than that. The
 * publisher therefore coalesces rapid changes and never sends an unchanged
 * payload twice.
 *
 * @module dsh-rich-presence/publish
 */

import type { ActivityPayload } from './render.ts'

/** Update policy, mirroring the plugin's `update` configuration section. */
export interface UpdateConfig {
  /** Quiet time after the last change before anything is sent. */
  debounceMs: number
  /** Minimum spacing between two sends. */
  minIntervalMs: number
}

/** What a publisher does with the activity it decided to send. */
export interface Transport {
  /** Publish one activity, or clear the presence with `null`. */
  send(activity: ActivityPayload | null): void
}

/** Produces the activity to send when the publisher is ready; `null` clears the presence. */
export type ActivitySource = () => ActivityPayload | null

/**
 * Coalesce and throttle activity updates.
 *
 * A change is scheduled `debounceMs` after the last request and then held
 * until `minIntervalMs` has passed since the previous send. The newest value
 * always wins; intermediate states are dropped rather than queued, so a burst
 * of tool calls does not produce a burst of presence updates.
 */
export class Publisher {
  private pending: ActivitySource | undefined
  private timer: NodeJS.Timeout | undefined
  private lastSent = 0
  private lastPayload: string | undefined
  private readonly config: UpdateConfig
  private readonly transport: Transport
  private readonly now: () => number
  private readonly onError: (error: unknown) => void

  /**
   * @param config - update policy.
   * @param transport - where an accepted update goes.
   * @param now - clock, injectable for tests.
   * @param onError - receives a failure raised while producing or sending an
   *   update; a presence is decoration, so a failure is reported and dropped
   *   rather than thrown out of a timer.
   */
  constructor(
    config: UpdateConfig,
    transport: Transport,
    now: () => number = Date.now,
    onError: (error: unknown) => void = () => {},
  ) {
    this.config = config
    this.transport = transport
    this.now = now
    this.onError = onError
  }

  /**
   * Offer a recomputation.
   *
   * The source is resolved when the update is actually sent, not when it is
   * offered: the projection registry folds a committed event on its own
   * listener, so a source read at debounce time sees the settled state.
   *
   * @param source - produces the activity to send.
   */
  offer(source: ActivitySource): void {
    this.pending = source
    this.schedule()
  }

  /** Send anything still pending, ignoring the rate limit. */
  flush(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    const source = this.pending
    if (source === undefined) return
    this.pending = undefined
    let activity: ActivityPayload | null
    try {
      activity = source()
    } catch (error) {
      this.onError(error)
      return
    }
    const encoded = JSON.stringify(activity)
    if (encoded === this.lastPayload) return
    this.lastPayload = encoded
    this.lastSent = this.now()
    try {
      this.transport.send(activity)
    } catch (error) {
      this.onError(error)
    }
  }

  /** Drop any pending update and stop scheduling. */
  dispose(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.pending = undefined
  }

  /** Schedule a flush at the earliest instant both limits allow. */
  private schedule(): void {
    if (this.timer !== undefined) return
    const sinceLast = this.now() - this.lastSent
    const wait = Math.max(this.config.debounceMs, this.config.minIntervalMs - sinceLast)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flush()
    }, Math.max(0, wait))
    this.timer.unref()
  }
}

/**
 * A transport that writes the activity to the log.
 *
 * This is the default while no Discord application id is configured: it makes
 * the rendering verifiable — the exact payload Discord would receive appears in
 * the log — without pretending a connection exists. Only the first payload of a
 * run goes to `info`; later ones are `debug`, because a long session would
 * otherwise write a payload line every few seconds.
 */
export class LogTransport implements Transport {
  private readonly logger: {
    info(message: string, ...args: unknown[]): void
    debug(message: string, ...args: unknown[]): void
  }
  private readonly reason: string
  private reported = false

  /**
   * @param logger - where the payload is written.
   * @param reason - why this transport is in use, quoted in the first line.
   */
  constructor(
    logger: {
      info(message: string, ...args: unknown[]): void
      debug(message: string, ...args: unknown[]): void
    },
    reason: string,
  ) {
    this.logger = logger
    this.reason = reason
  }

  /**
   * Write one activity.
   * @param activity - the payload Discord would receive.
   */
  send(activity: ActivityPayload | null): void {
    if (this.reported) {
      this.logger.debug('rich-presence (log transport): %s', JSON.stringify(activity))
      return
    }
    this.reported = true
    this.logger.info(
      'rich-presence (log transport, %s): %s',
      this.reason,
      JSON.stringify(activity),
    )
  }
}
