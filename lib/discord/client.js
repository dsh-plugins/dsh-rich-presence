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
import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { CLOSE_INVALID_CLIENT_ID, FrameDecoder, OP, closeReason, encodeFrame, eventName } from "./protocol.js";
import { normalizeEndpoint, pipeCandidates } from "./pipes.js";
/**
 * Publish activities to Discord over its local IPC socket.
 *
 * The class never throws into the caller's flow: a failure is logged and turned
 * into a reconnect, because a presence is decoration and must never disturb an
 * agent run.
 */
export class DiscordClient {
    session;
    desired;
    sent;
    timer;
    backoff;
    stopped = false;
    disposed = false;
    config;
    logger;
    stateListener;
    /**
     * @param config - connection settings.
     * @param logger - where connection outcomes are reported.
     * @param onState - called on every state transition, for tests and diagnostics.
     */
    constructor(config, logger, onState = () => { }) {
        this.config = config;
        this.logger = logger;
        this.stateListener = onState;
        this.backoff = config.reconnectMs;
    }
    /** Start connecting. Calling it twice is a no-op until {@link dispose}. */
    start() {
        if (this.disposed || this.session !== undefined || this.config.clientId.length === 0) {
            if (this.config.clientId.length === 0)
                this.stateListener('disabled');
            return;
        }
        this.stopped = false;
        this.connectNext(0);
    }
    /**
     * Publish one activity, replacing whatever is shown.
     *
     * Updates are serialized: a request that arrives while the socket is
     * connecting is remembered and flushed on READY, so the newest value wins
     * without a queue of stale intermediate states.
     *
     * @param activity - the activity to show, or `null` to clear the presence.
     */
    update(activity) {
        this.desired = activity;
        this.flush();
    }
    /** Clear the presence, stop reconnecting, and release the socket. */
    dispose() {
        this.disposed = true;
        this.stopped = true;
        clearTimeout(this.timer);
        this.timer = undefined;
        const session = this.session;
        this.session = undefined;
        if (session === undefined)
            return;
        try {
            session.socket.write(encodeFrame(OP.FRAME, {
                cmd: 'SET_ACTIVITY',
                args: { pid: process.pid, activity: null },
                nonce: randomUUID(),
            }));
            // End rather than destroy: the clearing frame must reach the peer, and a
            // destroyed socket discards buffered writes.
            session.socket.end();
            session.socket.once('error', () => { });
            session.socket.setTimeout(1_000, () => session.socket.destroy());
        }
        catch {
            session.socket.destroy();
        }
    }
    /**
     * Try one endpoint from the candidate list.
     * @param index - candidate position; past the end retries after a backoff.
     */
    connectNext(index) {
        if (this.stopped || this.disposed)
            return;
        const candidates = [
            ...this.config.extraPipePaths.map(path => normalizeEndpoint(path)),
            ...pipeCandidates(),
        ];
        const endpoint = candidates[index];
        if (endpoint === undefined) {
            this.scheduleReconnect();
            return;
        }
        this.stateListener('connecting');
        const socket = connect(endpoint);
        const session = { socket, decoder: new FrameDecoder(), ready: false };
        let settled = false;
        const advance = () => {
            if (settled)
                return;
            settled = true;
            socket.destroy();
            if (this.session === session)
                this.session = undefined;
            this.connectNext(index + 1);
        };
        socket.on('error', () => {
            // Every candidate fails while Discord is closed; keep the log quiet.
            if (index === 0)
                this.logger.debug('rich-presence: discord socket unavailable, retrying');
            advance();
        });
        socket.on('close', () => {
            if (this.session === session) {
                this.session = undefined;
                if (!this.stopped && !this.disposed)
                    this.scheduleReconnect();
            }
        });
        socket.on('connect', () => {
            settled = true;
            this.session = session;
            socket.write(encodeFrame(OP.HANDSHAKE, { v: 1, client_id: this.config.clientId }));
        });
        socket.on('data', chunk => this.receive(session, chunk));
    }
    /**
     * Handle one socket read.
     * @param session - the connection the bytes came from.
     * @param chunk - bytes read.
     */
    receive(session, chunk) {
        if (this.session !== session)
            return;
        for (const frame of session.decoder.push(chunk)) {
            if (frame.op === OP.PING) {
                try {
                    session.socket.write(encodeFrame(OP.PONG, frame.data));
                }
                catch {
                    // A failed keepalive answer is followed by the socket closing.
                }
                continue;
            }
            if (frame.op === OP.CLOSE) {
                this.handleClose(closeReason(frame.data));
                return;
            }
            if (eventName(frame.data) === 'READY') {
                session.ready = true;
                this.sent = undefined;
                this.backoff = this.config.reconnectMs;
                this.stateListener('ready');
                this.flush();
            }
        }
        const failure = session.decoder.failure();
        if (failure !== undefined) {
            this.logger.warn('rich-presence: discord sent an undecodable frame: %s', failure);
            session.socket.destroy();
        }
    }
    /**
     * Handle a CLOSE frame.
     * @param reason - the peer's code and message.
     */
    handleClose(reason) {
        const session = this.session;
        this.session = undefined;
        session?.socket.destroy();
        if (reason.code === CLOSE_INVALID_CLIENT_ID) {
            // Retrying cannot help and would spin: a wrong application id is a
            // configuration error the user has to fix.
            this.stopped = true;
            this.stateListener('disabled');
            this.logger.warn('rich-presence: discord rejected the application id (%s). Set discord.clientId to an application id from https://discord.com/developers/applications.', reason.message ?? 'code 4000');
            return;
        }
        this.logger.debug('rich-presence: discord closed the connection: %s', reason.message ?? reason.code ?? 'unknown');
        this.stateListener('closed');
        if (!this.stopped && !this.disposed)
            this.scheduleReconnect();
    }
    /** Schedule the next connection attempt with exponential backoff. */
    scheduleReconnect() {
        if (this.stopped || this.disposed || this.timer !== undefined)
            return;
        this.stateListener('closed');
        const delay = this.backoff;
        this.backoff = Math.min(this.backoff * 2, this.config.maxReconnectMs);
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.connectNext(0);
        }, delay);
        // A pending reconnect must not keep the process alive on its own.
        this.timer.unref();
    }
    /** Send the newest desired activity if the connection is ready and it changed. */
    flush() {
        const session = this.session;
        if (session === undefined || !session.ready || this.desired === undefined)
            return;
        const activity = this.desired;
        const encoded = JSON.stringify(activity);
        if (encoded === this.sent)
            return;
        try {
            session.socket.write(encodeFrame(OP.FRAME, {
                cmd: 'SET_ACTIVITY',
                args: { pid: process.pid, activity },
                nonce: randomUUID(),
            }));
            this.sent = encoded;
        }
        catch (error) {
            this.logger.debug('rich-presence: failed to send activity: %o', error);
            session.socket.destroy();
        }
    }
}
