// Preserve scroll offsets and the first surviving visible row during redraws.
function captureViewPosition(root) {
    const parents = [];
    for (let node = root.parentElement; node; node = node.parentElement) {
        parents.push({ node, top: node.scrollTop, left: node.scrollLeft });
    }
    const viewport = parents.find(({ node }) => node.scrollHeight > node.clientHeight + 1)?.node;
    const top = viewport?.getBoundingClientRect().top ?? 0;
    const bottom = top + (viewport?.clientHeight || root.ownerDocument.defaultView.innerHeight);
    const anchors = [...root.querySelectorAll('[data-wc-item]')].filter(node => node.dataset.wcItem !== root.dataset?.wcMovingItem).map(node => ({ id: node.dataset.wcItem, top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom })).filter(node => node.bottom > top && node.top < bottom);
    return () => {
        for (const entry of parents) { entry.node.scrollTop = entry.top; entry.node.scrollLeft = entry.left; }
        if (!viewport) return;
        const rows = new Map([...root.querySelectorAll('[data-wc-item]')].map(node => [node.dataset.wcItem, node]));
        const anchor = anchors.find(item => rows.has(item.id));
        if (anchor) viewport.scrollTop += rows.get(anchor.id).getBoundingClientRect().top - anchor.top;
    };
}
module.exports = { captureViewPosition };
