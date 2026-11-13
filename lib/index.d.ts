/**
 * Show the running agent as Discord Rich Presence.
 *
 * The displayed phase, turn, and token figures all come from committed session
 * events, so a reopened session shows the same thing it showed before, and no
 * second copy of the transcript is kept in memory.
 *
 * @module dsh-rich-presence
 */
import z from '@deepseek-ai/schemastery';
import type { Context } from '@deepseek-ai/cordis';
import { ACTIVITY_KEY } from './activity.ts';
/** Cordis plugin name. */
export declare const name = "rich-presence";
/** Services this plugin registers into. */
export declare const inject: string[];
/** Plugin configuration, every field defaulted so the row needs no settings. */
export interface Config {
    discord: {
        /** Discord application id; empty falls back to the log transport. */
        clientId: string;
        /** Activity type Discord renders in the "playing/listening/watching" slot. */
        activityType: 0 | 2 | 3 | 5;
        /** Button labels and links, at most two. */
        buttons: {
            label: string;
            url: string;
        }[];
    };
    presence: {
        /** Template for Discord's first text line. */
        details: string;
        /** Template for Discord's second text line. */
        state: string;
        /** Template for the large-image hover text. */
        largeText: string;
        /** Template for the small-image hover text. */
        smallText: string;
        /** Asset name of the large image; empty shows the application's icon area empty. */
        largeImage: string;
        /** Asset name of the small image while the agent works. */
        smallImageRunning: string;
        /** Asset name of the small image while the agent is idle. */
        smallImageIdle: string;
        /** Phase wording overrides; omitted entries keep the English defaults. */
        labels: Record<string, string>;
        /** Which start time the elapsed timer counts from. */
        elapsed: 'session' | 'turn' | 'off';
        /** Maximum characters per text field, capped at Discord's 128. */
        truncateAt: number;
        /** Publish an activity when no agent is running. */
        showWhenIdle: boolean;
    };
    privacy: {
        /** Display the name of the tool that is running. */
        showToolNames: boolean;
        /** Display the base name of the session working directory. */
        showFolder: boolean;
    };
    focus: {
        /** Prefer the running session, or the most recently active one. */
        mode: 'active' | 'latest';
        /** Allow a delegated session to be the displayed one. */
        includeSubagents: boolean;
    };
    connection: {
        /** Transport to use; `auto` picks ipc when a client id is set. */
        transport: 'auto' | 'ipc' | 'log';
        /** Backoff floor in milliseconds. */
        reconnectMs: number;
        /** Backoff ceiling in milliseconds. */
        maxReconnectMs: number;
        /** Extra endpoints tried before the platform defaults. */
        extraPipePaths: string[];
    };
    update: {
        /** Quiet time after the last change before a send. */
        debounceMs: number;
        /** Minimum spacing between two sends. */
        minIntervalMs: number;
    };
}
/** Schemastery validation; invalid values fail at load. */
export declare const Config: z<Config>;
/**
 * Register the projection, the transport, and the update triggers.
 * @param ctx - plugin context owning every registration.
 * @param config - validated plugin configuration.
 */
export declare function apply(ctx: Context, config: Config): void;
/** Re-exported so the locale resource and the plugin row share one key. */
export { ACTIVITY_KEY };
