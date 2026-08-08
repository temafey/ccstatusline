import * as fs from 'fs';

import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';

/**
 * Claude Code records the conversation's auto-generated title as
 * `{"type":"ai-title","aiTitle":"...","sessionId":"..."}` lines in the transcript
 * JSONL. It appends a fresh record every time the title is recomputed rather than
 * rewriting the old one, so the LAST such record wins.
 *
 * This is the human-readable topic, NOT the cross-session messaging address —
 * see SessionName.ts for the addressable identity.
 *
 * Those records are emitted often enough that the newest one always sits close to
 * EOF — measured at 19-33 KB from the end on 4-6 MB transcripts. Reading a bounded
 * tail therefore avoids the full-file read that getTokenMetrics() already pays.
 */
const TAIL_BYTES = 256 * 1024;
const DEFAULT_MAX_LENGTH = 32;
const NO_TITLE = '--';

interface AiTitleRecord {
    type?: string;
    aiTitle?: string;
}

interface Tail {
    text: string;
    /** True when the read started mid-file, so the first line is a fragment. */
    truncated: boolean;
}

/**
 * Module-level memo. A statusline invocation is a fresh process, so this only
 * helps when the same widget is rendered more than once per process (pre-render
 * pass + per-line render, or the widget placed on both lines).
 */
let _cachedKey: string | null = null;
let _cachedTitle: string | null = null;

function readTail(filePath: string, maxBytes: number): Tail | null {
    let fd: number | null = null;
    try {
        const size = fs.statSync(filePath).size;
        if (size === 0)
            return { text: '', truncated: false };

        const start = Math.max(0, size - maxBytes);
        const length = size - start;
        const buf = Buffer.alloc(length);

        fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, buf, 0, length, start);

        return { text: buf.toString('utf-8'), truncated: start > 0 };
    } catch {
        return null;
    } finally {
        if (fd !== null) {
            try {
                fs.closeSync(fd);
            } catch {
                // Nothing useful to do if the descriptor is already gone.
            }
        }
    }
}

function extractTitle(transcriptPath: string): string | null {
    const tail = readTail(transcriptPath, TAIL_BYTES);
    if (!tail)
        return null;

    const lines = tail.text.split('\n');

    // A byte-offset read can land mid-line and mid-UTF-8-codepoint. Dropping the
    // first line discards both problems at once.
    const firstUsable = tail.truncated ? 1 : 0;

    for (let i = lines.length - 1; i >= firstUsable; i--) {
        const line = lines[i];
        if (!line || !line.includes('"ai-title"'))
            continue;

        try {
            const record = JSON.parse(line) as AiTitleRecord;
            const title = record.type === 'ai-title' ? record.aiTitle?.trim() : undefined;
            if (title)
                return title;
        } catch {
            // Torn or non-JSON line — keep scanning backwards.
        }
    }

    return null;
}

function titleFor(transcriptPath: string): string | null {
    let key: string;
    try {
        const stat = fs.statSync(transcriptPath);
        key = `${transcriptPath}:${stat.size}`;
    } catch {
        return null;
    }

    if (key === _cachedKey)
        return _cachedTitle;

    _cachedTitle = extractTitle(transcriptPath);
    _cachedKey = key;
    return _cachedTitle;
}

/**
 * Truncates on character count. `maxWidth` in the item schema is only honoured by
 * the renderer for custom-command widgets, so width control lives here.
 */
function truncate(text: string, max: number): string {
    if (max <= 0 || text.length <= max)
        return text;
    if (max === 1)
        return '…';
    return `${text.slice(0, max - 1)}…`;
}

function readMaxLength(item: WidgetItem): number {
    const raw = item.metadata?.maxLength;
    if (!raw)
        return DEFAULT_MAX_LENGTH;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_LENGTH;
}

export class SessionTitleWidget implements Widget {
    getDefaultColor(): string { return 'yellow'; }
    getDescription(): string {
        return 'Conversation title — the auto-generated ai-title Claude Code shows in the resume picker (read from the transcript)';
    }
    getDisplayName(): string { return 'Session Title'; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        const max = readMaxLength(item);
        return {
            displayText: this.getDisplayName(),
            modifierText: max === DEFAULT_MAX_LENGTH ? undefined : `max ${max}`
        };
    }

    render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        const maxLength = readMaxLength(item);

        if (context.isPreview) {
            const data = truncate('Statusline widget rewrite', maxLength);
            return item.rawValue ? data : `Title: ${data}`;
        }

        const transcriptPath = context.data?.transcript_path;
        const title = transcriptPath ? titleFor(transcriptPath) : null;

        // A fresh session has no ai-title record until Claude Code generates one.
        const data = title ? truncate(title, maxLength) : NO_TITLE;
        return item.rawValue ? data : `Title: ${data}`;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(_item: WidgetItem): boolean { return true; }
}
