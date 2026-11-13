import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CLOSE_INVALID_CLIENT_ID,
  FrameDecoder,
  MAX_FRAME_BYTES,
  OP,
  closeReason,
  encodeFrame,
  eventName,
} from '../src/discord/protocol.ts'

test('a frame round-trips through the decoder', () => {
  const frame = encodeFrame(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: 42 } })
  assert.equal(frame.length, 8 + frame.readUInt32LE(4))
  assert.equal(frame.readUInt32LE(0), OP.FRAME)

  const decoder = new FrameDecoder()
  assert.deepEqual(decoder.push(frame), [{ op: OP.FRAME, data: { cmd: 'SET_ACTIVITY', args: { pid: 42 } } }])
  assert.equal(decoder.failure(), undefined)
})

test('the decoder reassembles a frame split across chunks', () => {
  const frame = encodeFrame(OP.HANDSHAKE, { v: 1, client_id: '123' })
  const decoder = new FrameDecoder()
  for (const byte of frame.subarray(0, frame.length - 1)) {
    assert.deepEqual(decoder.push(Buffer.from([byte])), [])
  }
  assert.deepEqual(decoder.push(frame.subarray(frame.length - 1)), [
    { op: OP.HANDSHAKE, data: { v: 1, client_id: '123' } },
  ])
})

test('the decoder returns every frame contained in one chunk', () => {
  const chunk = Buffer.concat([
    encodeFrame(OP.FRAME, { evt: 'READY' }),
    encodeFrame(OP.PING, { t: 1 }),
  ])
  const frames = new FrameDecoder().push(chunk)
  assert.deepEqual(frames.map(frame => frame.op), [OP.FRAME, OP.PING])
})

test('a frame with a malformed payload decodes to undefined data', () => {
  const header = Buffer.alloc(8)
  header.writeUInt32LE(OP.FRAME, 0)
  header.writeUInt32LE(4, 4)
  const frames = new FrameDecoder().push(Buffer.concat([header, Buffer.from('{oops', 'utf8')]))
  assert.deepEqual(frames, [{ op: OP.FRAME, data: undefined }])
})

test('an oversized frame fails the decoder and stops it', () => {
  const header = Buffer.alloc(8)
  header.writeUInt32LE(OP.FRAME, 0)
  header.writeUInt32LE(MAX_FRAME_BYTES + 1, 4)
  const decoder = new FrameDecoder()
  assert.deepEqual(decoder.push(header), [])
  assert.match(decoder.failure() ?? '', /exceeds/)
  assert.deepEqual(decoder.push(encodeFrame(OP.FRAME, { ok: true })), [])
})

test('encoding refuses a payload past the frame budget', () => {
  assert.throws(() => encodeFrame(OP.FRAME, { pad: 'x'.repeat(MAX_FRAME_BYTES) }), RangeError)
})

test('eventName reads only dispatch payloads', () => {
  assert.equal(eventName({ cmd: 'DISPATCH', evt: 'READY' }), 'READY')
  assert.equal(eventName({ cmd: 'SET_ACTIVITY' }), undefined)
  assert.equal(eventName({ cmd: 'DISPATCH' }), undefined)
  assert.equal(eventName(undefined), undefined)
})

test('closeReason tolerates a partial payload', () => {
  assert.deepEqual(closeReason({ code: CLOSE_INVALID_CLIENT_ID, message: 'Invalid Client ID' }), {
    code: 4000,
    message: 'Invalid Client ID',
  })
  assert.deepEqual(closeReason({}), {})
  assert.deepEqual(closeReason(null), {})
})
