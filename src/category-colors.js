const PALETTE = ['#4975c8', '#9361bd', '#31836b', '#bd7b27', '#bd5968', '#438c9f', '#79834b'];
const DEFAULT_COLORS = { 科研: PALETTE[0], 自媒体: PALETTE[1], 运动: PALETTE[2], 生活: PALETTE[3] };
function categoryColor(name, settings) {
    const custom = settings.categoryColors?.[name];
    if (/^#[0-9a-f]{6}$/i.test(custom || '')) return custom;
    if (DEFAULT_COLORS[name]) return DEFAULT_COLORS[name];
    let hash = 0; for (const char of name) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    return PALETTE[hash % PALETTE.length];
}
module.exports = { categoryColor, DEFAULT_COLORS };
