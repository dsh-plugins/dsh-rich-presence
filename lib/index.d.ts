/**
 * Show the running agent as Discord Rich Presence.
 *
 * The displayed phase, turn, and token figures all come from committed session
 * events, so a reopened session shows the same thing it showed before, and no
 * second copy of the transcript is kept in memory.
 *
 * Every configuration group is a volatile reference, so the plugin page can
 * save a change without a restart: the loader commits the new values into those
 * references and this module rebuilds only the pipeline layer that changed.
 *
 * @module dsh-rich-presence
 */
import z from '@deepseek-ai/schemastery';
import type { Context, Volatile } from '@deepseek-ai/cordis';
import { ACTIVITY_KEY } from './activity.ts';
import { DEFAULTS, type ConnectionSettings, type DiscordSettings, type FocusSettings, type PresenceSettings, type PrivacySettings, type UpdateSettings } from './settings.ts';
/** Cordis plugin name. */
export declare const name = "rich-presence";
/**
 * Services this plugin registers into.
 *
 * `settings` is deliberately absent: the plugin must run in profiles that do not
 * compose it, so the live-update listener attaches only when the service exists.
 */
export declare const inject: string[];
/**
 * Plugin configuration, every field defaulted so the row needs no settings.
 *
 * Each group is declared volatile by the schema below, so the plugin page can
 * save a change without restarting.
 */
