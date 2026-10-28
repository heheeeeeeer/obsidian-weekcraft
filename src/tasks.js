const STAMP = /(?:\r?\n|<br\s*\/?>)?\s*<span class="weekly-kanban-completed">[^<]*<\/span>/g;

function parseRange(value) {
    if (!value.trim()) return null;
    const match = value.normalize("NFKC").trim().match(/^(\d{1,2})(?:[.:](\d{2}))?\s*[-–—~～至]\s*(?:次日\s*)?(\d{1,2})(?:[.:](\d{2}))?$/);
    if (!match) throw new Error("时间格式：14.00-17.00");
    const [hour, minute, lastHour, lastMinute] = [Number(match[1]), Number(match[2] || 0), Number(match[3]), Number(match[4] || 0)];
    if (hour > 23 || lastHour > 23 || minute > 59 || lastMinute > 59) throw new Error("时间不在有效范围内。");
    const fmt = (h, m) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const start = fmt(hour, minute), end = fmt(lastHour, lastMinute);
    if (start === end) throw new Error("开始和结束时间不能相同。");
    return `${start}–${end < start ? "次日 " : ""}${end}`;
}

function completionTime(now = new Date(), timeZone = "") {
    const parts = new Intl.DateTimeFormat("en-GB", {
        ...(timeZone ? { timeZone } : {}), year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(now);
    const get = name => parts.find(part => part.type === name).value;
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function stampChanges(manager, previous, next, time) {
    const oldItems = new Map();
    for (const lane of previous?.children || []) for (const item of lane.children) oldItems.set(item.id, item);
    let changed = false;
    const lanes = (next.children || []).map(lane => {
        let laneChanged = false;
        const items = lane.children.map(item => {
            const previousItem = oldItems.get(item.id);
            let raw = item.data.titleRaw;
            const clean = raw.replace(STAMP, "").trimEnd();
            if (previousItem && !previousItem.data.checked && item.data.checked) {
                raw = `${clean}\n<span class="weekly-kanban-completed">✓ 完成于 ${time}</span>`;
            } else if (!item.data.checked) raw = clean;
            if (raw === item.data.titleRaw) return item;
            const updated = manager.updateItemContent(item, raw);
            laneChanged = changed = true;
            return { ...updated, id: item.id, data: { ...updated.data, checked: item.data.checked, checkChar: item.data.checkChar } };
        });
        return laneChanged ? { ...lane, children: items } : lane;
    });
    return changed ? { ...next, children: lanes } : next;
}


function splitTasks(value) { return value.split(/[;；\r\n]+/).map(text => text.trim()).filter(Boolean); }
module.exports = { STAMP, parseRange, completionTime, stampChanges, splitTasks };
