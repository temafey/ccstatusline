import chalk from 'chalk';

import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    CustomKeybind,
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';

const DEFAULT_MODEL_WINDOW = 200000;
const DEFAULT_PCT_OVERRIDE = 95;

function readEffectiveSoftLimit(modelWindow: number, item: WidgetItem): number {
    if (item.metadata?.softLimit) {
        const explicit = Number.parseInt(item.metadata.softLimit, 10);
        if (Number.isFinite(explicit) && explicit > 0) return explicit;
    }
    const overrideWindow = Number.parseInt(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW ?? '0', 10) || 0;
    const rawPct = Number.parseInt(process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE ?? '', 10);
    const pct = Number.isFinite(rawPct) && rawPct >= 1 && rawPct <= 100 ? rawPct : DEFAULT_PCT_OVERRIDE;
    const effectiveWindow = overrideWindow > 0 ? Math.min(overrideWindow, modelWindow) : modelWindow;
    return Math.floor(effectiveWindow * pct / 100);
}

// Hard% thresholds for color transitions
const HARD_PCT_CRITICAL = 80;   // red/critical
const SOFT_PCT_WARNING  = 100;  // yellow/warning (soft limit crossed but hard < 80)

function humanize(n: number): string {
    if (n >= 1_000_000) {
        const val = n / 1_000_000;
        return Number.isInteger(val) ? `${val}M` : `${val.toFixed(1)}M`;
    }
    if (n >= 1000) {
        return `${Math.round(n / 1000)}k`;
    }
    return n.toString();
}

function colorizeText(text: string, hardPct: number, softPct: number): string {
    if (hardPct >= HARD_PCT_CRITICAL) {
        return chalk.red(text);
    }
    if (softPct >= SOFT_PCT_WARNING) {
        return chalk.yellow(text);
    }
    // Default: no override — let outer widget color apply
    return text;
}

export class ContextPercentageUsableWidget implements Widget {
    getDefaultColor(): string { return 'green'; }
    getDescription(): string { return 'Shows context usage: tokens used vs model window with hard% and soft% thresholds'; }
    getDisplayName(): string { return 'Context % (usable)'; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        const isInverse = item.metadata?.inverse === 'true';
        const modifiers: string[] = [];

        if (isInverse) {
            modifiers.push('remaining');
        }

        return {
            displayText: this.getDisplayName(),
            modifierText: modifiers.length > 0 ? `(${modifiers.join(', ')})` : undefined
        };
    }

    handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
        if (action === 'toggle-inverse') {
            const currentState = item.metadata?.inverse === 'true';
            return {
                ...item,
                metadata: {
                    ...item.metadata,
                    inverse: (!currentState).toString()
                }
            };
        }
        return null;
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        if (context.isPreview) {
            const data = '117k / 297k (39%)';
            return item.rawValue ? data : `Context: ${data}`;
        } else if (context.tokenMetrics) {
            const contextLength = context.tokenMetrics.contextLength;
            const modelWindow = context.data?.context_window?.context_window_size ?? DEFAULT_MODEL_WINDOW;
            const softLimit = readEffectiveSoftLimit(modelWindow, item);

            const hardPct = Math.min(100, (contextLength / modelWindow) * 100);
            const softPct = Math.min(100, (contextLength / softLimit) * 100);

            const data = `${humanize(contextLength)} / ${humanize(softLimit)} (${softPct.toFixed(0)}%)`;
            const text = item.rawValue ? data : `Context: ${data}`;
            return colorizeText(text, hardPct, softPct);
        }
        return null;
    }

    getCustomKeybinds(): CustomKeybind[] {
        return [
            { key: 'l', label: '(l)eft/remaining', action: 'toggle-inverse' }
        ];
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}