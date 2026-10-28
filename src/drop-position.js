// Resolve the actual insertion boundary instead of outlining an entire card.
function dropPosition(element, clientY) {
    if (!Number.isFinite(clientY)) return { element, ...element._weekcraftDrop };
    let row = element.matches?.('.weekcraft-task[data-wc-item]') ? element : null;
    if (!row && element.matches?.('.weekcraft-group, .weekcraft-lane-body')) {
        const rows = [...element.querySelectorAll('.weekcraft-task[data-wc-item]')];
        row = rows.find(item => clientY <= item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2) || rows.at(-1);
    }
    if (row) {
        const rect = row.getBoundingClientRect();
        const after = clientY > rect.top + rect.height / 2;
        const next = row.nextElementSibling;
        return { element: row, ...row._weekcraftDrop, beforeId: after ? (next?.dataset?.wcItem || null) : row.dataset.wcItem,
            indicatorClass: after ? 'weekcraft-drop-after' : 'weekcraft-drop-before' };
    }
    return { element, ...element._weekcraftDrop, indicatorClass: 'weekcraft-drop-after' };
}
module.exports = { dropPosition };
