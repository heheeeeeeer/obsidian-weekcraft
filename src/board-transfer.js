const { cardInfo, cardTitle, moveCard } = require('./board-model');
const { stripOwned } = require('./timestamps');
const { STAMP } = require('./tasks');

function findCard(manager, id) {
    for (const lane of manager.state.children) {
        const index = lane.children.findIndex(item => item.id === id);
        if (index >= 0) return { lane, index, item: lane.children[index] };
    }
    return null;
}
function unchanged(a, b) {
    return a?.data.titleRaw === b?.data.titleRaw && a?.data.checked === b?.data.checked && a?.data.checkChar === b?.data.checkChar;
}
function removeExact(manager, id, expected) {
    const found = findCard(manager, id);
    if (!found || !unchanged(found.item, expected)) return false;
    manager.setState(board => ({ ...board, children: board.children.map(lane => ({ ...lane, children: lane.children.filter(item => item.id !== id) })) }));
    return !findCard(manager, id);
}

async function transferTask({ sourceManager, targetManager, sourcePath, targetPath, id, laneId, group = null, beforeId = null, persist }) {
    if (sourcePath === targetPath) {
        moveCard(sourceManager, id, laneId, group, beforeId);
        return { status: 'moved' };
    }
    const source = findCard(sourceManager, id);
    const destination = targetManager.state.children.find(lane => lane.id === laneId);
    if (!source || !destination) throw new Error('任务或目标日期已发生变化，请重新拖动。');
    const original = { ...source.item, data: { ...source.item.data } };
    let raw = original.data.titleRaw;
    if (!group && destination === targetManager.state.children[0]) group = { range: null, category: cardInfo(original).category };
    if (group) {
        const info = cardInfo(original);
        const suffix = raw.slice(stripOwned(raw).length);
        const legacy = raw.match(STAMP)?.join('') || '';
        raw = cardTitle(info.title, group.range, group.preserveCategory ? info.category : group.category) + suffix + legacy;
    }
    // Parse against the target note, generating a new ID and fresh target metadata.
    const parsed = targetManager.getNewItem(raw, original.data.checkChar || (original.data.checked ? 'x' : ' '));
    const copy = { ...parsed, data: { ...parsed.data, checked: original.data.checked, checkChar: original.data.checkChar || (original.data.checked ? 'x' : ' ') } };
    const expectedCopy = { ...copy, data: { ...copy.data } };
    if (findCard(targetManager, copy.id)) throw new Error('目标看板生成了重复任务编号，原任务未移动。');
    targetManager.setState(board => ({ ...board, children: board.children.map(lane => {
        if (lane.id !== laneId) return lane;
        const children = [...lane.children];
        const index = beforeId ? children.findIndex(item => item.id === beforeId) : -1;
        children.splice(index >= 0 ? index : children.length, 0, copy);
        return { ...lane, children };
    }) }));
    if (!findCard(targetManager, copy.id)) throw new Error('无法添加到目标日期，原任务未移动。');
    try {
        await persist(targetManager, targetPath);
    } catch (error) {
        removeExact(targetManager, copy.id, expectedCopy);
        throw new Error(`目标看板保存失败，原任务仍保留：${error.message}`);
    }
    // Never delete a task edited while its target copy was being saved.
    const fresh = findCard(sourceManager, id);
    if (!fresh || !unchanged(fresh.item, original)) {
        if (removeExact(targetManager, copy.id, expectedCopy)) {
            try { await persist(targetManager, targetPath); } catch { /* The original source remains intact. */ }
        }
        throw new Error('原任务在移动过程中发生变化，已保留原任务，请重新拖动。');
    }
    if (!removeExact(sourceManager, id, original)) throw new Error('原任务未能移除，目标已有一份副本，请检查两个看板。');
    try {
        await persist(sourceManager, sourcePath);
    } catch (error) {
        // A durable target copy already exists. Restore only the missing source task,
        // never overwrite the rest of either board with a stale full-board snapshot.
        if (!findCard(sourceManager, id)) sourceManager.setState(board => {
            const lane = board.children.find(lane => lane.id === source.lane.id) || board.children[0];
            if (!lane) return board;
            return { ...board, children: board.children.map(current => {
                if (current.id !== lane.id) return current;
                const children = [...current.children]; children.splice(Math.min(source.index, children.length), 0, original);
                return { ...current, children };
            }) };
        });
        try { await persist(sourceManager, sourcePath); } catch { /* The target copy is still durable. */ }
        throw new Error('目标已保存，但原看板保存失败。已保留任务，请检查两个看板中的副本。');
    }
    return { status: 'moved', targetId: copy.id };
}
module.exports = { transferTask };
