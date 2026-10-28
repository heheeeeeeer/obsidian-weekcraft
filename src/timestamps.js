const { completionTime } = require('./tasks');
const OWNED = / <!-- dayflow:stamp:([^<>\s]+) -->/;

function stripOwned(body) {
    const marker = body.match(OWNED);
    if (!marker) return body;
    try {
        const suffix = decodeURIComponent(marker[1]);
        const full = ` ${suffix}${marker[0]}`;
        if (body.endsWith(full)) return body.slice(0, -full.length);
        // Some timestamp tools move metadata before the visible suffix. Only remove
        // the exact suffix described by our own marker, and only at the line end.
        const moved = `${marker[0]} ${suffix}`;
        if (body.endsWith(moved)) return body.slice(0, -moved.length);
        if (body.endsWith(marker[0])) return body.slice(0, -marker[0].length);
        return body;
    } catch { return body; }
}

function timeLabel(settings, now = new Date()) {
    const full = completionTime(now, settings.timeZone);
    const format = settings.timestampFormat || 'HH:mm';
    const formatted = format === 'YYYY年MM月DD日 HH:mm' ? `${full.slice(0, 4)}年${full.slice(5, 7)}月${full.slice(8, 10)}日 ${full.slice(11)}`
        : format === 'YYYY-MM-DD' ? full.slice(0, 10)
        : format === 'YYYY-MM-DD HH:mm' ? full : full.slice(11);
    return `${settings.timestampPrefix ?? '✅'} ${formatted}`.trim();
}

function completionDetails(body) {
    const marker = body.match(OWNED);
    let label;
    if (marker) { try { label = decodeURIComponent(marker[1]); } catch { return null; } }
    else label = body.match(/<span class="weekly-kanban-completed">([^<]*)<\/span>/)?.[1];
    if (!label) return null;
    const match = label.match(/^(.*?)(\d{4}年\d{2}月\d{2}日 \d{2}:\d{2}|\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?|\d{2}:\d{2})$/);
    if (!match) return null;
    const value = match[2];
    return { label, prefix: match[1].trim(), value,
        format: value.includes('年') ? 'YYYY年MM月DD日 HH:mm' : value.length === 5 ? 'HH:mm' : value.length === 10 ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm' };
}

function normalizeCompletionValue(value, format) {
    value = value.normalize('NFKC').trim();
    const time = input => {
        const match = input.match(/^(\d{1,2})[:.](\d{2})$/);
        if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error('请输入有效时间，例如 09:28。');
        return `${match[1].padStart(2, '0')}:${match[2]}`;
    };
    if (format === 'HH:mm') return time(value);
    if (format === 'YYYY年MM月DD日 HH:mm') {
        const chinese = value.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(.+)$/);
        if (!chinese) throw new Error('请输入有效日期和时间，例如 2026年10月27日 15:00。');
        const normalized = normalizeCompletionValue(chinese[1] + '-' + chinese[2].padStart(2, '0') + '-' + chinese[3].padStart(2, '0') + ' ' + chinese[4], 'YYYY-MM-DD HH:mm');
        return normalized.slice(0, 4) + '年' + normalized.slice(5, 7) + '月' + normalized.slice(8, 10) + '日 ' + normalized.slice(11);
    }
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](.+))?$/);
    if (!match) throw new Error('请输入有效日期，例如 2026-10-11。');
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = new Date(0); date.setUTCFullYear(year, month - 1, day);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error('日期不存在，请重新填写。');
    if (format === 'YYYY-MM-DD') {
        if (match[4]) throw new Error('当前格式只需要填写日期。');
        return value;
    }
    return `${match[1]}-${match[2]}-${match[3]} ${time(match[4] || '')}`;
}

function replaceCompletionValue(body, value) {
    const details = completionDetails(body);
    if (!details) throw new Error('此任务没有可修改的完成时间。');
    const normalized = normalizeCompletionValue(value, details.format);
    const clean = stripOwned(body).replace(/(?:\r?\n|<br\s*\/?>)?\s*<span class="weekly-kanban-completed">[^<]*<\/span>/g, '').trimEnd();
    const label = `${details.prefix} ${normalized}`.trim();
    return `${clean} ${label} <!-- dayflow:stamp:${encodeURIComponent(label)} -->`;
}

function setTimestamp(body, checked, settings, now = new Date()) {
    const clean = stripOwned(body);
    if (!checked) return clean;
    if (OWNED.test(clean)) return clean;
    // Leave existing unowned timestamps intact rather than claiming/deleting them.
    if (/✅\s+(?:\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?|\d{2}:\d{2})\s*$/u.test(clean)) return clean;
    const suffix = timeLabel(settings, now);
    return `${clean} ${suffix} <!-- dayflow:stamp:${encodeURIComponent(suffix)} -->`;
}

function taskLines(content) {
    let fence = null;
    let frontmatter = false;
    const tasks = [];
    content.split(/\r?\n/).forEach((line, index) => {
        if (index === 0 && line === '---') { frontmatter = true; return; }
        if (frontmatter) { if (line === '---') frontmatter = false; return; }
        const f = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
        if (f) {
            if (!fence) fence = { char: f[1][0], length: f[1].length };
            else if (f[1][0] === fence.char && f[1].length >= fence.length && !f[2].trim()) fence = null;
            return;
        }
        if (fence) return;
        const match = line.match(/^(\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+\[)([ xX])(\]\s+)(.*)$/);
        if (match) tasks.push({ index, line, before: match[1], checked: match[2].toLowerCase() === 'x', after: match[3], body: match[4], key: stripOwned(match[4]) });
    });
    return tasks;
}

function changedTasks(previous, current, settings, now = new Date()) {
    const before = taskLines(previous);
    const after = taskLines(current);
    const oldByKey = new Map();
    const newByKey = new Map();
    for (const task of before) oldByKey.set(task.key, [...(oldByKey.get(task.key) || []), task]);
    for (const task of after) newByKey.set(task.key, [...(newByKey.get(task.key) || []), task]);
    const changes = [];
    for (const task of after) {
        const olds = oldByKey.get(task.key) || [];
        const news = newByKey.get(task.key) || [];
        // Pair unique tasks across line moves; duplicate task text is only paired at the same line
        // when counts and surrounding task order are stable. Ambiguous edits are skipped.
        const old = olds.length === 1 && news.length === 1 ? olds[0]
            : olds.length === news.length && before.length === after.length
                && before.every((item, index) => item.key === after[index]?.key && item.index === after[index]?.index)
                ? olds.find(item => item.index === task.index) : null;
        if (!old || old.checked === task.checked) continue;
        const body = setTimestamp(task.body, task.checked, settings, now);
        if (body !== task.body) changes.push({ index: task.index, oldLine: task.line, line: `${task.before}${task.checked ? 'x' : ' '}${task.after}${body}` });
    }
    return changes;
}

function applyTaskChanges(content, changes) {
    const newline = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(/\r?\n/);
    for (const change of changes) if (lines[change.index] === change.oldLine) lines[change.index] = change.line;
    return lines.join(newline);
}
module.exports = { stripOwned, timeLabel, setTimestamp, taskLines, changedTasks, applyTaskChanges, completionDetails, normalizeCompletionValue, replaceCompletionValue };
