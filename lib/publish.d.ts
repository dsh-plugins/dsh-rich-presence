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
import type { ActivityPayload } from './render.ts';
/** Update policy, mirroring the plugin's `update` configuration section. */
export interface UpdateConfig {
    /** Quiet time after the last change before anything is sent. */
    debounceMs: number;
    /** Minimum spacing between two sends. */
    minIntervalMs: number;
}
/** What a publisher does with the activity it decided to send. */
export interface Transport {
    /** Publish one activity, or clear the presence with `null`. */
    send(activity: ActivityPayload | null): void;
}
/** Produces the activity to send when the publisher is ready; `null` clears the presence. */
export type ActivitySource = () => ActivityPayload | null;
/**
 * Coalesce and throttle activity updates.
 *
 * A change is scheduled `debounceMs` after the last request and then held
 * until `minIntervalMs` has passed since the previous send. The newest value
 * always wins; intermediate states are dropped rather than queued, so a burst
 * of tool calls does not produce a burst of presence updates.
 */
export declare class Publisher {
    private pending;
    private timer;
    private lastSent;
    private lastPayload;
    private readonly config;
    private readonly transport;
    private readonly now;
    private readonly onError;
    /**
     * @param config - update policy.
     * @param transport - where an accepted update goes.
     * @param now - clock, injectable for tests.
     * @param onError - receives a failure raised while producing or sending an
     *   update; a presence is decoration, so a failure is reported and dropped
     *   rather than thrown out of a timer.
     */
    constructor(config: UpdateConfig, transport: Transport, now?: () => number, onError?: (error: unknown) => void);
    /**
     * Offer a recomputation.
     *
     * The source is resolved when the update is actually sent, not when it is
     * offered: the projection registry folds a committed event on its own
     * listener, so a source read at debounce time sees the settled state.
     *
     * @param source - produces the activity to send.
     */
    offer(source: ActivitySource): void;
    /** Send anything still pending, ignoring the rate limit. */
    flush(): void;
    /** Drop any pending update and stop scheduling. */
    dispose(): void;
    /** Schedule a flush at the earliest instant both limits allow. */
    private schedule;
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
export declare class LogTransport implements Transport {
    private readonly logger;
    private readonly reason;
    private reported;
    /**
     * @param logger - where the payload is written.
     * @param reason - why this transport is in use, quoted in the first line.
     */
    constructor(logger: {
        info(message: string, ...args: unknown[]): void;
        debug(message: string, ...args: unknown[]): void;
    }, reason: string);
    /**
     * Write one activity.
     * @param activity - the payload Discord would receive.
     */
    send(activity: ActivityPayload | null): void;
}
