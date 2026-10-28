let nextLabelId = 0;

// Obsidian creates its colored tooltips from aria-label. Keep the accessible
// name using aria-labelledby instead, and also remove native title tooltips.
function suppressHoverHints(root) {
    const doc = root.ownerDocument;
    if (!doc?.createElement || !root.querySelectorAll) return () => {};
    const names = new WeakMap();
    const clean = element => {
        if (!element.getAttribute) return;
        const label = element.getAttribute('aria-label');
        if (label) {
            let name = names.get(element);
            if (!name) {
                name = doc.createElement('span');
                name.id = 'weekcraft-accessible-label-' + (++nextLabelId);
                name.hidden = true;
                root.appendChild(name);
                names.set(element, name);
            }
            name.textContent = label;
            element.setAttribute('aria-labelledby', name.id);
            element.removeAttribute('aria-label');
        }
        element.removeAttribute('title');
    };
    const scan = element => {
        clean(element);
        element.querySelectorAll?.('[aria-label], [title]').forEach(clean);
    };
    scan(root);
    const Observer = doc.defaultView?.MutationObserver;
    if (!Observer) return () => {};
    const observer = new Observer(records => {
        for (const record of records) {
            if (record.type === 'attributes') clean(record.target);
            else for (const node of record.addedNodes) if (node.nodeType === 1) scan(node);
        }
    });
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-label', 'title'] });
    return () => observer.disconnect();
}
module.exports = { suppressHoverHints };
