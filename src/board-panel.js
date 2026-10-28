const { Component, MarkdownRenderer, Menu, Notice, setIcon } = require('obsidian');
const { orderedTimeGroups, insertTaskAfter, cardInfo, cardTitle, groupsForLane, updateCard, moveCard, sortedLane, deleteCard, changeCategory, changeTime, deleteLane, clearLane } = require('./board-model');
const { stripOwned, completionDetails, normalizeCompletionValue, replaceCompletionValue } = require('./timestamps');
const { parseRange } = require('./tasks');
const { categoryColor } = require('./category-colors');
const { suppressHoverHints } = require('./hover-hints');
const { captureViewPosition } = require('./view-position');
const { CopyTaskForm } = require('./copy-task-form');

class BoardPanel {
    constructor(adapter, view) {
        this.adapter = adapter; this.plugin = adapter.plugin; this.view = view;
        this.root = (view.contentEl || view.containerEl).createDiv({ cls: 'weekcraft-board' });
        this.stopHoverHints = suppressHoverHints(this.root);
        this.dragged = null; this.signature = null; this.collapsed = new Set();
        this.autoCollapsed = new Set(); this.seenLanes = new Set();
        this.component = null; this.touch = null;
    }
    refresh() {
        const manager = this.adapter.manager(this.view.file);
        if (!manager) return;
        if (this.inlineDraft?.isConnected || this.touch?.moved) return;
        const signature = JSON.stringify(manager.state.children.map(lane => [lane.id, lane.data.title,
            lane.children.map(item => [item.id, item.data.checked, item.data.titleRaw])]))
            + JSON.stringify([this.plugin.settings.laneWidth, this.plugin.settings.categories, this.plugin.settings.categoryColors,
                this.plugin.settings.automaticCategorySorting, this.plugin.settings.completedTaskStrikethrough, this.plugin.settings.showTaskNumbers, this.dayThemes()]);
        if (signature === this.signature) return;
        const restorePosition = captureViewPosition(this.root);
        const previousMinHeight = this.root.style.minHeight;
        this.root.style.minHeight = this.root.getBoundingClientRect().height + 'px';
        this.closeMenu?.();
        this.signature = signature;
        this.root.classList.toggle('weekcraft-show-numbers', Boolean(this.plugin.settings.showTaskNumbers));
        this.root.classList.toggle('weekcraft-no-strikethrough', this.plugin.settings.completedTaskStrikethrough === false);
        this.component?.unload(); this.component = new Component(); this.component.load();
        const focused = this.root.ownerDocument.activeElement?.dataset?.wcFocus;
        const liveLaneIds = new Set(manager.state.children.map(lane => lane.id));
        for (const set of [this.collapsed, this.autoCollapsed, this.seenLanes]) {
            for (const id of [...set]) if (!liveLaneIds.has(id)) set.delete(id);
        }
        this.root.empty();
        for (const [index, lane] of manager.state.children.entries()) {
            this.syncDefaultCollapse(lane, index === 0);
            this.renderLane(sortedLane(lane, this.plugin.settings.categories, this.plugin.settings.automaticCategorySorting, index === 0), index === 0);
        }
        if (focused) [...this.root.querySelectorAll('[data-wc-focus]')].find(el => el.dataset.wcFocus === focused)?.focus({ preventScroll: true });
        this.root.style.minHeight = previousMinHeight;
        restorePosition();
    }
    bind(el, event, callback, options) { this.component.registerDomEvent(el, event, callback, options); }
    current() { return this.adapter.manager(this.view.file); }
    syncDefaultCollapse(lane, backlog = false) {
        if (backlog) return;
        if (!this.seenLanes.has(lane.id)) {
            this.seenLanes.add(lane.id);
            if (!lane.children.length) {
                this.collapsed.add(lane.id);
                this.autoCollapsed.add(lane.id);
            }
            return;
        }
        if (lane.children.length && this.autoCollapsed.has(lane.id)) {
            this.autoCollapsed.delete(lane.id);
            this.collapsed.delete(lane.id);
        }
    }
    renderLane(lane, backlog = false) {
        this.rowPosition = 0;
        const section = this.root.createEl('section', { cls: 'weekcraft-lane' });
        const header = section.createDiv({ cls: 'weekcraft-lane-header' });
        const toggle = header.createEl('button', { cls: 'weekcraft-lane-toggle',
            attr: { 'aria-label': `折叠或展开 ${lane.data.title}`, 'aria-expanded': String(!this.collapsed.has(lane.id)) } });
        setIcon(toggle, this.collapsed.has(lane.id) ? 'chevron-right' : 'chevron-down');
        header.createEl('h3', { text: lane.data.title });
        const theme = !backlog ? header.createEl('span', { cls: 'weekcraft-day-theme', text: this.dayThemes()[lane.data.title] || '' }) : null;
        if (theme) theme.hidden = !this.dayThemes()[lane.data.title];
        const actions = header.createDiv({ cls: 'weekcraft-lane-actions' });
        const add = actions.createEl('button', { cls: 'weekcraft-add', attr: { 'aria-label': `添加日程 · ${lane.data.title}` } });
        setIcon(add, 'plus');
        this.bind(add, 'click', () => this.adapter.openForm(this.view, lane.id));
        if (!backlog) {
            const more = actions.createEl('button', {
                cls: 'weekcraft-lane-more',
                attr: { 'aria-label': '日期操作 ' + lane.data.title }
            });
            setIcon(more, 'ellipsis');
            this.bind(more, 'click', event => {
                event.stopPropagation();
                const menu = new Menu();
                menu.addItem(entry => entry.setTitle('编辑主题').setIcon('pencil').onClick(() => this.editDayTheme(theme, lane.data.title)));
                menu.addItem(entry => entry.setTitle('清空日程').setIcon('eraser').onClick(() => { clearLane(this.current(), lane.id); this.refresh(); }));
                menu.addItem(entry => entry.setTitle('删除日期').setIcon('trash-2').onClick(() => { deleteLane(this.current(), lane.id); this.refresh(); }));
                this.showMenu(menu, more, ['删除日期']);
            });
        }
        this.bind(toggle, 'click', () => {
            this.autoCollapsed.delete(lane.id);
            this.collapsed.has(lane.id) ? this.collapsed.delete(lane.id) : this.collapsed.add(lane.id);
            this.signature = null; this.refresh();
        });
        this.dropTarget(header, lane.id);
        const body = section.createDiv({ cls: 'weekcraft-lane-body' });
        body.hidden = this.collapsed.has(lane.id);
        this.dropTarget(body, lane.id);
        const groups = groupsForLane(lane);
        if (lane.children.length && !groups.some(group => group.range)) {
            this.renderGroup(body, lane, { range: null, category: '', items: lane.children.map(item => ({ item, info: cardInfo(item) })) });
        } else for (const group of groups) this.renderGroup(body, lane, group);
        if (!lane.children.length) body.createEl('div', { cls: 'weekcraft-empty', text: '拖入待办，或点击右上角 ＋' });
    }
    renderGroup(body, lane, group) {
        const box = body.createDiv({ cls: `weekcraft-group${group.range ? ' is-scheduled' : ''}` });
        if (group.range) {
            box.style.setProperty('--weekcraft-group-color', categoryColor(group.category, this.plugin.settings));
            const first = box.createDiv({ cls: 'weekcraft-group-header' });
            const time = first.createEl('button', { cls: 'weekcraft-time', text: group.range,
                attr: { 'aria-label': `编辑时间 ${group.range}` } });
            this.bind(time, 'click', () => this.editTime(time, group.items.map(entry => entry.item.id), group.range));
        }
        this.dropTarget(box, lane.id, group.range ? group : null);
        for (const { item, info } of group.items) {
            const row = box.createDiv({ cls: `weekcraft-task${item.data.checked ? ' is-complete' : ''}` });
            row.dataset.wcItem = item.id;
            row.dataset.wcPosition = String(++this.rowPosition);
            const grip = row.createEl('button', { cls: 'weekcraft-grip', text: '⠿', attr: { 'aria-label': `拖动任务 ${info.title}` } });
            const checkbox = row.createEl('input', { cls: 'weekcraft-checkbox', attr: { type: 'checkbox', 'aria-label': `完成任务 ${info.title}` } });
            setIcon(grip, 'grip-vertical');
            grip.createEl('span', { cls: 'weekcraft-row-number', text: row.dataset.wcPosition, attr: { 'aria-hidden': 'true' } });
            checkbox.checked = item.data.checked;
            checkbox.dataset.wcFocus = item.id;
            // Stop double clicks on checkboxes from reaching the native card editor.
            this.bind(checkbox, 'dblclick', event => { event.stopPropagation(); event.preventDefault(); });
            this.bind(checkbox, 'click', event => event.stopPropagation());
            this.bind(checkbox, 'change', () => {
                const manager = this.current(); if (!manager) return;
                updateCard(manager, item.id, current => ({ ...current, data: { ...current.data, checked: checkbox.checked, checkChar: checkbox.checked ? 'x' : ' ' } }));
                this.refresh();
            });
            const text = row.createDiv({ cls: 'weekcraft-task-text' });
            const label = text.createDiv({ cls: 'weekcraft-task-label' });
            label.setAttribute('role', 'button');
            label.setAttribute('tabindex', '0');
            label.setAttribute('aria-label', `编辑任务 ${info.title}`);
            MarkdownRenderer.render(this.plugin.app, info.title || '未命名任务', label, this.view.file.path, this.component)
                .catch(() => { label.textContent = info.title; });
            this.bind(text, 'click', event => {
                if (event.target.closest?.('a, input, textarea, .weekcraft-completed') || text.querySelector('.weekcraft-inline-task')) return;
                const selection = this.root.ownerDocument.defaultView.getSelection();
                if (selection && !selection.isCollapsed) return;
                this.editTask(text, label, item.id, info.title);
            });
            this.bind(label, 'keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.editTask(text, label, item.id, info.title); }
            });
            const completion = completionDetails(item.data.titleRaw);
            if (item.data.checked && completion) {
                const completed = text.createEl('button', { cls: 'weekcraft-completed', text: completion.label,
                    attr: { 'aria-label': `编辑完成时间 ${completion.value}` } });
                this.bind(completed, 'click', event => { event.stopPropagation(); this.editCompletion(completed, item.id, completion); });
            }
            this.renderTag(row, info.category, [item.id]);
            const more = row.createEl('button', { cls: 'weekcraft-task-more', attr: { 'aria-label': '任务操作 ' + info.title } });
            setIcon(more, 'ellipsis');
            this.bind(more, 'click', event => {
                event.stopPropagation();
                const menu = new Menu();
                menu.addItem(entry => entry.setTitle('添加任务').setIcon('plus').onClick(() => this.addTaskInline(row, item.id, info)));
                menu.addItem(entry => entry.setTitle('编辑任务').setIcon('pencil').onClick(() => this.adapter.openForm(this.view, lane.id, { itemId: item.id })));
                menu.addItem(entry => entry.setTitle('复制任务').setIcon('copy').onClick(() => new CopyTaskForm(this.plugin.app, this, item.id).open()));
                menu.addItem(entry => entry.setTitle('删除任务').setIcon('trash-2').onClick(() => { deleteCard(this.current(), item.id); this.refresh(); }));
                this.showMenu(menu, more, ['删除任务']);
            });
            this.dropTarget(row, lane.id, group.range ? group : null, item.id);
            grip.draggable = false;
            this.bind(grip, 'dragstart', event => {
                this.dragged = item.id; event.dataTransfer.setData('application/x-weekcraft-task', item.id);
                event.dataTransfer.effectAllowed = 'move'; row.classList.add('is-dragging');
            });
            this.bind(grip, 'dragend', () => { this.dragged = null; row.classList.remove('is-dragging'); this.clearDropTargets(); });
            // Keyboard and touch users can move a task via the same handle.
            this.bind(grip, 'click', () => this.moveMenu(item.id, grip));
            this.touchDrag(grip, row, item.id);
        }
    }
    dayThemes() {
        const themes = this.plugin.app.metadataCache.getFileCache(this.view.file)?.frontmatter?.['weekcraft-day-themes'];
        return themes && typeof themes === 'object' && !Array.isArray(themes) ? themes : {};
    }
    editDayTheme(button, date) {
        if (button.nextElementSibling?.classList.contains('weekcraft-theme-input')) return;
        const input = button.ownerDocument.createElement('input');
        input.className = 'weekcraft-theme-input'; input.type = 'text'; input.placeholder = '今天的主题';
        input.value = typeof this.dayThemes()[date] === 'string' ? this.dayThemes()[date] : '';
        input.setAttribute('aria-label', '今日主题'); button.hidden = true; button.after(input);
        let finished = false;
        const cancel = () => { if (finished) return; finished = true; input.remove(); button.hidden = !this.dayThemes()[date]; };
        const save = async () => {
            if (finished) return;
            const value = input.value.trim(); finished = true;
            try {
                await this.plugin.app.fileManager.processFrontMatter(this.view.file, data => {
                    const stored = data['weekcraft-day-themes'];
                    const themes = stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {};
                    if (value) themes[date] = value; else delete themes[date];
                    if (Object.keys(themes).length) data['weekcraft-day-themes'] = themes; else delete data['weekcraft-day-themes'];
                });
                button.textContent = value; input.remove(); button.hidden = !value;
            } catch (error) { finished = false; new Notice('主题保存失败：' + error.message); }
        };
        this.bind(input, 'keydown', event => {
            if (event.isComposing) return;
            if (event.key === 'Enter') { event.preventDefault(); save(); }
            else if (event.key === 'Escape') { event.preventDefault(); cancel(); }
        });
        this.bind(input, 'blur', save);
        const focus = () => { input.focus({ preventScroll: true }); input.select(); };
        if (button.ownerDocument.defaultView.requestAnimationFrame) button.ownerDocument.defaultView.requestAnimationFrame(focus); else focus();
    }
    editCompletion(button, id, completion) {
        const input = button.ownerDocument.createElement('input');
        input.type = 'text'; input.className = 'weekcraft-inline-completed'; input.value = completion.value;
        input.style.width = `${completion.value.length + 2}ch`;
        input.setAttribute('aria-label', '编辑完成时间');
        button.replaceWith(input);
        let finished = false;
        const cancel = () => { if (finished) return; finished = true; input.replaceWith(button); button.focus(); };
        const save = () => {
            if (finished) return;
            try {
                const value = normalizeCompletionValue(input.value, completion.format);
                const manager = this.current(); if (!manager) { cancel(); return; }
                input.setCustomValidity(''); finished = true;
                updateCard(manager, id, item => {
                    if (!item.data.checked || !completionDetails(item.data.titleRaw)) return item;
                    const updated = manager.updateItemContent(item, replaceCompletionValue(item.data.titleRaw, value));
                    return { ...updated, id: item.id, data: { ...updated.data, checked: item.data.checked, checkChar: item.data.checkChar } };
                });
                if (input.isConnected) input.replaceWith(button);
                this.refresh();
            } catch (error) { finished = false; input.setCustomValidity(error.message); input.reportValidity(); input.focus(); }
        };
        this.bind(input, 'keydown', event => {
            if (event.isComposing) return;
            if (event.key === 'Enter') { event.preventDefault(); save(); }
            else if (event.key === 'Escape') { event.preventDefault(); cancel(); }
        });
        this.bind(input, 'blur', save);
        input.focus(); input.select();
    }
    editTime(button, ids, previousRange) {
        const input = button.ownerDocument.createElement('input');
        input.type = 'text'; input.className = 'weekcraft-inline-time'; input.value = previousRange;
        input.setAttribute('aria-label', '编辑时间段');
        button.replaceWith(input);
        let finished = false;
        const cancel = () => { if (finished) return; finished = true; input.replaceWith(button); button.focus(); };
        const save = () => {
            if (finished) return;
            try {
                const range = parseRange(input.value);
                input.setCustomValidity(''); finished = true;
                const manager = this.current();
                if (manager) changeTime(manager, ids, range);
                if (input.isConnected) input.replaceWith(button);
                this.refresh();
            } catch (error) { input.setCustomValidity(error.message); input.reportValidity(); input.focus(); }
        };
        this.bind(input, 'keydown', event => {
            if (event.isComposing) return;
            if (event.key === 'Enter') { event.preventDefault(); save(); }
            else if (event.key === 'Escape') { event.preventDefault(); cancel(); }
        });
        this.bind(input, 'blur', save);
        input.focus(); input.select();
    }
    addTaskInline(anchor, anchorId, info) {
        if (this.inlineDraft?.isConnected) {
            this.inlineDraft.querySelector('textarea')?.focus(); return;
        }
        this.closeMenu?.();
        const draft = anchor.parentElement.createDiv({ cls: 'weekcraft-task weekcraft-task-draft' });
        anchor.after(draft); this.inlineDraft = draft;
        draft.createDiv({ cls: 'weekcraft-grip' });
        draft.createEl('input', { cls: 'weekcraft-checkbox', attr: { type: 'checkbox', disabled: 'disabled' } });
        const text = draft.createDiv({ cls: 'weekcraft-task-text' });
        const input = text.createEl('textarea', { cls: 'weekcraft-inline-task', attr: { rows: '1', placeholder: '输入任务内容', 'aria-label': '新任务内容' } });
        const tag = draft.createEl('span', { cls: 'weekcraft-tag', text: info.category || '' });
        tag.style.setProperty('--weekcraft-tag-color', categoryColor(info.category, this.plugin.settings));
        if (!info.category) tag.hidden = true;
        let finished = false;
        const cancel = () => {
            if (finished) return;
            finished = true; this.inlineDraft = null; draft.remove(); this.refresh();
        };
        const save = () => {
            if (finished) return;
            const title = input.value.trim();
            if (!title) { cancel(); return; }
            const manager = this.current();
            if (!manager) { new Notice('看板暂时不可用，请稍后重试。'); return; }
            try {
                insertTaskAfter(manager, anchorId, title);
                cancel();
            } catch (error) { new Notice(error.message); }
        };
        this.bind(input, 'input', () => { input.style.height = '0px'; input.style.height = (input.scrollHeight + 2) + 'px'; });
        this.bind(input, 'keydown', event => {
            if (event.isComposing) return;
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); save(); }
            else if (event.key === 'Escape') { event.preventDefault(); cancel(); }
        });
        this.bind(input, 'blur', save);
        // Menus restore focus when closing; focus the draft after that completes.
        anchor.ownerDocument.defaultView.requestAnimationFrame(() => { if (!finished && input.isConnected) input.focus(); });
    }
    editTask(text, label, id, previousTitle) {
        if (text.querySelector('.weekcraft-inline-task')) return;
        const input = text.ownerDocument.createElement('textarea');
        const originalHeight = Math.ceil(label.getBoundingClientRect().height);
        input.className = 'weekcraft-inline-task'; input.value = previousTitle; input.rows = 1;
        input.setAttribute('aria-label', '编辑任务内容');
        label.hidden = true; label.after(input);
        const resize = () => {
            input.style.height = '0px';
            const style = text.ownerDocument.defaultView.getComputedStyle(input);
            const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
            input.style.height = Math.max(originalHeight, input.scrollHeight + border) + 'px';
        };
        resize();
        this.bind(input, 'input', resize);
        let finished = false;
        const cancel = () => { if (finished) return; finished = true; input.remove(); label.hidden = false; label.focus(); };
        const save = () => {
            if (finished) return;
            const title = input.value.trim();
            if (!title) { input.setCustomValidity('请填写任务内容。'); input.reportValidity(); input.focus(); return; }
            const manager = this.current();
            if (!manager) { cancel(); return; }
            finished = true;
            updateCard(manager, id, item => {
                const info = cardInfo(item);
                if (info.title !== previousTitle) { new Notice('任务已在别处修改，请重新点击编辑。'); return item; }
                const suffix = item.data.titleRaw.slice(stripOwned(item.data.titleRaw).length);
                const updated = manager.updateItemContent(item, cardTitle(title, info.range, info.category) + suffix);
                return { ...updated, id: item.id, data: { ...updated.data, checked: item.data.checked, checkChar: item.data.checkChar } };
            });
            if (input.isConnected) { input.remove(); label.hidden = false; }
            this.refresh();
        };
        this.bind(input, 'keydown', event => {
            if (event.isComposing) return;
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); save(); }
            else if (event.key === 'Escape') { event.preventDefault(); cancel(); }
        });
        this.bind(input, 'blur', save);
        input.focus(); input.select();
    }
    showMenu(menu, anchor, dangerTitles = []) {
        // Use Obsidian's DOM menu so macOS native menus cannot omit icons.
        menu.setUseNativeMenu?.(false);
        this.closeMenu?.();
        const view = anchor.ownerDocument.defaultView;
        const cleanup = () => {
            view?.removeEventListener('scroll', onScroll, true);
            if (this.closeMenu === close) this.closeMenu = null;
        };
        const close = () => { cleanup(); menu.hide(); };
        const onScroll = event => {
            if (event.target === view || event.target?.contains?.(anchor)) close();
        };
        if (typeof menu.onHide === 'function') menu.onHide(cleanup);
        else {
            const hide = menu.hide.bind(menu);
            menu.hide = (...args) => { cleanup(); return hide(...args); };
        }
        this.closeMenu = close;
        view?.addEventListener('scroll', onScroll, true);
        const rect = anchor.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom });
        if (!dangerTitles.length) return;
        const doc = anchor.ownerDocument;
        doc.defaultView?.requestAnimationFrame(() => {
            const latest = [...doc.querySelectorAll('.menu')].at(-1);
            if (!latest) return;
            latest.classList.add('weekcraft-context-menu');
            latest.querySelectorAll('.menu-item').forEach(item => {
                const title = item.querySelector('.menu-item-title')?.textContent?.trim();
                if (dangerTitles.includes(title)) item.classList.add('weekcraft-menu-danger');
            });
        });
    }
    renderTag(parent, category, ids) {
        const tag = parent.createEl('button', { cls: category ? 'weekcraft-tag' : 'weekcraft-tag is-uncategorized', text: category || '+',
            attr: { 'aria-label': `切换类别 ${category || '未分类'}` } });
        tag.style.setProperty('--weekcraft-tag-color', categoryColor(category, this.plugin.settings));
        this.bind(tag, 'click', () => {
            const menu = new Menu();
            for (const name of this.plugin.settings.categories) menu.addItem(item => item.setTitle(name).setChecked(name === category).onClick(() => {
                changeCategory(this.current(), ids, name); this.refresh();
            }));
            menu.addItem(item => item.setTitle('无').setChecked(!category).onClick(() => { changeCategory(this.current(), ids, ''); this.refresh(); }));
            this.showMenu(menu, tag);
        });
    }
    moveMenu(id, anchor) {
        const { Menu } = require('obsidian');
        const menu = new Menu();
        for (const lane of this.current()?.state.children || []) {
            menu.addItem(item => item.setTitle(lane.data.title).onClick(() => this.move(id, lane.id)));
            for (const group of orderedTimeGroups(lane)) {
                menu.addItem(item => item.setTitle(`${lane.data.title} · ${group.range}`).onClick(() => this.move(id, lane.id, group)));
            }
        }
        this.showMenu(menu, anchor);
    }
    dropTarget(el, laneId, group = null, beforeId = null) {
        el.dataset.wcLane = laneId;
        el._weekcraftDrop = { laneId, group, beforeId };
        this.bind(el, 'dragover', event => {
            if (!this.dragged && !event.dataTransfer.types.includes('application/x-weekcraft-task')) return;
            event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
            this.clearDropTargets();
            const drop = this.adapter.resolveDrop(el, event.clientY);
            if (drop) drop.element.classList.add(drop.indicatorClass || 'weekcraft-drop-after');
        });
        this.bind(el, 'drop', event => {
            const id = this.dragged || event.dataTransfer.getData('application/x-weekcraft-task');
            if (!id) return;
            event.preventDefault(); event.stopPropagation();
            const drop = this.adapter.resolveDrop(el, event.clientY);
            if (drop) this.move(id, drop.laneId, drop.group, drop.beforeId);
            this.dragged = null;
        });
    }
    move(id, laneId, group = null, beforeId = null) {
        const manager = this.current(); if (!manager) return;
        this.root.dataset.wcMovingItem = id;
        try { moveCard(manager, id, laneId, group, beforeId); this.clearDropTargets(); this.refresh(); }
        finally { delete this.root.dataset.wcMovingItem; }
    }
    clearDropTargets() { this.adapter.clearDropTargets(); }
    touchDrag(grip, row, id) {
        this.bind(grip, 'pointerdown', event => {
            if (event.button !== 0 || this.adapter.transferBusy) return;
            this.adapter.activeDrag = { panel: this, id, path: this.view.file.path };
            this.touch = { id, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
            grip.setPointerCapture(event.pointerId);
        });
        this.bind(grip, 'pointermove', event => {
            if (!this.touch) return;
            if (Math.hypot(event.clientX - this.touch.startX, event.clientY - this.touch.startY) < 8) return;
            this.touch.moved = true;
            this.touch.lastX = event.clientX; this.touch.lastY = event.clientY;
            event.preventDefault();
            row.classList.add('is-dragging');
            this.clearDropTargets();
            const drop = this.adapter.resolveDrop(this.root.ownerDocument.elementFromPoint(event.clientX, event.clientY), event.clientY);
            if (drop) drop.element.classList.add(drop.indicatorClass || 'weekcraft-drop-after');
        });
        const finish = () => {
            if (!this.touch || this.touch.id !== id) return;
            const { moved, lastX, lastY } = this.touch; this.touch = null;
            const drag = this.adapter.activeDrag; this.adapter.activeDrag = null;
            row.classList.remove('is-dragging');
            if (!moved) return;
            const drop = this.adapter.resolveDrop(this.root.ownerDocument.elementFromPoint(lastX, lastY), lastY);
            if (drop) this.adapter.finishDrop(drag, drop);
            this.clearDropTargets();
            const suppress = event => { event.preventDefault(); event.stopImmediatePropagation(); };
            grip.addEventListener('click', suppress, { once: true, capture: true });
        };
        this.bind(grip, 'pointerup', finish);
        // Kanban also has document drag listeners. Finalize at the window capture
        // phase so those listeners cannot swallow the release of our own handle.
        const win = this.root.ownerDocument.defaultView;
        this.bind(win, 'pointerup', finish, true);
        this.bind(win, 'mouseup', finish, true);
        this.bind(grip, 'pointercancel', () => { this.touch = null; if (this.adapter.activeDrag?.panel === this) this.adapter.activeDrag = null; row.classList.remove('is-dragging'); this.clearDropTargets(); });
    }
    destroy() { this.closeMenu?.(); this.stopHoverHints?.(); this.component?.unload(); this.root.remove(); }
}
module.exports = { BoardPanel };
