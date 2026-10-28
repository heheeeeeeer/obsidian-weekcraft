const { parseRange } = require("./tasks");
const { insertEntry } = require("./schedule-data");
const { suppressHoverHints } = require("./hover-hints");
function parseTimeRange(value) {
    try {
        const formatted = parseRange(value);
        if (!formatted) return null;
        const [start, endDisplay] = formatted.split("–");
        return { start, end: endDisplay.replace("次日 ", ""), endDisplay };
    } catch { return null; }
}
function renderSchedule(plugin, container, component, context, options = {}) {
// Render a small entry form; persist entries as ordinary Markdown in this note.
const notePath = context.sourcePath;
const targetDay = options?.day || null;
const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
if (targetDay && !weekDays.includes(targetDay)) throw new Error("无效的周记日期。");
let categories = [...plugin.settings.categories];
const doc = container.ownerDocument;
const win = doc.defaultView;
const root = container.createEl("div", { cls: "daily-schedule" });
component.register(suppressHoverHints(root));
const row = root.createEl("div", { cls: "daily-schedule-row" });
let daySelect = null;
if (options?.weekly) {
    daySelect = row.createEl("select", { cls: "daily-schedule-day", attr: { "aria-label": "选择周记日期" } });
    const dayPlaceholder = daySelect.createEl("option", { text: "日期", attr: { value: "" } });
    dayPlaceholder.hidden = true;
    dayPlaceholder.disabled = true;
    weekDays.forEach(day => daySelect.createEl("option", { text: day, attr: { value: day } }));
}
const timeRange = row.createEl("input", {
    cls: "daily-schedule-time",
    attr: { type: "text", placeholder: "12.30-18.30", "aria-label": "时间段", autocomplete: "off" }
});

let selectedCategory = "";
let categoryMenuOpen = false;
let categoryInputOpen = false;
const categoryGroup = row.createEl("div", {
    cls: "daily-schedule-categories", attr: { role: "group", "aria-label": "日程类别" }
});
const categoryTrigger = categoryGroup.createEl("button", {
    cls: "daily-schedule-category-trigger",
    attr: { type: "button", "aria-label": "选择日程类别", "aria-haspopup": "true", "aria-expanded": "false" }
});
const categoryLabel = categoryTrigger.createEl("span", { text: "类别" });
categoryTrigger.createEl("span", { cls: "daily-schedule-category-caret", text: "▾" });
const categoryMenu = categoryGroup.createEl("div", { cls: "daily-schedule-category-menu" });
categoryMenu.hidden = true;
doc.body.appendChild(categoryMenu);
component.register(() => categoryMenu.remove());
const categoryList = categoryMenu.createEl("div", { cls: "daily-schedule-category-list" });
const categoryComposer = categoryMenu.createEl("div", { cls: "daily-schedule-category-composer" });
const addCategorySpacer = categoryComposer.createEl("div", { cls: "daily-schedule-category-spacer" });
const addCategoryButton = categoryComposer.createEl("button", {
    cls: "daily-schedule-category-icon",
    text: "+",
    attr: { type: "button", "aria-label": "新增类别" }
});
const addCategoryRow = categoryComposer.createEl("div", { cls: "daily-schedule-category-input-row" });
addCategoryRow.hidden = true;
const customCategory = addCategoryRow.createEl("input", {
    cls: "daily-schedule-custom",
    attr: { type: "text", placeholder: "", "aria-label": "新类别名称", maxlength: "30" }
});
const confirmCategory = addCategoryRow.createEl("button", {
    cls: "daily-schedule-category-icon",
    text: "✓",
    attr: { type: "button", "aria-label": "保存类别" }
});
const cancelCategory = addCategoryRow.createEl("button", {
    cls: "daily-schedule-category-icon",
    text: "×",
    attr: { type: "button", "aria-label": "取消新增类别" }
});

function updateCategoryTrigger() {
    categoryLabel.textContent = selectedCategory || "类别";
    categoryTrigger.setAttribute("aria-expanded", String(categoryMenuOpen));
}
function positionCategoryMenu() {
    if (!categoryMenuOpen) return;
    const triggerRect = categoryTrigger.getBoundingClientRect();
    const menuRect = categoryMenu.getBoundingClientRect();
    const viewportWidth = win.innerWidth;
    const viewportHeight = win.innerHeight;
    const menuWidth = Math.max(menuRect.width, triggerRect.width, 116);
    const menuHeight = menuRect.height;
    let left = triggerRect.left;
    let top = triggerRect.bottom + 4;
    if (left + menuWidth > viewportWidth - 8) left = Math.max(8, viewportWidth - menuWidth - 8);
    if (top + menuHeight > viewportHeight - 8) top = Math.max(8, triggerRect.top - menuHeight - 4);
    categoryMenu.style.left = `${left}px`;
    categoryMenu.style.top = `${top}px`;
    categoryMenu.style.minWidth = `${Math.max(triggerRect.width, 116)}px`;
}
function syncCategoryComposer() {
    addCategorySpacer.hidden = categoryInputOpen;
    addCategoryButton.hidden = categoryInputOpen;
    addCategoryRow.hidden = !categoryInputOpen;
    if (categoryMenuOpen) win.requestAnimationFrame(positionCategoryMenu);
}
function closeCategoryMenu() {
    categoryMenuOpen = false;
    categoryInputOpen = false;
    categoryMenu.hidden = true;
    customCategory.value = "";
    syncCategoryComposer();
    updateCategoryTrigger();
}
async function openCategoryMenu() {
    // Each weekday has its own form; refresh the shared list before opening.
    try {
        categories = [...plugin.settings.categories];
        if (selectedCategory && !categories.includes(selectedCategory)) selectedCategory = "";
        renderCategories();
    } catch (error) {
        feedback.textContent = "类别读取失败，请重试。";
        return;
    }
    categoryMenuOpen = true;
    categoryMenu.hidden = false;
    updateCategoryTrigger();
    win.requestAnimationFrame(positionCategoryMenu);
}
function toggleCategoryMenu() {
    if (categoryMenuOpen) closeCategoryMenu();
    else openCategoryMenu();
}
function openCategoryInput() {
    categoryInputOpen = true;
    syncCategoryComposer();
    win.requestAnimationFrame(() => customCategory.focus());
}
function renderCategories() {
    categoryList.replaceChildren();
    for (const name of categories) {
        const item = categoryList.createEl("div", {
            cls: `daily-schedule-category-item${name === selectedCategory ? " is-selected" : ""}`
        });
        const selectButton = item.createEl("button", {
            cls: "daily-schedule-category-option",
            text: name,
            attr: { type: "button", "aria-pressed": String(name === selectedCategory) }
        });
        const deleteButton = item.createEl("button", {
            cls: "daily-schedule-category-delete",
            text: "×",
            attr: { type: "button", "aria-label": `删除类别 ${name}` }
        });
        component.registerDomEvent(selectButton, "click", () => {
            selectedCategory = name;
            feedback.textContent = "";
            renderCategories();
            closeCategoryMenu();
        });
        component.registerDomEvent(deleteButton, "click", async event => {
            event.preventDefault();
            event.stopPropagation();
            if (!name || !await changeCategories(list => list.filter(itemName => itemName !== name))) return;
            if (selectedCategory === name) selectedCategory = "";
            renderCategories();
            updateCategoryTrigger();
        });
    }
    syncCategoryComposer();
    if (categoryMenuOpen) win.requestAnimationFrame(positionCategoryMenu);
}
renderCategories();
updateCategoryTrigger();
component.registerDomEvent(categoryTrigger, "click", toggleCategoryMenu);
component.registerDomEvent(addCategoryButton, "click", openCategoryInput);
component.registerDomEvent(cancelCategory, "click", () => {
    categoryInputOpen = false;
    customCategory.value = "";
    syncCategoryComposer();
});
component.registerDomEvent(categoryGroup, "keydown", event => {
    if (event.key === "Escape") closeCategoryMenu();
});
component.registerDomEvent(categoryMenu, "keydown", event => {
    if (event.key === "Escape") closeCategoryMenu();
});
component.registerDomEvent(doc, "mousedown", event => {
    if (!categoryGroup.contains(event.target) && !categoryMenu.contains(event.target)) closeCategoryMenu();
});
component.registerDomEvent(win, "resize", positionCategoryMenu);
component.registerDomEvent(win, "scroll", positionCategoryMenu, true);

let editingCategories = false;
async function changeCategories(transform) {
    if (editingCategories) return false;
    editingCategories = true;
    categoryTrigger.disabled = addCategoryButton.disabled = customCategory.disabled = confirmCategory.disabled = cancelCategory.disabled = true;
    try {
        await plugin.changeCategories(transform);
        categories = [...plugin.settings.categories];
        feedback.textContent = "";
        return true;
    } catch (error) {
        feedback.textContent = "类别保存失败，请重试。";
        console.error("类别保存失败", error);
        return false;
    } finally {
        editingCategories = false;
        categoryTrigger.disabled = addCategoryButton.disabled = customCategory.disabled = confirmCategory.disabled = cancelCategory.disabled = false;
    }
}
async function saveCustomCategory() {
    const name = customCategory.value.normalize("NFKC").trim();
    if (!name) {
        return false;
    }
    if (/[\s#/]/u.test(name)) {
        feedback.textContent = "类别里不要包含空格、# 或 /。";
        customCategory.focus();
        return false;
    }
    if (!await changeCategories(list => list.includes(name) ? list : [...list, name])) return false;
    selectedCategory = name;
    customCategory.value = "";
    renderCategories();
    closeCategoryMenu();
    return true;
}
component.registerDomEvent(confirmCategory, "click", saveCustomCategory);
component.registerDomEvent(customCategory, "keydown", event => {
    if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        saveCustomCategory();
    }
});

const title = row.createEl("textarea", {
    cls: "daily-schedule-title",
    attr: { rows: "1", placeholder: "To-dos", "aria-label": "日程事项" }
});
function resizeTitle() {
    title.style.height = "34px";
    const height = title.scrollHeight + 2;
    title.style.height = `${Math.max(34, Math.min(height, 160))}px`;
    title.style.overflowY = height > 160 ? "auto" : "hidden";
}
component.registerDomEvent(title, "input", resizeTitle);
const add = row.createEl("button", { text: "添加", cls: "daily-schedule-add", attr: { type: "button" } });
const feedback = root.createEl("div", {
    cls: "daily-schedule-feedback", attr: { role: "status", "aria-live": "polite" }
});




component.registerDomEvent(timeRange, "blur", () => {
    const range = parseTimeRange(timeRange.value);
    if (range) timeRange.value = `${range.start}–${range.end}`;
});
component.registerDomEvent(timeRange, "keydown", event => {
    if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        const range = parseTimeRange(timeRange.value);
        if (range) {
            timeRange.value = `${range.start}–${range.end}`;
            title.focus();
        } else feedback.textContent = "时间格式：12.30-18.30";
    }
});

