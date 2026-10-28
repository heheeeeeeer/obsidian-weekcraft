const { test } = require('node:test');
const assert = require('node:assert/strict');
const { changedTasks, applyTaskChanges, stripOwned, setTimestamp } = require('../src/timestamps');
const settings = { timeZone: 'Asia/Shanghai', timestampFormat: 'HH:mm', timestampPrefix: '✅' };
const now = new Date('2026-10-11T01:28:00Z');
const apply = (old, next, time = now) => applyTaskChanges(next, changedTasks(old, next, settings, time));

test('task timestamps persist, undo cleanly and record a fresh time on repeated completion', () => {
    const original = '- [ ] 整理参考图 #科研 [[论文]]';
    const completed = apply(original, original.replace('[ ]', '[x]'));
    assert.match(completed, /✅ 09:28 <!-- dayflow:stamp:/);
    assert.equal(apply(completed, completed.replace('[x]', '[ ]')), original);
    const redone = apply(original, original.replace('[ ]', '[x]'), new Date('2026-10-11T02:35:00Z'));
    assert.match(redone, /✅ 10:35/);
    assert.equal((redone.match(/✅/g) || []).length, 1);
    assert.equal(apply(redone, redone), redone);
    assert.equal(apply(completed, completed.replace('整理', '重新整理')), completed.replace('整理', '重新整理'));
});

test('fenced examples and unrelated content stay unchanged; nested tasks and alternate lists work', () => {
    const old = '---\nnote: example\n---\n```md\n- [ ] sample\n```\n- [ ] Parent\n  + [ ] Child on 2026-10-10\n> 1. [ ] quoted task ✅ 09:28 is an example\n- [ ] Other';
    const next = old.replace('- [ ] sample', '- [x] sample').replace('+ [ ] Child', '+ [X] Child').replace('1. [ ] quoted', '1. [x] quoted');
    const result = apply(old, next);
    assert.equal(changedTasks(old, next, settings, now).length, 2);
    assert.ok(result.includes('- [x] sample\n```'));
    assert.ok(result.includes('2026-10-10 ✅ 09:28'));
    assert.ok(result.includes('is an example ✅ 09:28'));
    assert.ok(result.endsWith('- [ ] Other'));
});

test('never deletes an unowned date or extends preexisting duplicate timestamps', () => {
    const unowned = '- [x] Task ✅ 09:20 ✅ 09:22';
    assert.equal(apply(unowned, unowned.replace('[x]', '[ ]')), unowned.replace('[x]', '[ ]'));
    const unchecked = unowned.replace('[x]', '[ ]');
    assert.equal(apply(unchecked, unowned), unowned);
    assert.equal(setTimestamp('Task <!-- dayflow:stamp:%ZZ -->', true, settings, now), 'Task <!-- dayflow:stamp:%ZZ -->');
    const stamp = setTimestamp('Task', true, { ...settings, timestampPrefix: '', timestampFormat: 'YYYY-MM-DD' }, now);
    assert.match(stamp, /Task 2026-10-11 <!--/);
    assert.equal(stripOwned(stamp), 'Task');
    const owned = setTimestamp('Task', true, settings, now);
    const marker = owned.match(/ <!-- dayflow:stamp:[^<>]+ -->/)[0];
    assert.equal(stripOwned(`Task${marker} ✅ 09:28`), 'Task');
    assert.equal(stripOwned(`Task${marker}`), 'Task');
});

test('line insertion and unique task moves remain matched; ambiguous duplicates are skipped', () => {
    assert.match(apply('- [ ] Task\n- [ ] Other', 'Intro\n- [ ] Other\n- [x] Task'), /Task ✅ 09:28/);
    assert.equal(changedTasks('- [ ] Same\n- [ ] Same', '- [x] Same\n- [ ] Same', settings, now).length, 1);
    assert.equal(changedTasks('- [ ] Same\n- [ ] Same', 'Intro\n- [x] Same\n- [ ] Same', settings, now).length, 0);
    assert.equal(changedTasks('- [ ] A', '- [x] Renamed', settings, now).length, 0);
});

test('rapid toggles on multiple tasks never stack suffixes or change other tasks', () => {
    let content = '- [ ] A\n  - [ ] B\n- [ ] C';
    for (let i = 0; i < 40; i++) {
        const lines = content.split('\n');
        const index = i % 2;
        lines[index] = lines[index].replace(/\[([ x])\]/, (_, state) => state === ' ' ? '[x]' : '[ ]');
        content = apply(content, lines.join('\n'), new Date(now.getTime() + i * 60000));
        for (const line of content.split('\n')) assert.ok((line.match(/dayflow:stamp:/g) || []).length <= 1);
        assert.ok(content.endsWith('- [ ] C'));
    }
    assert.equal(content, '- [ ] A\n  - [ ] B\n- [ ] C');
});


test('Chinese completion dates render, remain editable and reject impossible dates', () => {
    const { timeLabel, completionDetails, normalizeCompletionValue, replaceCompletionValue } = require('../src/timestamps');
    const config = { ...settings, timestampFormat: 'YYYY年MM月DD日 HH:mm' };
    const instant = new Date('2026-10-27T07:00:00Z');
    assert.equal(timeLabel(config, instant), '✅ 2026年10月27日 15:00');
    const body = setTimestamp('Task', true, config, instant);
    assert.equal(completionDetails(body).format, config.timestampFormat);
    assert.equal(completionDetails(replaceCompletionValue(body, '2026年10月28日 16:30')).value, '2026年10月28日 16:30');
    assert.throws(() => normalizeCompletionValue('2026年02月30日 15:00', config.timestampFormat));
    assert.equal(setTimestamp(body, false, config), 'Task');
});
