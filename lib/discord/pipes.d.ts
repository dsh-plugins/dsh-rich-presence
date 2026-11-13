/**
 * Discord IPC socket discovery.
 *
 * Discord listens on a per-user socket named `discord-ipc-<n>`; the namespace
 * differs per platform. Several slots may be live at once (a stable client and
 * a development one), so candidates are tried in order until one connects.
 *
 * @module dsh-rich-presence/discord/pipes
 */
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
export declare function pipeCandidates(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, uid?: number | undefined): string[];
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
export declare function normalizeEndpoint(value: string, platform?: NodeJS.Platform): string;