// Opening the template itself must never turn it into a daily log.
const isTemplate = plugin.isTemplate(notePath);
if (isTemplate) {
    add.disabled = true;
    feedback.textContent = "在新建的日记或周记里添加日程。";
}

let saving = false;
async function saveEntry() {
    if (saving || isTemplate) return;
    const destinationDay = daySelect ? daySelect.value : targetDay;
    if (daySelect && !weekDays.includes(destinationDay)) {
        feedback.textContent = "请选择要添加到哪一天。";
        daySelect.focus();
        return;
    }
    const range = parseTimeRange(timeRange.value);
    const tasks = title.value.split(/[;；\r\n]+/).map(task => task.trim()).filter(Boolean);
    if (!range) {
        feedback.textContent = "请输入时间段，例如 12.30-18.30。";
        timeRange.focus();
        return;
    }
    const { start, end } = range;
    if (start === end) {
        feedback.textContent = "开始和结束时间不能相同。";
        timeRange.focus();
        return;
    }
    const selected = selectedCategory;
    if (!selected) {
        feedback.textContent = "请先选择类别。";
        categoryTrigger.focus();
        return;
    }
    if (!tasks.length) {
        feedback.textContent = "请填写日程事项。";
        title.focus();
        return;
    }
    const file = plugin.app.vault.getAbstractFileByPath(notePath);
    if (!file || file.extension !== "md") {
        feedback.textContent = "没有找到当前日记，未保存。";
        return;
    }
    saving = true;
    add.disabled = true;
    try {
        const endDisplay = range.endDisplay;
        const entry = `- **${start}–${endDisplay}** #日程/${selected}\n\n`
            + tasks.map(task => `  - [ ] ${task}\n`).join("");
        await plugin.app.vault.process(file, content => insertEntry(content, entry, destinationDay));
        title.value = "";
        resizeTitle();
        selectedCategory = "";
        customCategory.value = "";
        closeCategoryMenu();
        updateCategoryTrigger();
        timeRange.value = "";
        feedback.textContent = "";
    } catch (error) {
        feedback.textContent = error.message?.startsWith("未找到 ") ? error.message : "保存失败，请重试；输入内容已保留。";
        console.error("日程保存失败", error);
    } finally {
        saving = false;
        add.disabled = false;
    }
}

component.registerDomEvent(add, "click", saveEntry);
component.registerDomEvent(title, "keydown", event => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing) {
        event.preventDefault();
        saveEntry();
    }
});

}
module.exports = { renderSchedule };
