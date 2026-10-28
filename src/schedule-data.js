function insertEntry(content, entry, day = null) {
    if (!day) return content.trimEnd() + "\n\n" + entry;
    const lines = content.split(/\r?\n/);
    let sectionStart = -1;
    let sectionEnd = lines.length;
    let headingLevel = 0;
    let fence = null;
    for (let index = 0; index < lines.length; index++) {
        const fenceMatch = lines[index].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
        if (fenceMatch) {
            const marker = fenceMatch[1];
            if (!fence) fence = { char: marker[0], length: marker.length };
            else if (marker[0] === fence.char && marker.length >= fence.length && !fenceMatch[2].trim()) fence = null;
            continue;
        }
        if (fence) continue;
        const heading = lines[index].match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
        if (!heading) continue;
        if (sectionStart < 0) {
            if (heading[1].length >= 2 && heading[1].length <= 4 && heading[2].endsWith(" " + day)) { sectionStart = index; headingLevel = heading[1].length; }
        } else if (heading[1].length <= headingLevel) {
            sectionEnd = index;
            break;
        }
    }
    if (sectionStart < 0) throw new Error(`未找到 ${day} 的日期标题，未添加。`);
    const before = lines.slice(0, sectionEnd).join("\n").trimEnd();
    const after = lines.slice(sectionEnd).join("\n");
    return before + "\n\n" + entry.trimEnd() + "\n\n" + after;
}

module.exports = { insertEntry };
