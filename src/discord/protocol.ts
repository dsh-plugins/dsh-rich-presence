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
export const OP = {
  /** Client opens the connection with `{ v: 1, client_id }`. */
  HANDSHAKE: 0,
  /** Ordinary command or dispatch payload. */
  FRAME: 1,
  /** Peer closes the connection with `{ code, message }`. */
  CLOSE: 2,
  /** Keepalive request. */
  PING: 3,
  /** Keepalive answer. */
  PONG: 4,
} as const

/** Largest payload this plugin accepts or emits; oversized frames are dropped whole. */
export const MAX_FRAME_BYTES = 64 * 1024

/** Discord closes the connection with these codes; `4000` means the client id is wrong. */
export const CLOSE_INVALID_CLIENT_ID = 4000

/** One decoded frame. `data` stays `unknown` until a caller validates it. */
export interface Frame {
  /** Opcode from `OP`. */
  readonly op: number
  /** Parsed JSON payload; `undefined` when the payload was not valid JSON. */
  readonly data: unknown
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
export function encodeFrame(op: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  if (body.length > MAX_FRAME_BYTES) {
    throw new RangeError(`discord frame payload ${body.length}B exceeds ${MAX_FRAME_BYTES}B`)
  }
  const frame = Buffer.allocUnsafe(8 + body.length)
  frame.writeUInt32LE(op, 0)
  frame.writeUInt32LE(body.length, 4)
  body.copy(frame, 8)
  return frame
}

/**
 * Incremental decoder for a byte stream that carries framed JSON.
 *
 * A frame larger than {@link MAX_FRAME_BYTES} is unrecoverable on a stream —
 * there is no way to resynchronize — so the decoder enters a failed state:
 * {@link push} returns nothing afterwards and {@link failure} names the reason.
 */
export class FrameDecoder {
  private pending: Buffer = Buffer.alloc(0)
  private failed: string | undefined

  /**
   * Feed one socket chunk.
   * @param chunk - bytes read from the socket, in arrival order.
   * @returns every frame completed by this chunk, in order.
   */
  push(chunk: Buffer): Frame[] {
    if (this.failed !== undefined) return []
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk])
    const frames: Frame[] = []
    while (this.pending.length >= 8) {
      const op = this.pending.readUInt32LE(0)
      const length = this.pending.readUInt32LE(4)
      if (length > MAX_FRAME_BYTES) {
        this.failed = `frame of ${length}B exceeds ${MAX_FRAME_BYTES}B`
        this.pending = Buffer.alloc(0)
        return frames
      }
      if (this.pending.length < 8 + length) break
      const body = this.pending.subarray(8, 8 + length)
      this.pending = this.pending.subarray(8 + length)
      frames.push({ op, data: parsePayload(body) })
    }
    return frames
  }

  /**
   * The unrecoverable decode failure, when one occurred.
   * @returns the reason, or `undefined` while the stream is still usable.
   */
  failure(): string | undefined {
    return this.failed
  }
}

/**
 * Parse one frame payload.
 * @param body - the frame's bytes.
 * @returns the parsed JSON value, or `undefined` when the bytes are not JSON.
 */
function parsePayload(body: Buffer): unknown {
  if (body.length === 0) return undefined
  try {
    return JSON.parse(body.toString('utf8')) as unknown
  } catch {
    return undefined
  }
}

/**
 * Read the `evt` discriminator of a dispatch payload.
 * @param data - decoded frame payload.
 * @returns the event name, or `undefined` for a non-dispatch payload.
 */
export function eventName(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as Record<string, unknown>
  if (record.cmd !== 'DISPATCH') return undefined
  return typeof record.evt === 'string' ? record.evt : undefined
}

/**
 * Read a `CLOSE` frame's code and message.
 * @param data - decoded frame payload.
 * @returns the parsed close payload; `undefined` fields for a malformed one.
 */
export function closeReason(data: unknown): { code?: number; message?: string } {
  if (typeof data !== 'object' || data === null) return {}
  const record = data as Record<string, unknown>
  return {
    ...typeof record.code === 'number' ? { code: record.code } : {},
    ...typeof record.message === 'string' ? { message: record.message } : {},
  }
}
