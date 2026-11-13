/**
 * Discord IPC wire protocol: little-endian framed JSON.
 *
 * Every frame is `<op:uint32LE><length:uint32LE><utf8 JSON payload>`. The
 * decoder accepts arbitrary socket chunking, so a frame may arrive split
 * across reads or several frames may share one read.
 *
 * @module dsh-rich-presence/discord/protocol
 */
/** Discord RPC opcodes carried by the first four bytes of every frame. */
export declare const OP: {
    /** Client opens the connection with `{ v: 1, client_id }`. */
    readonly HANDSHAKE: 0;
    /** Ordinary command or dispatch payload. */
    readonly FRAME: 1;
    /** Peer closes the connection with `{ code, message }`. */
    readonly CLOSE: 2;
    /** Keepalive request. */
    readonly PING: 3;
    /** Keepalive answer. */
    readonly PONG: 4;
};
/** Largest payload this plugin accepts or emits; oversized frames are dropped whole. */
export declare const MAX_FRAME_BYTES: number;
/** Discord closes the connection with these codes; `4000` means the client id is wrong. */
export declare const CLOSE_INVALID_CLIENT_ID = 4000;
/** One decoded frame. `data` stays `unknown` until a caller validates it. */
export interface Frame {
    /** Opcode from `OP`. */
    readonly op: number;
    /** Parsed JSON payload; `undefined` when the payload was not valid JSON. */
    readonly data: unknown;
}
/**
 * Encode one frame.
 *
 * The payload is serialized before the header so a cyclic value fails without
 * producing a partial buffer.
 *
 * @param op - opcode from {@link OP}.
 * @param payload - JSON-serializable payload.
 * @returns the complete frame.
 * @throws when the payload is not JSON-serializable or exceeds {@link MAX_FRAME_BYTES}.
 */
export declare function encodeFrame(op: number, payload: unknown): Buffer;
/**
 * Incremental decoder for a byte stream that carries framed JSON.
 *
 * A frame larger than {@link MAX_FRAME_BYTES} is unrecoverable on a stream —
 * there is no way to resynchronize — so the decoder enters a failed state:
 * {@link push} returns nothing afterwards and {@link failure} names the reason.
 */
export declare class FrameDecoder {
    private pending;
    private failed;
    /**
     * Feed one socket chunk.
     * @param chunk - bytes read from the socket, in arrival order.
     * @returns every frame completed by this chunk, in order.
     */
    push(chunk: Buffer): Frame[];
    /**
     * The unrecoverable decode failure, when one occurred.
     * @returns the reason, or `undefined` while the stream is still usable.
     */
    failure(): string | undefined;
}
/**
 * Read the `evt` discriminator of a dispatch payload.
 * @param data - decoded frame payload.
 * @returns the event name, or `undefined` for a non-dispatch payload.
 */
export declare function eventName(data: unknown): string | undefined;
/**
 * Read a `CLOSE` frame's code and message.
 * @param data - decoded frame payload.
 * @returns the parsed close payload; `undefined` fields for a malformed one.
 */
export declare function closeReason(data: unknown): {
    code?: number;
    message?: string;
};
