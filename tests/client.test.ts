import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { DiscordClient, type ClientConfig, type ClientState } from '../src/discord/client.ts'
import { OP } from '../src/discord/protocol.ts'

/** A logger that keeps warnings so a test can assert on them. */
function recorder() {
  const warnings: string[] = []
  return {
    warnings,
    logger: {
      info: () => {},
      warn: (message: string) => { warnings.push(message) },
      debug: () => {},
    },
  }
}

/** Test endpoint: a named pipe on Windows, a unix socket elsewhere. */
function endpoint(): string {
  const name = `dsh-rp-${randomUUID()}`
  return process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : `/tmp/${name}`
}

/** Read one length-free JSON frame from a raw socket chunk stream. */
class TestPeer {
  private pending = Buffer.alloc(0)
  readonly frames: { op: number; data: any }[] = []

  /** Append bytes and return every complete frame. */
  push(chunk: Buffer): { op: number; data: any }[] {
    this.pending = Buffer.concat([this.pending, chunk])
    const out: { op: number; data: any }[] = []
    while (this.pending.length >= 8) {
      const op = this.pending.readUInt32LE(0)
      const length = this.pending.readUInt32LE(4)
      if (this.pending.length < 8 + length) break
      const body = this.pending.subarray(8, 8 + length).toString('utf8')
      this.pending = this.pending.subarray(8 + length)
      const frame = { op, data: body.length === 0 ? undefined : JSON.parse(body) }
      this.frames.push(frame)
      out.push(frame)
    }
    return out
  }
}

/** Sockets opened by each test server, so cleanup never waits on one. */
const liveSockets = new WeakMap<Server, Set<Socket>>()

/** Start a server on the test endpoint, delivering each socket read's new frames. */
async function listen(
  path: string,
  onFrames: (socket: Socket, frames: { op: number; data: any }[], connection: number) => void,
): Promise<Server> {
  let connections = 0
  const sockets = new Set<Socket>()
  const server = createServer(socket => {
    connections += 1
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    const connection = connections
    const peer = new TestPeer()
    socket.on('data', chunk => {
      const frames = peer.push(chunk)
      if (frames.length > 0) onFrames(socket, frames, connection)
    })
    socket.on('error', () => {})
  })
  liveSockets.set(server, sockets)
  await new Promise<void>(resolve => server.listen(path, resolve))
  return server
}

