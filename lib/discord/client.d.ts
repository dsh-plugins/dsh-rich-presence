/**
 * A resilient Discord IPC connection.
 *
 * The client owns one socket at a time. It publishes at most one activity,
 * coalesces updates that arrive during a send, and reconnects with exponential
 * backoff when Discord is not running — the ordinary case on a desktop where
 * either side may start first.
 *
 * @module dsh-rich-presence/discord/client
 */
import type { ActivityPayload } from '../render.ts';
/** Connection settings, mirroring the plugin's `connection` configuration section. */
export interface ClientConfig {
    /** Discord application id; an invalid one is reported once and stops retries. */
    clientId: string;
    /** Backoff floor in milliseconds. */
    reconnectMs: number;
    /** Backoff ceiling in milliseconds. */
    maxReconnectMs: number;
    /** Endpoints tried before the platform defaults. */
    extraPipePaths: string[];
}
/** Minimal logger surface; matches the Cordis logger methods this plugin uses. */
export interface ClientLogger {
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    debug(message: string, ...args: unknown[]): void;
}
/** Connection states the client reports through {@link DiscordClient.onState}. */
export type ClientState = 'connecting' | 'ready' | 'closed' | 'disabled';
/**
 * Publish activities to Discord over its local IPC socket.
 *
 * The class never throws into the caller's flow: a failure is logged and turned
 * into a reconnect, because a presence is decoration and must never disturb an
 * agent run.
 */
export declare class DiscordClient {
    private session;
    private desired;
    private sent;
    private timer;
    private backoff;
    private stopped;
    private disposed;
    private readonly config;
    private readonly logger;
    private readonly stateListener;
    /**
     * @param config - connection settings.
     * @param logger - where connection outcomes are reported.
     * @param onState - called on every state transition, for tests and diagnostics.
     */
    constructor(config: ClientConfig, logger: ClientLogger, onState?: (state: ClientState) => void);
    /** Start connecting. Calling it twice is a no-op until {@link dispose}. */
    start(): void;
    /**
     * Publish one activity, replacing whatever is shown.
     *
     * Updates are serialized: a request that arrives while the socket is
     * connecting is remembered and flushed on READY, so the newest value wins
     * without a queue of stale intermediate states.
     *
     * @param activity - the activity to show, or `null` to clear the presence.
     */
    update(activity: ActivityPayload | null): void;
    /** Clear the presence, stop reconnecting, and release the socket. */
    dispose(): void;
    /**
     * Try one endpoint from the candidate list.
     * @param index - candidate position; past the end retries after a backoff.
     */
    private connectNext;
    /**
     * Handle one socket read.
     * @param session - the connection the bytes came from.
     * @param chunk - bytes read.
     */
    private receive;
    /**
     * Handle a CLOSE frame.
     * @param reason - the peer's code and message.
     */
    private handleClose;
    /** Schedule the next connection attempt with exponential backoff. */
    private scheduleReconnect;
    /** Send the newest desired activity if the connection is ready and it changed. */
    private flush;
}
