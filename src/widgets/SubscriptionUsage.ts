import chalk from 'chalk';

import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';

// Color thresholds applied to whichever window is more exhausted
const PCT_WARNING  = 75;   // yellow
const PCT_CRITICAL = 90;   // red

function colorizeText(text: string, maxPct: number): string {
    if (maxPct >= PCT_CRITICAL) {
        return chalk.red(text);
    }
    if (maxPct >= PCT_WARNING) {
        return chalk.yellow(text);
    }
    return text;
}

export class SubscriptionUsageWidget implements Widget {
    getDefaultColor(): string { return 'cyan'; }
    getDescription(): string { return 'Claude subscription usage: 5-hour and weekly limits'; }
    getDisplayName(): string { return 'Subscription Usage'; }
    getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        if (context.isPreview) {
            const data = '5h 23% · Week 68%';
            return item.rawValue ? data : `Usage: ${data}`;
        }

        const rateLimits = context.data?.rate_limits;

        const fiveHrPct  = rateLimits?.five_hour?.used_percentage  ?? null;
        const sevenDayPct = rateLimits?.seven_day?.used_percentage ?? null;

        const fiveHrStr   = fiveHrPct   !== null ? `${Math.round(fiveHrPct)}%`   : '--';
        const sevenDayStr = sevenDayPct !== null ? `${Math.round(sevenDayPct)}%` : '--';

        const data = `5h ${fiveHrStr} · Week ${sevenDayStr}`;
        const text = item.rawValue ? data : `Usage: ${data}`;

        // Drive color from whichever window is more exhausted
        const maxPct = Math.max(fiveHrPct ?? 0, sevenDayPct ?? 0);
        return colorizeText(text, maxPct);
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(_item: WidgetItem): boolean { return true; }
}
