const { PluginSettingTab, Setting, normalizePath } = require('obsidian');
const { renderCategorySettings } = require('./category-settings');
const { suppressHoverHints } = require('./hover-hints');

const DEFAULT_SETTINGS = {
    categories: ['科研', '自媒体', '运动', '生活'],
    templateFolder: '',
    autoOpenNewBoards: true,
    enhanceTaskForm: true,
    completionTimestamps: true,
    completedTaskStrikethrough: true,
    showTaskNumbers: false,
    automaticTimestamps: true,
    timestampFormat: 'HH:mm',
    timestampPrefix: '✅',
    groupedLayout: true,
    timeZone: '',
    laneWidth: 680,
    automaticCategorySorting: true,
    categoryColors: {},
    hiddenLanes: {},
};

function validateCategories(values) {
    const names = [...new Set(values.map(value => value.normalize('NFKC').trim()).filter(Boolean))];
    if (names.some(name => name.length > 30 || /[\s#/]/u.test(name))) {
        throw new Error('类别最多 30 个字符，不要包含空格、# 或 /。');
    }
    return names;
}

function normalizeSettings(saved = {}) {
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
    const result = { ...DEFAULT_SETTINGS, ...saved };
    try { result.categories = validateCategories(saved.categories ?? DEFAULT_SETTINGS.categories); }
    catch { result.categories = [...DEFAULT_SETTINGS.categories]; }
    result.laneWidth = Number(result.laneWidth);
    if (!Number.isFinite(result.laneWidth) || result.laneWidth < 240 || result.laneWidth > 1600) result.laneWidth = 680;
    for (const key of ['autoOpenNewBoards', 'enhanceTaskForm', 'completedTaskStrikethrough', 'showTaskNumbers', 'completionTimestamps', 'automaticTimestamps', 'groupedLayout', 'automaticCategorySorting']) {
        if (typeof result[key] !== 'boolean') result[key] = DEFAULT_SETTINGS[key];
    }
    if (typeof result.templateFolder !== 'string') result.templateFolder = '';
    result.templateFolder = result.templateFolder ? normalizePath(result.templateFolder) : '';
    if (!['HH:mm', 'YYYY-MM-DD HH:mm', 'YYYY-MM-DD', 'YYYY年MM月DD日 HH:mm'].includes(result.timestampFormat)) result.timestampFormat = 'HH:mm';
    if (typeof result.timestampPrefix !== 'string' || /[\r\n<>]/.test(result.timestampPrefix)) result.timestampPrefix = '✅';
    try { new Intl.DateTimeFormat('en', result.timeZone ? { timeZone: result.timeZone } : {}).format(); }
    catch { result.timeZone = ''; }
    result.categoryColors = Object.fromEntries(Object.entries(saved.categoryColors && typeof saved.categoryColors === 'object' ? saved.categoryColors : {}).filter(([name, color]) => typeof name === 'string' && /^#[0-9a-f]{6}$/i.test(color)));
    result.hiddenLanes = Object.fromEntries(Object.entries(saved.hiddenLanes && typeof saved.hiddenLanes === 'object' ? saved.hiddenLanes : {}).filter(([path, titles]) => typeof path === 'string' && Array.isArray(titles)).map(([path, titles]) => [path, titles.filter(title => typeof title === 'string')]));
    return result;
}

class ScheduleSettingsTab extends PluginSettingTab {
    constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
    hide() { this.stopCategorySettings?.(); this.stopHoverHints?.(); }
    display() {
        const { containerEl: el, plugin } = this;
        this.stopHoverHints?.();
        this.stopCategorySettings?.();
        el.empty();
        // Sample an ordinary setting before applying our grouped layout.
        const probe = new Setting(el);
        const nativeBackground = el.ownerDocument.defaultView.getComputedStyle(probe.settingEl).backgroundColor;
        probe.settingEl.remove();
        const page = el.createDiv({ cls: 'weekcraft-settings' });
        if (nativeBackground && nativeBackground !== 'transparent' && nativeBackground !== 'rgba(0, 0, 0, 0)') {
            page.style.setProperty('--weekcraft-settings-background', nativeBackground);
        }
        this.stopHoverHints = suppressHoverHints(page);
        const section = name => {
            const group = page.createEl('section', { cls: 'weekcraft-settings-section' });
            group.createEl('h3', { text: name });
            return group.createDiv({ cls: 'weekcraft-settings-card' });
        };
        const categories = section('类别与标签');
        const board = section('看板');
        const completion = section('完成时间');
        const templates = section('模板');
        this.stopCategorySettings = renderCategorySettings(categories, plugin);
        new Setting(templates).setName('模板文件夹').setDesc('此文件夹里的日程表单禁止写入，避免把模板变成日记。')
            .addText(control => control.setValue(plugin.settings.templateFolder).onChange(value => plugin.updateSetting('templateFolder', value.replace(/^\/+|\/+$/g, ''))));
        for (const [key, name] of [['autoOpenNewBoards', '新建周记后自动进入看板'], ['enhanceTaskForm', '看板任务表单'], ['groupedLayout', '按时间分组的看板布局'], ['automaticTimestamps', '日记、周记及普通任务的完成时间'], ['completionTimestamps', '看板完成时间记录']]) {
            new Setting(['autoOpenNewBoards', 'enhanceTaskForm', 'groupedLayout'].includes(key) ? board : completion).setName(name).addToggle(control => control.setValue(plugin.settings[key]).onChange(value => plugin.updateSetting(key, value)));
        }
        new Setting(board).setName('显示任务序号').setDesc('显示当天任务的当前位置，拖动排序后自动重新编号。')
            .addToggle(control => control.setValue(plugin.settings.showTaskNumbers).onChange(value => plugin.updateSetting('showTaskNumbers', value)));
        new Setting(board).setName('已完成任务显示划线').setDesc('关闭后，已完成任务只变灰，不显示划线。')
            .addToggle(control => control.setValue(plugin.settings.completedTaskStrikethrough).onChange(value => plugin.updateSetting('completedTaskStrikethrough', value)));
        new Setting(completion).setName('完成时间格式').addDropdown(control => control
            .addOption('YYYY年MM月DD日 HH:mm', '2026年10月27日 15:00')
            .addOption('HH:mm', '15:00').addOption('YYYY-MM-DD HH:mm', '2026-10-27 15:00').addOption('YYYY-MM-DD', '2026-10-27')
            .setValue(plugin.settings.timestampFormat).onChange(value => plugin.updateSetting('timestampFormat', value)));
        new Setting(completion).setName('完成时间前缀').setDesc('默认 ✅；留空只显示时间。')
            .addText(control => control.setValue(plugin.settings.timestampPrefix).onChange(value => plugin.updateSetting('timestampPrefix', value)));
        new Setting(completion).setName('完成时间时区').setDesc('留空使用设备时区；可填写 Asia/Shanghai 等时区名称。')
            .addText(control => control.setValue(plugin.settings.timeZone).onChange(async value => {
                try {
                    new Intl.DateTimeFormat('en', value.trim() ? { timeZone: value.trim() } : {}).format();
                    await plugin.updateSetting('timeZone', value.trim()); control.inputEl.setCustomValidity('');
                } catch { control.inputEl.setCustomValidity('请输入有效的时区名称。'); control.inputEl.reportValidity(); }
            }));
        new Setting(board).setName('看板列宽').setDesc('240–1600 像素。')
            .addText(control => control.setValue(String(plugin.settings.laneWidth)).onChange(value => {
                const width = Number(value);
                if (Number.isFinite(width) && width >= 240 && width <= 1600) return plugin.updateSetting('laneWidth', width);
            }));
    }
}
module.exports = { DEFAULT_SETTINGS, normalizeSettings, validateCategories, ScheduleSettingsTab };
