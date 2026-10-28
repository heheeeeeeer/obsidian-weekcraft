const { Modal, setIcon } = require("obsidian");
const { parseRange, splitTasks } = require("./tasks");
const { cardInfo, cardTitle, updateCard } = require('./board-model');
const { stripOwned } = require('./timestamps');
const { suppressHoverHints } = require('./hover-hints');

const MINUTES_PER_DAY = 24 * 60;
const SNAP_MINUTES = 15;
const MIN_DURATION = 15;
const HOUR_HEIGHT = 56;
const VISIBLE_HOURS = 8;

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function snap(value) { return Math.round(value / SNAP_MINUTES) * SNAP_MINUTES; }
function formatClock(totalMinutes) {
    const minutes = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
function formatDuration(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (!hours) return `${minutes} 分钟`;
    if (!minutes) return `${hours} 小时`;
    return `${hours} 小时 ${minutes} 分钟`;
}
function rangeToMinutes(value) {
    if (!value) return null;
    const normalized = parseRange(value);
    const match = normalized.match(/^(\d{2}):(\d{2})–(?:(次日)\s+)?(\d{2}):(\d{2})$/);
    if (!match) throw new Error("时间格式：14.00-17.00");
    const start = Number(match[1]) * 60 + Number(match[2]);
    const end = Number(match[4]) * 60 + Number(match[5]) + (match[3] ? MINUTES_PER_DAY : 0);
    return { start, end, text: normalized, overnight: Boolean(match[3]) };
}
function minutesToRange(start, end) {
    const safeStart = clamp(Math.round(start), 0, MINUTES_PER_DAY);
    const safeEnd = clamp(Math.round(end), safeStart + MIN_DURATION, MINUTES_PER_DAY * 2);
    return `${formatClock(safeStart)}–${safeEnd >= MINUTES_PER_DAY ? '次日 ' : ''}${formatClock(safeEnd)}`;
}
function currentMinutes(now = new Date()) { return now.getHours() * 60 + now.getMinutes(); }

class TaskForm extends Modal {
    constructor(app, manager, laneId, categories, options = {}) {
        super(app);
        this.manager = manager;
        this.laneId = laneId;
        this.categories = categories;
        this.options = options;
        this.dragCleanup = null;
    }
    onOpen() {
        this.modalEl.classList.add("weekly-kanban-task-modal");
        const lane = this.manager.state.children.find(item => item.id === this.laneId);
        const isBacklog = this.manager.state.children[0]?.id === this.laneId;
        const showTime = !this.options.fixedRange && !isBacklog;
        const existing = lane.children.find(item => item.id === this.options.itemId);
        const initial = existing ? cardInfo(existing) : this.options;
        this.setTitle(`${this.options.itemId ? '编辑任务' : '添加日程'} · ${lane.data.title}`);
        const root = showTime ? this.contentEl.createDiv({ cls: 'wk-form-layout' }) : this.contentEl;
        const timelineBox = showTime ? root.createDiv({ cls: 'wk-time-panel' }) : null;
        const form = showTime ? root.createDiv({ cls: 'wk-form-panel' }) : root;
        const field = (parent, icon, cls) => {
            const box = parent.createDiv({ cls });
            const symbol = box.createDiv({ cls: 'wk-field-icon', attr: { 'aria-hidden': 'true' } });
            setIcon?.(symbol, icon);
            return box;
        };
        const timeBox = showTime ? field(form, 'clock', 'wk-input-box wk-time-input-box') : null;
        const time = timeBox ? timeBox.createEl("input", { attr: { type: "text", placeholder: "14.00-17.00", "aria-label": "时间段（可留空）" } }) : null;
        const categoryBox = field(form, 'tag', 'wk-input-box');
        const category = categoryBox.createEl("select", { attr: { "aria-label": "类别" } });
        const placeholder = category.createEl("option", { text: "类别", attr: { value: "" } });
        placeholder.hidden = true; placeholder.disabled = true;
        for (const name of this.categories) category.createEl("option", { text: name, attr: { value: name } });
        category.createEl("option", { text: "无", attr: { value: "__weekcraft_none__" } });
        const taskBox = field(form, 'list', 'wk-task-box');
        const tasks = taskBox.createEl("textarea", { attr: { rows: "2", placeholder: "To-dos", "aria-label": "具体工作" } });
        const hint = form.createDiv({ cls: "wk-form-hint", text: showTime
            ? "左侧点击可创建 1 小时时间块，拖动与右侧输入会实时同步。多个任务用分号或换行分隔"
            : this.options.fixedRange ? "多个任务用分号或换行分隔"
                : isBacklog ? "类别可留空 · 多个任务用分号或换行分隔"
                    : "时间与分类可留空 · 多个任务用分号或换行分隔" });
        const error = form.createDiv({ cls: "wk-form-error", attr: { role: "status" } });
        const buttons = form.createDiv({ cls: "wk-form-actions" });
        const cancel = buttons.createEl("button", { text: "取消" });
        const submit = buttons.createEl("button", { text: existing ? '保存' : "添加", cls: "mod-cta" });
        let saving = false;
        let rangeState = showTime ? (initial.range ? rangeToMinutes(initial.range) : null) : null;
        if (time) time.value = initial.range || '';
        category.value = initial.category || '';
        if (existing) tasks.value = initial.title;

        let timeline = null;
        if (showTime) {
            timeline = this.buildTimeline(timelineBox, {
                getRange: () => rangeState,
                setRange: next => {
                    rangeState = next;
                    time.value = next ? minutesToRange(next.start, next.end) : '';
                    error.textContent = '';
                },
                focusInput: () => time.focus(),
            });
            if (rangeState) timeline.scrollToRange(rangeState);
            else timeline.scrollToMinutes(currentMinutes());
            timeline.render();
        }

        const syncFromInput = strict => {
            if (!showTime) return true;
            const value = time.value.trim();
            if (!value) {
                rangeState = null;
                timeline.render();
                if (strict) error.textContent = '';
                return true;
            }
            try {
                rangeState = rangeToMinutes(value);
                if (strict) time.value = rangeState.text;
                error.textContent = '';
                timeline.render();
                timeline.scrollToRange(rangeState);
                return true;
            } catch (e) {
                if (strict) error.textContent = e.message;
                return false;
            }
        };

        const save = () => {
            if (saving) return;
            try {
                if (showTime && !syncFromInput(true)) throw new Error(error.textContent || "时间格式：14.00-17.00");
                const range = this.options.fixedRange ? parseRange(this.options.range)
                    : showTime ? (rangeState ? minutesToRange(rangeState.start, rangeState.end) : null)
                        : null;
                const selected = category.value === '__weekcraft_none__' ? '' : category.value;
                const titles = splitTasks(tasks.value);
                if (!titles.length) { tasks.focus(); throw new Error("请填写具体工作。"); }
                if (!this.manager.state.children.some(item => item.id === this.laneId)) throw new Error("这个日期栏目已不存在。");
                saving = true;
                const items = titles.map(title => this.manager.getNewItem(cardTitle(title, range, selected), " "));
                if (existing) {
                    if (titles.length !== 1) throw new Error('编辑时请保留一个任务；多个任务请使用添加日程。');
                    updateCard(this.manager, existing.id, item => {
                        const suffix = item.data.titleRaw.slice(stripOwned(item.data.titleRaw).length);
                        const updated = this.manager.updateItemContent(item, cardTitle(titles[0], range, selected) + suffix);
                        return { ...updated, id: item.id, data: { ...updated.data, checked: item.data.checked, checkChar: item.data.checkChar } };
                    });
                } else this.manager.setState(board => ({
                    ...board,
                    children: board.children.map(currentLane => {
                        if (currentLane.id !== this.laneId) return currentLane;
                        const isBacklogLane = board.children[0]?.id === this.laneId;
                        const children = !isBacklogLane && !range
                            ? [...items, ...currentLane.children]
                            : [...currentLane.children, ...items];
                        return { ...currentLane, children };
                    })
                }));
                this.close();
            } catch (e) { error.textContent = e.message; saving = false; }
        };
        cancel.addEventListener("click", () => this.close());
        submit.addEventListener("click", save);
        time?.addEventListener("input", () => syncFromInput(false));
        time?.addEventListener("blur", () => syncFromInput(true));
        tasks.addEventListener("keydown", event => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing) { event.preventDefault(); save(); }
        });
        this.stopHoverHints = suppressHoverHints(this.modalEl);
        const focusTarget = (existing || this.options.fixedRange) ? tasks : (isBacklog ? category : time);
        focusTarget?.focus();
    }
    buildTimeline(parent, callbacks) {
        const viewport = parent.createDiv({ cls: 'wk-time-scroll' });
        const content = viewport.createDiv({ cls: 'wk-time-grid' });
        content.style.setProperty('--wk-day-height', `${24 * HOUR_HEIGHT}px`);
        for (let hour = 0; hour <= 24; hour++) {
            const row = content.createDiv({ cls: 'wk-time-row' });
            row.style.top = `${hour * HOUR_HEIGHT}px`;
            row.createDiv({ cls: 'wk-time-label', text: `${String(hour).padStart(2, '0')}:00` });
            row.createDiv({ cls: 'wk-time-line' });
        }
        const nowLine = content.createDiv({ cls: 'wk-time-now', attr: { 'aria-hidden': 'true' } });
        nowLine.style.top = `${currentMinutes() / 60 * HOUR_HEIGHT}px`;
        const selection = content.createDiv({ cls: 'wk-time-selection', attr: { hidden: 'hidden' } });
        const topHandle = selection.createDiv({ cls: 'wk-time-handle is-start', text: '=' });
        const summary = selection.createDiv({ cls: 'wk-time-summary' });
        const rangeLabel = summary.createDiv({ cls: 'wk-time-range' });
        const durationLabel = summary.createDiv({ cls: 'wk-time-duration' });
        const bottomHandle = selection.createDiv({ cls: 'wk-time-handle is-end', text: '=' });
        let selected = Boolean(callbacks.getRange());
        const pointerRange = event => {
            const rect = content.getBoundingClientRect();
            // The content rect already includes scroll displacement. Use its rendered
            // height for the same coordinate system under zoom/scaling as well.
            return clamp((event.clientY - rect.top) / rect.height * MINUTES_PER_DAY, 0, MINUTES_PER_DAY);
        };
        const visibleHeight = VISIBLE_HOURS * HOUR_HEIGHT;
        viewport.style.height = `${visibleHeight}px`;
        const scrollToMinutes = minutes => {
            viewport.scrollTop = clamp(minutes / 60 * HOUR_HEIGHT - visibleHeight / 2, 0, 24 * HOUR_HEIGHT - visibleHeight);
        };
        const scrollToRange = range => scrollToMinutes((range.start + Math.min(range.end, MINUTES_PER_DAY)) / 2);
        const render = () => {
            const range = callbacks.getRange();
            if (!range) { selection.hidden = true; return; }
            selection.hidden = false;
            selected = true;
            selection.classList.toggle('is-selected', selected);
            const visibleEnd = Math.min(range.end, MINUTES_PER_DAY);
            const top = range.start / 60 * HOUR_HEIGHT;
            const height = Math.max((visibleEnd - range.start) / 60 * HOUR_HEIGHT, MIN_DURATION / 60 * HOUR_HEIGHT);
            selection.style.top = `${top}px`;
            selection.style.height = `${height}px`;
            rangeLabel.setText?.(minutesToRange(range.start, range.end));
            if (!rangeLabel.setText) rangeLabel.textContent = minutesToRange(range.start, range.end);
            durationLabel.setText?.(formatDuration(range.end - range.start));
            if (!durationLabel.setText) durationLabel.textContent = formatDuration(range.end - range.start);
            selection.classList.toggle('is-overnight', range.end > MINUTES_PER_DAY);
        };
        const updateRange = next => {
            callbacks.setRange(next);
            selected = Boolean(next);
            render();
        };
        const trackPointer = (initialEvent, move, finish) => {
            this.dragCleanup?.();
            const view = parent.ownerDocument?.defaultView || window;
            let lastEvent = initialEvent;
            const track = event => { lastEvent = event; move(event); };
            const scroll = () => move(lastEvent);
            const cleanup = () => {
                view.removeEventListener('mousemove', track, true);
                view.removeEventListener('mouseup', up, true);
                view.removeEventListener('scroll', scroll, true);
                view.removeEventListener('blur', cleanup, true);
                if (this.dragCleanup === cleanup) this.dragCleanup = null;
            };
            const up = event => {
                if (event.clientY !== undefined && event.clientY !== lastEvent.clientY) track(event);
                cleanup(); finish?.();
            };
            this.dragCleanup = cleanup;
            view.addEventListener('mousemove', track, true);
            view.addEventListener('mouseup', up, true);
            // Re-evaluate the last pointer against the current rect if the user
            // scrolls the axis or an ancestor while holding the mouse button.
            view.addEventListener('scroll', scroll, true);
            view.addEventListener('blur', cleanup, true);
        };
        const startDrag = (event, mode) => {
            if (event.button !== 0) return;
            event.preventDefault();
            const initial = callbacks.getRange();
            if (!initial) return;
            selected = true;
            const anchor = pointerRange(event);
            const original = { ...initial };
            // Preserve where within a handle/body the user grabbed it, so the
            // first movement does not jump to the opposite side of the handle.
            const edgeOffset = anchor - (mode === 'start' ? original.start : original.end);
            let moved = false;
            trackPointer(event, nextEvent => {
                const point = pointerRange(nextEvent);
                let next = { ...original };
                if (mode === 'move') {
                    const duration = original.end - original.start;
                    const start = clamp(snap(original.start + point - anchor), 0, Math.max(0, MINUTES_PER_DAY - duration));
                    next = { start, end: start + duration };
                } else if (mode === 'start') {
                    next.start = clamp(snap(point - edgeOffset), 0, original.end - MIN_DURATION);
                } else if (mode === 'end') {
                    next.end = clamp(snap(point - edgeOffset), original.start + MIN_DURATION, MINUTES_PER_DAY);
                }
                moved = moved || next.start !== original.start || next.end !== original.end;
                updateRange(next);
            }, () => { if (mode === 'move' && moved) callbacks.focusInput?.(); });
        };
        content.addEventListener('mousedown', event => {
            if (event.button !== 0 || event.target === selection || selection.contains(event.target)) return;
            event.preventDefault();
            const anchor = pointerRange(event);
            const start = snap(anchor);
            let moved = false;
            const createRange = point => {
                let next;
                if (moved) {
                    const endPoint = snap(point);
                    const from = clamp(Math.min(start, endPoint), 0, MINUTES_PER_DAY - MIN_DURATION);
                    next = { start: from, end: clamp(Math.max(start, endPoint), from + MIN_DURATION, MINUTES_PER_DAY) };
                } else {
                    const from = clamp(start, 0, MINUTES_PER_DAY - MIN_DURATION);
                    next = { start: from, end: Math.min(from + 60, MINUTES_PER_DAY) };
                }
                updateRange(next);
            };
            trackPointer(event, nextEvent => {
                const point = pointerRange(nextEvent);
                if (Math.abs(point - anchor) >= 6) moved = true;
                if (moved) createRange(point);
            }, () => {
                if (!moved) createRange(anchor);
                callbacks.focusInput?.();
            });
        });
        selection.addEventListener('mousedown', event => {
            const target = event.target;
            selected = true;
            render();
            if (target === topHandle) return startDrag(event, 'start');
            if (target === bottomHandle) return startDrag(event, 'end');
            startDrag(event, 'move');
        });
        return { render, scrollToMinutes, scrollToRange };
    }
    onClose() {
        this.stopHoverHints?.();
        this.dragCleanup?.();
        this.contentEl.empty();
    }
}

module.exports = { TaskForm, rangeToMinutes, minutesToRange };
