import chalk from 'chalk';

import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';
import { formatTokens } from '../utils/renderer';

// Thresholds match cmo.daemon.alerter / cmo.core.context_live: ≥80K = WARN, ≥120K = CRIT.
// Keep these synced if the alerter thresholds change.
const WARN_THRESHOLD = 80_000;
const CRIT_THRESHOLD = 120_000;

function colorize(text: string, value: number): string {
    if (value >= CRIT_THRESHOLD) return chalk.red(text);
    if (value >= WARN_THRESHOLD) return chalk.yellow(text);
    return text;
}

export class CacheReadPerTurnWidget implements Widget {
    getDefaultColor(): string { return 'green'; }
    getDescription(): string {
        return 'Avg cache_read tokens across the last 10 main-chain assistant turns (matches cmo context live WARN=80K/CRIT=120K)';
    }
    getDisplayName(): string { return 'Cache/Turn'; }
    getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        if (context.isPreview) {
            const data = formatTokens(95_000);
            const text = item.rawValue ? data : `Cache/Turn: ${data}`;
            return colorize(text, 95_000);
        }
        if (context.tokenMetrics) {
            const value = context.tokenMetrics.cacheReadPerTurn;
            const data = formatTokens(value);
            const text = item.rawValue ? data : `Cache/Turn: ${data}`;
            return colorize(text, value);
        }
        return null;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(_item: WidgetItem): boolean { return true; }
}
