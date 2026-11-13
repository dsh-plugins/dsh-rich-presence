/**
 * Discord IPC socket discovery.
 *
 * Discord listens on a per-user socket named `discord-ipc-<n>`; the namespace
 * differs per platform. Several slots may be live at once (a stable client and
 * a development one), so candidates are tried in order until one connects.
 *
 * @module dsh-rich-presence/discord/pipes
 */
/** Highest slot index probed when the platform gives no other hint. */
const MAX_SLOTS = 10;
/** Windows named-pipe namespace prefix for one Discord slot. */
function windowsPipe(slot) {
    return `\\\\.\\pipe\\${slot}`;
}
/**
 * Candidate IPC endpoints for this platform.
 *
 * Windows uses the named-pipe namespace. Linux and macOS use Unix domain
 * sockets in a per-user runtime directory: `XDG_RUNTIME_DIR`, `TMPDIR`, the
 * session's own `/run/user/<uid>`, then `/tmp`. Several bases are tried
 * because Discord is launched by the desktop session and this process may not
 * have inherited its environment.
 *
 * @param env - the environment to read; defaults to `process.env`.
 * @param platform - the platform to resolve for; defaults to `process.platform`.
 * @param uid - the effective uid for the `/run/user/<uid>` candidate.
 * @returns absolute endpoint paths, most likely first, without duplicates.
 */
export function pipeCandidates(env = process.env, platform = process.platform, uid = currentUid()) {
    const slots = Array.from({ length: MAX_SLOTS }, (_, index) => `discord-ipc-${index}`);
    const paths = platform === 'win32'
        ? slots.map(windowsPipe)
        : baseDirectories(env, platform, uid).flatMap(base => slots.map(slot => `${base}/${slot}`));
    return [...new Set(paths)];
}
/**
 * Read the process's effective uid, which is unavailable on Windows.
 * @returns the uid, or `undefined` when the platform has none.
 */
function currentUid() {
    try {
        return process.getuid?.();
    }
    catch {
        return undefined;
    }
}
/**
 * Directories that may hold the Unix socket, in probe order.
 * @param env - the environment to read.
 * @param platform - the platform to resolve for.
 * @param uid - the effective uid, when known.
 * @returns candidate directories without duplicates.
 */
function baseDirectories(env, platform, uid) {
    const runtime = uid === undefined ? undefined : `/run/user/${uid}`;
    const bases = platform === 'darwin'
        ? [env.TMPDIR, env.XDG_RUNTIME_DIR, runtime, '/tmp']
        : [env.XDG_RUNTIME_DIR, env.TMPDIR, runtime, '/tmp'];
    return [...new Set(bases.filter((base) => typeof base === 'string' && base.length > 0))];
}
/**
 * Normalize a user-supplied endpoint override.
 *
 * A bare slot name such as `discord-ipc-3` is resolved for this platform, so
 * configuration stays portable; anything already absolute is used unchanged.
 *
 * @param value - one configured endpoint.
 * @param platform - the platform to resolve a bare slot name for.
 * @returns the absolute endpoint path.
 */
export function normalizeEndpoint(value, platform = process.platform) {
    const absolute = value.startsWith('\\\\') || value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
    if (absolute)
        return value;
    return platform === 'win32' ? windowsPipe(value) : `/tmp/${value}`;
}
