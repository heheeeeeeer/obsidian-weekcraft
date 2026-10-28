const { parseRange, splitTasks, STAMP } = require('./tasks');
const { stripOwned, setTimestamp } = require('./timestamps');

function cardInfo(item) {
    const raw = stripOwned(item.data.titleRaw.replace(STAMP, '').trimEnd());
    const match = raw.match(/^\*\*([^*\n]+)\*\*\s*/);
    let range = null;
    if (match) { try { range = parseRange(match[1]); } catch {} }
    const rest = range ? raw.slice(match[0].length) : raw;
    const category = rest.match(/(?:^|\s)#日程\/([^\s#]+)/u)?.[1] || '';
    const title = rest.replace(/(?:^|\s)#日程\/[^\s#]+/gu, '').trim();
    return { range, category, title, key: JSON.stringify([range, category]) };
}

function cardTitle(title, range, category) {
    return `${range ? `**${range}**\n` : ''}${title}${category ? ` #日程/${category}` : ''}`;
}

function groupsForLane(lane) {
    const groups = new Map();
    for (const item of lane.children) {
        const info = cardInfo(item);
        let group = groups.get(info.range);
        if (!group) { group = { ...info, preserveCategory: true, items: [] }; groups.set(info.range, group); }
        group.items.push({ item, info });
    }
    return [...groups.values()];
}

function orderedTimeGroups(lane) {
    const minutes = range => { const match = range.match(/^(\d{2}):(\d{2})/); return match ? Number(match[1]) * 60 + Number(match[2]) : Infinity; };
    return groupsForLane(lane).filter(group => group.range).sort((a, b) => minutes(a.range) - minutes(b.range) || a.range.localeCompare(b.range));
}

function copyTask(manager, id, laneId, range) {
    const source = manager.state.children.flatMap(lane => lane.children).find(item => item.id === id);
    if (!source || !manager.state.children.some(lane => lane.id === laneId)) throw new Error('任务或目标日期已不存在，请重新选择。');
    const info = cardInfo(source);
    const copy = manager.getNewItem(cardTitle(info.title, range, info.category), ' ');
    manager.setState(board => ({ ...board, children: board.children.map(lane => lane.id === laneId ? { ...lane, children: [...lane.children, copy] } : lane) }));
    return copy;
}

function insertTaskAfter(manager, anchorId, title) {
    const lane = manager.state.children.find(lane => lane.children.some(item => item.id === anchorId));
    if (!lane) throw new Error('原任务已移动或删除，请重新添加。');
    const anchor = lane.children.find(item => item.id === anchorId);
    const info = cardInfo(anchor);
    const added = manager.getNewItem(cardTitle(title, info.range, info.category), ' ');
    manager.setState(board => ({ ...board, children: board.children.map(current => {
        if (current.id !== lane.id) return current;
        const index = current.children.findIndex(item => item.id === anchorId);
        if (index < 0) throw new Error('原任务已移动或删除，请重新添加。');
        const children = [...current.children]; children.splice(index + 1, 0, added);
        return { ...current, children };
    }) }));
}

function updateCard(manager, id, transform) {
    manager.setState(board => ({ ...board, children: board.children.map(lane => ({ ...lane,
        children: lane.children.map(item => item.id === id ? transform(item) : item),
    })) }));
}

function sortedLane(lane, categories, enabled, backlog = false) {
    if (!enabled) return lane;
    const rank = name => { const index = categories.indexOf(name); return index < 0 ? categories.length : index; };
    return { ...lane, children: lane.children.map((item, index) => ({ item, index, info: cardInfo(item) })).sort((a, b) => {
        if (backlog) {
            return rank(a.info.category) - rank(b.info.category)
                || a.info.category.localeCompare(b.info.category, 'zh-CN') || a.index - b.index;
        }
        const aUntimed = !a.info.range;
        const bUntimed = !b.info.range;
        if (aUntimed !== bUntimed) return aUntimed ? -1 : 1;
        const time = (a.info.range || '').localeCompare(b.info.range || '');
        return time || a.index - b.index;
    }).map(entry => entry.item) };
}

function deleteCard(manager, id) {
    manager.setState(board => ({ ...board, children: board.children.map(lane => ({ ...lane, children: lane.children.filter(item => item.id !== id) })) }));
}

function changeCategory(manager, ids, category) {
    const targets = new Set(ids);
    manager.setState(board => ({ ...board, children: board.children.map(lane => ({ ...lane, children: lane.children.map(item => {
        if (!targets.has(item.id)) return item;
        const info = cardInfo(item);
        const suffix = item.data.titleRaw.slice(stripOwned(item.data.titleRaw).length);
        const legacy = item.data.titleRaw.match(STAMP)?.join('') || '';
        const updated = manager.updateItemContent(item, cardTitle(info.title, info.range, category) + suffix + legacy);
        return { ...updated, id: item.id, data: { ...updated.data, checked: item.data.checked, checkChar: item.data.checkChar } };
    }) })) }));
}

function changeTime(manager, ids, range) {
    const targets = new Set(ids);
    manager.setState(board => ({ ...board, children: board.children.map(lane => ({ ...lane, children: lane.children.map(item => {
        if (!targets.has(item.id)) return item;
        const info = cardInfo(item);
        const suffix = item.data.titleRaw.slice(stripOwned(item.data.titleRaw).length);
        const legacy = item.data.titleRaw.match(STAMP)?.join('') || '';
        const updated = manager.updateItemContent(item, cardTitle(info.title, range, info.category) + suffix + legacy);
        return { ...updated, id: item.id, data: { ...updated.data, checked: item.data.checked, checkChar: item.data.checkChar } };
    }) })) }));
}

function deleteLane(manager, id) {
    manager.setState(board => {
        const lane = board.children.find(lane => lane.id === id);
        const backlog = board.children[0];
        if (!lane || lane === backlog) return board;
        // Removing a date never deletes its tasks: return them to the backlog.
        const returned = lane.children.map(item => {
            const info = cardInfo(item);
            const suffix = item.data.titleRaw.slice(stripOwned(item.data.titleRaw).length);
            const legacy = item.data.titleRaw.match(STAMP)?.join('') || '';
            const updated = manager.updateItemContent(item, cardTitle(info.title, null, info.category) + suffix + legacy);
            return { ...updated, id: item.id, data: { ...updated.data, checked: item.data.checked, checkChar: item.data.checkChar } };
        });
        return { ...board, children: board.children.filter(item => item.id !== id).map(item => item.id === backlog.id ? { ...item, children: [...item.children, ...returned] } : item) };
    });
}

function clearLane(manager, id) {
    manager.setState(board => {
        const lane = board.children.find(lane => lane.id === id);
        const backlog = board.children[0];
        if (!lane || lane === backlog) return board;
        return {
            ...board,
            children: board.children.map(item => item.id === id ? { ...item, children: [] } : item)
        };
    });
}

function moveCard(manager, id, destinationId, group = null, beforeId = null) {
    manager.setState(board => {
        const source = board.children.find(lane => lane.children.some(item => item.id === id));
        const destination = board.children.find(lane => lane.id === destinationId);
        if (!source || !destination || beforeId === id) return board;
        let item = source.children.find(item => item.id === id);
        if (!group && destination === board.children[0]) group = { range: null, category: cardInfo(item).category };
        if (group) {
            const info = cardInfo(item);
            const raw = cardTitle(info.title, group.range, group.preserveCategory ? info.category : group.category);
            const owned = item.data.titleRaw.slice(stripOwned(item.data.titleRaw).length);
            const legacy = item.data.titleRaw.match(STAMP)?.join('') || '';
            const updated = manager.updateItemContent(item, raw + owned + legacy);
            item = { ...updated, id: item.id,
                data: { ...updated.data, checked: item.data.checked, checkChar: item.data.checkChar } };
        }
        return { ...board, children: board.children.map(lane => {
            const children = lane.children.filter(card => card.id !== id);
            if (lane.id === destinationId) {
                const position = beforeId ? children.findIndex(card => card.id === beforeId) : -1;
                children.splice(position >= 0 ? position : children.length, 0, item);
            }
            return { ...lane, children };
        }) };
    });
}

function expandLegacyCards(manager) {
    let changed = false;
    const children = manager.state.children.map(lane => ({ ...lane, children: lane.children.flatMap(item => {
        const info = cardInfo(item);
        const titles = info.range ? splitTasks(info.title) : [info.title];
        if (titles.length <= 1) return [item];
        changed = true;
        return titles.map((title, index) => {
            const raw = cardTitle(title, info.range, info.category);
            const suffix = item.data.titleRaw.slice(stripOwned(item.data.titleRaw).length);
            const legacy = item.data.titleRaw.match(STAMP)?.join('') || '';
            const updated = index === 0 ? manager.updateItemContent(item, raw + suffix + legacy)
                : manager.getNewItem(raw + suffix + legacy, item.data.checkChar || (item.data.checked ? 'x' : ' '));
            return { ...updated, ...(index === 0 ? { id: item.id } : {}), data: { ...updated.data, checked: item.data.checked, checkChar: item.data.checkChar } };
        });
    }) }));
    if (changed) manager.setState({ ...manager.state, children });
    return changed;
}

function stampBoardTransitions(manager, previous, next, settings, now = new Date()) {
    const oldItems = new Map(previous.children.flatMap(lane => lane.children.map(item => [item.id, item])));
    let changed = false;
    const children = next.children.map(lane => ({ ...lane, children: lane.children.map(item => {
        const old = oldItems.get(item.id);
        if (!old || old.data.checked === item.data.checked) return item;
        const raw = setTimestamp(item.data.titleRaw.replace(STAMP, '').trimEnd(), item.data.checked, settings, now);
        if (raw === item.data.titleRaw) return item;
        changed = true;
        const updated = manager.updateItemContent(item, raw);
        return { ...updated, id: item.id, data: { ...updated.data, checked: item.data.checked, checkChar: item.data.checkChar } };
    }) }));
    return changed ? { ...next, children } : next;
}
module.exports = { orderedTimeGroups, copyTask, insertTaskAfter, cardInfo, cardTitle, groupsForLane, updateCard, moveCard, expandLegacyCards, stampBoardTransitions, sortedLane, deleteCard, changeCategory, changeTime, deleteLane, clearLane };