/** Resolve once `predicate` holds, or reject after the budget elapses. */
async function waitFor(predicate: () => boolean, budgetMs = 2_000): Promise<void> {
  const deadline = Date.now() + budgetMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

/** Close a test server without waiting for a client socket that never ended. */
async function closeServer(server: Server): Promise<void> {
  for (const socket of liveSockets.get(server) ?? []) socket.destroy()
  liveSockets.delete(server)
  await new Promise<void>(resolve => server.close(() => resolve()))
}

/** Write one frame to a peer socket. */
function writeFrame(socket: Socket, op: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const frame = Buffer.alloc(8 + body.length)
  frame.writeUInt32LE(op, 0)
  frame.writeUInt32LE(body.length, 4)
  body.copy(frame, 8)
  socket.write(frame)
}

/** Client settings pointed at one test endpoint. */
function clientConfig(path: string): ClientConfig {
  return { clientId: '123456789012345678', reconnectMs: 50, maxReconnectMs: 200, extraPipePaths: [path] }
}

test('the client handshakes, then publishes the activity once ready', async () => {
  const path = endpoint()
  const handshakes: unknown[] = []
  const activities: unknown[] = []
  const server = await listen(path, (socket, frames) => {
    for (const frame of frames) {
      if (frame.op === OP.HANDSHAKE) {
        handshakes.push(frame.data)
        writeFrame(socket, OP.FRAME, { cmd: 'DISPATCH', evt: 'READY', data: { v: 1 } })
        continue
      }
      const data = frame.data as { cmd?: string; args?: { activity?: unknown } }
      if (data.cmd === 'SET_ACTIVITY') activities.push(data.args?.activity)
    }
  })
  const states: ClientState[] = []
  const client = new DiscordClient(clientConfig(path), recorder().logger, state => states.push(state))
  try {
    client.start()
    // Offered before READY: it must be held back and flushed by the handshake.
    client.update({ details: 'Thinking', state: 'deepseek-v4.1-flash' })
    await waitFor(() => activities.length > 0)
    assert.deepEqual(handshakes, [{ v: 1, client_id: '123456789012345678' }])
    assert.deepEqual(activities[0], { details: 'Thinking', state: 'deepseek-v4.1-flash' })
    assert.ok(states.includes('ready'))
  } finally {
    client.dispose()
    await closeServer(server)
  }
})

test('an unchanged activity is not sent twice', async () => {
  const path = endpoint()
  const activities: unknown[] = []
  const server = await listen(path, (socket, frames) => {
    for (const frame of frames) {
      if (frame.op === OP.HANDSHAKE) {
        writeFrame(socket, OP.FRAME, { cmd: 'DISPATCH', evt: 'READY', data: {} })
        continue
      }
      const data = frame.data as { cmd?: string; args?: { activity?: unknown } }
      if (data.cmd === 'SET_ACTIVITY' && data.args?.activity !== null) activities.push(data.args?.activity)
    }
  })
  const client = new DiscordClient(clientConfig(path), recorder().logger)
  try {
    client.start()
    client.update({ details: 'Idle' })
    await waitFor(() => activities.length === 1)
    client.update({ details: 'Idle' })
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(activities.length, 1)
  } finally {
    client.dispose()
    await closeServer(server)
  }
})

test('a rejected application id stops the reconnect loop', async () => {
  const path = endpoint()
  const { logger, warnings } = recorder()
  let connections = 0
  const server = await listen(path, (socket) => {
    connections += 1
    writeFrame(socket, OP.CLOSE, { code: 4000, message: 'Invalid Client ID' })
  })
  const states: ClientState[] = []
  const client = new DiscordClient(clientConfig(path), logger, state => states.push(state))
  try {
    client.start()
    await waitFor(() => warnings.length > 0)
    const seen = connections
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.equal(connections, seen, 'no second connection after a rejected client id')
    assert.ok(states.includes('disabled'))
    assert.match(warnings.join('\n'), /discord\.clientId/)
  } finally {
    client.dispose()
    await closeServer(server)
  }
})

test('a keepalive ping is answered with a pong', async () => {
  const path = endpoint()
  const pongs: unknown[] = []
  const server = await listen(path, (socket, frames) => {
    for (const frame of frames) {
      if (frame.op === OP.HANDSHAKE) {
        writeFrame(socket, OP.FRAME, { cmd: 'DISPATCH', evt: 'READY', data: {} })
        setTimeout(() => writeFrame(socket, OP.PING, { nonce: 'ka' }), 20)
        continue
      }
      if (frame.op === OP.PONG) pongs.push(frame.data)
    }
  })
  const client = new DiscordClient(clientConfig(path), recorder().logger)
  try {
    client.start()
    await waitFor(() => pongs.length > 0)
    assert.deepEqual(pongs, [{ nonce: 'ka' }])
  } finally {
    client.dispose()
    await closeServer(server)
  }
})

test('the client reconnects after the socket drops', async () => {
  const path = endpoint()
  const states: ClientState[] = []
  let connections = 0
  const server = await listen(path, socket => {
    connections += 1
    socket.destroy()
  })
  const client = new DiscordClient(clientConfig(path), recorder().logger, state => states.push(state))
  try {
    client.start()
    await waitFor(() => connections >= 2)
    assert.ok(states.filter(state => state === 'connecting').length >= 2)
  } finally {
    client.dispose()
    await closeServer(server)
  }
})

test('dispose clears the presence before closing the socket', async () => {
  const path = endpoint()
  const shown: unknown[] = []
  const cleared: unknown[] = []
  const server = await listen(path, (socket, frames) => {
    for (const frame of frames) {
      if (frame.op === OP.HANDSHAKE) {
        writeFrame(socket, OP.FRAME, { cmd: 'DISPATCH', evt: 'READY', data: {} })
        continue
      }
      const data = frame.data as { cmd?: string; args?: { activity?: unknown } }
      if (data.cmd !== 'SET_ACTIVITY') continue
      if (data.args?.activity === null) cleared.push(null)
      else shown.push(data.args?.activity)
    }
  })
  let markReady = (): void => {}
  const ready = new Promise<void>(resolve => { markReady = resolve })
  const client = new DiscordClient(clientConfig(path), recorder().logger, state => {
    if (state === 'ready') markReady()
  })
  try {
    client.start()
    await ready
    client.update({ details: 'Idle' })
    await waitFor(() => shown.length > 0)
    client.dispose()
    await waitFor(() => cleared.length > 0)
  } finally {
    client.dispose()
    await closeServer(server)
  }
})
