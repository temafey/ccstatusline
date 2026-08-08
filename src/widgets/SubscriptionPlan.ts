import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';

/**
 * Shape of the fields we need from ~/.claude/.claude.json.
 * Only a subset of the full file is modelled here.
 */
interface ClaudeAccountFile {
    oauthAccount?: {
        emailAddress?: string;
        displayName?: string;
    };
}

interface AccountInfo {
    email: string | null;
}

/**
 * Module-level memo so we only re-parse the file when its mtime changes.
 */
let _cachedMtime: number | null = null;
let _cachedInfo: AccountInfo = { email: null };

/**
 * Reads $CLAUDE_CONFIG_DIR/.claude.json (falls back to ~/.claude/.claude.json)
 * and extracts the email address.
 * Results are memoised by file mtime — a stat() call is made on every
 * render, but a full read + JSON.parse only happens when the file changes.
 */
function readAccountInfo(): AccountInfo {
    const configDir = process.env['CLAUDE_CONFIG_DIR'] ?? path.join(os.homedir(), '.claude');
    const filePath = path.join(configDir, '.claude.json');

    let mtime: number;
    try {
        mtime = fs.statSync(filePath).mtimeMs;
    } catch {
        // File absent or unreadable — return graceful fallback, clear cache.
        _cachedMtime = null;
        _cachedInfo = { email: null };
        return _cachedInfo;
    }

    if (_cachedMtime !== null && mtime === _cachedMtime) {
        return _cachedInfo;
    }

    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const json = JSON.parse(raw) as ClaudeAccountFile;

        const email = json.oauthAccount?.emailAddress ?? null;

        _cachedMtime = mtime;
        _cachedInfo = { email };
    } catch {
        // Parse error — clear cache and return nulls.
        _cachedMtime = null;
        _cachedInfo = { email: null };
    }

    return _cachedInfo;
}

/**
 * Infers the subscription plan from the rate_limits object in the stdin
 * context data.  This is the same signal the Claude Code startup banner uses
 * and is the authoritative plan indicator after the first API call.
 *
 *   rate_limits.five_hour present                    → "Max"
 *   rate_limits.seven_day present (no five_hour)     → "Pro"
 *   rate_limits present but neither window           → "Free"
 *   rate_limits absent (no API call yet)             → null
 */
function inferPlanFromRateLimits(data: RenderContext['data']): string | null {
    const rl = data?.rate_limits;
    if (rl === undefined || rl === null) return null;
    if ('five_hour' in rl && rl.five_hour !== undefined) return 'Max';
    if ('seven_day' in rl && rl.seven_day !== undefined) return 'Pro';
    return 'Free';
}

/**
 * Formats email + plan into the combined display string.
 *
 *   email + plan  → "user@example.com · Max"
 *   email only    → "user@example.com"
 *   plan only     → "Max"
 *   neither       → "--"
 */
function formatDisplay(email: string | null, plan: string | null): string {
    if (email && plan) return `${email} · ${plan}`;
    if (email) return email;
    if (plan) return plan;
    return '--';
}

export class SubscriptionPlanWidget implements Widget {
    getDefaultColor(): string { return 'magenta'; }
    getDescription(): string { return 'Claude account email and subscription plan (Max, Pro, Free) — read from ~/.claude/.claude.json'; }
    getDisplayName(): string { return 'Subscription Plan'; }
    getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        if (context.isPreview) {
            const display = 'onyshchenko.artem@gmail.com · Max';
            const title = item.title ?? '';
            return item.rawValue ? display : `${title}${display}`;
        }

        const { email } = readAccountInfo();
        const plan = inferPlanFromRateLimits(context.data);
        const display = formatDisplay(email, plan);
        const title = item.title ?? '';
        return item.rawValue ? display : `${title}${display}`;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(_item: WidgetItem): boolean { return true; }
}