export interface Config {
    /** Discord application id and card decoration. */
    discord: Volatile<DiscordSettings>;
    /** Display templates, labels, and timers. */
    presence: Volatile<PresenceSettings>;
    /** What may be published publicly. */
    privacy: Volatile<PrivacySettings>;
    /** Which live agent is displayed. */
    focus: Volatile<FocusSettings>;
    /** Transport and reconnect behaviour. */
    connection: Volatile<ConnectionSettings>;
    /** Publish rate limits. */
    update: Volatile<UpdateSettings>;
}
/** Schemastery validation; invalid values fail at load. */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    discord: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        clientId: z<string, string, "defined">;
        activityType: z<0 | 2 | 3 | 5, 0 | 2 | 3 | 5, "defined">;
        buttons: z<({
            label?: string | null | undefined;
            url?: string | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            label: z<string, string, "plain">;
            url: z<string, string, "plain">;
        }>>[], "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        clientId: z<string, string, "defined">;
        activityType: z<0 | 2 | 3 | 5, 0 | 2 | 3 | 5, "defined">;
        buttons: z<({
            label?: string | null | undefined;
            url?: string | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            label: z<string, string, "plain">;
            url: z<string, string, "plain">;
        }>>[], "defined">;
    }>>>, "volatile-defined">;
    presence: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        details: z<string, string, "defined">;
        state: z<string, string, "defined">;
        largeText: z<string, string, "defined">;
        smallText: z<string, string, "defined">;
        largeImage: z<string, string, "defined">;
        smallImageRunning: z<string, string, "defined">;
        smallImageIdle: z<string, string, "defined">;
        labels: z<import("@deepseek-ai/cosmokit").Dict<string, string>, import("@deepseek-ai/cosmokit").Dict<string, string>, "defined">;
        elapsed: z<"turn" | "session" | "off", "turn" | "session" | "off", "defined">;
        truncateAt: z<number, number, "defined">;
        showWhenIdle: z<boolean, boolean, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        details: z<string, string, "defined">;
        state: z<string, string, "defined">;
        largeText: z<string, string, "defined">;
        smallText: z<string, string, "defined">;
        largeImage: z<string, string, "defined">;
        smallImageRunning: z<string, string, "defined">;
        smallImageIdle: z<string, string, "defined">;
        labels: z<import("@deepseek-ai/cosmokit").Dict<string, string>, import("@deepseek-ai/cosmokit").Dict<string, string>, "defined">;
        elapsed: z<"turn" | "session" | "off", "turn" | "session" | "off", "defined">;
        truncateAt: z<number, number, "defined">;
        showWhenIdle: z<boolean, boolean, "defined">;
    }>>>, "volatile-defined">;
    privacy: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        showToolNames: z<boolean, boolean, "defined">;
        showFolder: z<boolean, boolean, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        showToolNames: z<boolean, boolean, "defined">;
        showFolder: z<boolean, boolean, "defined">;
    }>>>, "volatile-defined">;
    focus: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        mode: z<"active" | "latest", "active" | "latest", "defined">;
        includeSubagents: z<boolean, boolean, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        mode: z<"active" | "latest", "active" | "latest", "defined">;
        includeSubagents: z<boolean, boolean, "defined">;
    }>>>, "volatile-defined">;
    connection: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        transport: z<"auto" | "ipc" | "log", "auto" | "ipc" | "log", "defined">;
        reconnectMs: z<number, number, "defined">;
        maxReconnectMs: z<number, number, "defined">;
        extraPipePaths: z<string[], string[], "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        transport: z<"auto" | "ipc" | "log", "auto" | "ipc" | "log", "defined">;
        reconnectMs: z<number, number, "defined">;
        maxReconnectMs: z<number, number, "defined">;
        extraPipePaths: z<string[], string[], "defined">;
    }>>>, "volatile-defined">;
    update: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        debounceMs: z<number, number, "defined">;
        minIntervalMs: z<number, number, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        debounceMs: z<number, number, "defined">;
        minIntervalMs: z<number, number, "defined">;
    }>>>, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    discord: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        clientId: z<string, string, "defined">;
        activityType: z<0 | 2 | 3 | 5, 0 | 2 | 3 | 5, "defined">;
        buttons: z<({
            label?: string | null | undefined;
            url?: string | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            label: z<string, string, "plain">;
            url: z<string, string, "plain">;
        }>>[], "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        clientId: z<string, string, "defined">;
        activityType: z<0 | 2 | 3 | 5, 0 | 2 | 3 | 5, "defined">;
        buttons: z<({
            label?: string | null | undefined;
            url?: string | null | undefined;
        } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<NoInfer<{
            label: z<string, string, "plain">;
            url: z<string, string, "plain">;
        }>>[], "defined">;
    }>>>, "volatile-defined">;
    presence: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        details: z<string, string, "defined">;
        state: z<string, string, "defined">;
        largeText: z<string, string, "defined">;
        smallText: z<string, string, "defined">;
        largeImage: z<string, string, "defined">;
        smallImageRunning: z<string, string, "defined">;
        smallImageIdle: z<string, string, "defined">;
        labels: z<import("@deepseek-ai/cosmokit").Dict<string, string>, import("@deepseek-ai/cosmokit").Dict<string, string>, "defined">;
        elapsed: z<"turn" | "session" | "off", "turn" | "session" | "off", "defined">;
        truncateAt: z<number, number, "defined">;
        showWhenIdle: z<boolean, boolean, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        details: z<string, string, "defined">;
        state: z<string, string, "defined">;
        largeText: z<string, string, "defined">;
        smallText: z<string, string, "defined">;
        largeImage: z<string, string, "defined">;
        smallImageRunning: z<string, string, "defined">;
        smallImageIdle: z<string, string, "defined">;
        labels: z<import("@deepseek-ai/cosmokit").Dict<string, string>, import("@deepseek-ai/cosmokit").Dict<string, string>, "defined">;
        elapsed: z<"turn" | "session" | "off", "turn" | "session" | "off", "defined">;
        truncateAt: z<number, number, "defined">;
        showWhenIdle: z<boolean, boolean, "defined">;
    }>>>, "volatile-defined">;
    privacy: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        showToolNames: z<boolean, boolean, "defined">;
        showFolder: z<boolean, boolean, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        showToolNames: z<boolean, boolean, "defined">;
        showFolder: z<boolean, boolean, "defined">;
    }>>>, "volatile-defined">;
    focus: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        mode: z<"active" | "latest", "active" | "latest", "defined">;
        includeSubagents: z<boolean, boolean, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        mode: z<"active" | "latest", "active" | "latest", "defined">;
        includeSubagents: z<boolean, boolean, "defined">;
    }>>>, "volatile-defined">;
    connection: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        transport: z<"auto" | "ipc" | "log", "auto" | "ipc" | "log", "defined">;
        reconnectMs: z<number, number, "defined">;
        maxReconnectMs: z<number, number, "defined">;
        extraPipePaths: z<string[], string[], "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        transport: z<"auto" | "ipc" | "log", "auto" | "ipc" | "log", "defined">;
        reconnectMs: z<number, number, "defined">;
        maxReconnectMs: z<number, number, "defined">;
        extraPipePaths: z<string[], string[], "defined">;
    }>>>, "volatile-defined">;
    update: z<NoInfer<Schemastery.ObjectS<NoInfer<{
        debounceMs: z<number, number, "defined">;
        minIntervalMs: z<number, number, "defined">;
    }>>>, NoInfer<Schemastery.ObjectT<NoInfer<{
        debounceMs: z<number, number, "defined">;
        minIntervalMs: z<number, number, "defined">;
    }>>>, "volatile-defined">;
}>>, "plain">;
/**
 * Register the projection, the transport, and the update triggers.
 * @param ctx - plugin context owning every registration.
 * @param config - validated plugin configuration.
 */
export declare function apply(ctx: Context, config: Config): void;
/** Re-exported so the locale resource and the plugin row share one key. */
export { ACTIVITY_KEY };
/** Re-exported for the plugin page's copy of the defaults. */
export { DEFAULTS };
