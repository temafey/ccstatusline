import * as fs from 'fs';
import * as path from 'path';

import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';

/**
 * The session's identity for cross-session messaging (SendMessage / ListAgents).
 *
 * Claude Code exposes none of this in the statusline stdin payload, and there is
 * no on-disk peer registry: peers are discovered live over the unix sockets in
 * $XDG_RUNTIME_DIR/cc-socks/, and both the registry name and the short [ref] that
 * ListAgents prints are process memory. Two things are recoverable from outside
 * the process:
 *
 *   - the socket, named <pid>.sock, which is what makes the session addressable
 *     at all (bare mode binds none);
 *   - an explicit `--name`, which is the only name that does not drift — an
 *     auto-derived name starts from the cwd folder and then follows the
 *     conversation topic on its own.
 *
 * So this renders `<name> [<pid>]`, with `--` for a session started without
 * `--name`, which is precisely the case where addressing it by name is unreliable.
 */
const NO_NAME = '--';
const UNRESOLVED = '--';
const MAX_PARENT_HOPS = 12;

/** Splits /proc/<pid>/cmdline, which is NUL-separated with a trailing NUL. */
function readCmdline(pid: number): string[] | null {
    try {
        return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf-8')
            .split('\0')
            .filter(arg => arg.length > 0);
    } catch {
        return null;
    }
}

/** Exported for tests: `--name x` and `--name=x` are both accepted. */
export function parseNameFromArgv(argv: string[]): string | null {
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg)
            continue;

        if (arg.startsWith('--name=')) {
            const value = arg.slice('--name='.length).trim();
            if (value)
                return value;
        }

        if (arg === '--name') {
            const value = argv[i + 1]?.trim();
            // A following flag means --name was passed without a value.
            if (value && !value.startsWith('-'))
                return value;
        }
    }
    return null;
}

function isClaudeProcess(argv: string[]): boolean {
    const argv0 = argv[0];
    if (!argv0)
        return false;
    // comm is unreliable here: it has been observed carrying the version string
    // ("2.1.220") or "MainThread" instead of the binary name.
    return path.basename(argv0) === 'claude';
}

function parentOf(pid: number): number | null {
    try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf-8');
        // Field 2 (comm) is parenthesised and may itself contain spaces or
        // parentheses, so anchor on the LAST ')' rather than splitting naively.
        const afterComm = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
        const ppid = Number.parseInt(afterComm[1] ?? '', 10);
        return Number.isFinite(ppid) && ppid > 1 ? ppid : null;
    } catch {
        return null;
    }
}

/**
 * $CLAUDE_CODE_MESSAGING_SOCKET is documented as exported to hooks and Bash, not
 * to the statusline, so the parent walk is the load-bearing path and the env var
 * is only a shortcut. The statusline may be a grandchild (a sidecar wrapper sits
 * between it and Claude Code in some setups), hence the walk rather than one hop.
 */
function resolveSessionPid(): number | null {
    const socket = process.env['CLAUDE_CODE_MESSAGING_SOCKET'];
    if (socket) {
        const fromSocket = Number.parseInt(path.basename(socket, '.sock'), 10);
        if (Number.isFinite(fromSocket) && fromSocket > 1)
            return fromSocket;
    }

    let pid: number | null = process.ppid;
    for (let hop = 0; hop < MAX_PARENT_HOPS && pid !== null; hop++) {
        const argv = readCmdline(pid);
        if (argv && isClaudeProcess(argv))
            return pid;
        pid = parentOf(pid);
    }

    return null;
}

export class SessionNameWidget implements Widget {
    getDefaultColor(): string { return 'yellow'; }
    getDescription(): string {
        return 'Cross-session messaging identity: the explicit --name (or -- when unnamed) plus the pid its peer socket is named after';
    }
    getDisplayName(): string { return 'Session Name'; }
    getEditorDisplay(_item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        if (context.isPreview) {
            const data = 'cmo-statusline [123456]';
            return item.rawValue ? data : `SessionName: ${data}`;
        }

        const pid = resolveSessionPid();
        if (pid === null)
            return item.rawValue ? UNRESOLVED : `SessionName: ${UNRESOLVED}`;

        const argv = readCmdline(pid);
        const name = argv ? parseNameFromArgv(argv) : null;

        const data = `${name ?? NO_NAME} [${pid}]`;
        return item.rawValue ? data : `SessionName: ${data}`;
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(_item: WidgetItem): boolean { return true; }
}
