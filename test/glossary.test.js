import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TERMS, glossSegments } from '../lib/glossary.js';

// Only the glossed terms, as "English=中文".
const glosses = (text, opts) => glossSegments(text, opts).filter((s) => s.zh).map((s) => `${s.text}=${s.zh}`);
const joined = (text, opts) => glossSegments(text, opts).map((s) => s.text).join('');

test('the English stays exactly as it was', () => {
  for (const text of [
    'FT MSc/MBA - Management - Autumn 2026 Term (Lecture A)',
    'Individual Assignment Draft',
    '  Weekly   Quiz 3  ',
    'Academic Reading & Writing',
    'MGTG200520261001FTC',
    '课程资料 Quiz',
    '',
    'a',
  ]) {
    assert.equal(joined(text), text, text);
    assert.equal(joined(text, { course: true }), text, text);
  }
  assert.deepEqual(glossSegments(''), [{ text: '' }]);
  assert.deepEqual(glossSegments(null), [{ text: '' }]);
  assert.deepEqual(glossSegments(undefined), [{ text: '' }]);
  assert.deepEqual(glossSegments(42), [{ text: '42' }]);
  assert.deepEqual(glossSegments('Hello there'), [{ text: 'Hello there' }], 'no match: unchanged');
});

test('longest match first', () => {
  assert.deepEqual(glosses('FT MSBA - Data Storytelling for Business'), ['FT=全日制', 'Data Storytelling=数据叙事']);
  assert.deepEqual(glosses('Individual Assignment Draft'), ['Individual Assignment=个人作业', 'Draft=草稿']);
  assert.deepEqual(glosses('Assignment brief updated'), ['Assignment brief=作业说明']);
  assert.deepEqual(glosses('Data Collection Methods'), ['Data Collection Methods=数据收集方法']);
  assert.deepEqual(glosses('Supply Chain Management'), ['Supply Chain Management=供应链管理']);
  assert.deepEqual(glosses('Final Essay'), ['Final Essay=期末论文']);
});

test('whole words only, any case', () => {
  assert.deepEqual(glosses('weekly QUIZ 3'), ['weekly=每周', 'QUIZ=小测']);
  assert.deepEqual(glosses('Quizzical Managements Testing'), [], 'no part-words');
  assert.deepEqual(glosses('Week 8 Quiz'), ['Week=周', 'Quiz=小测']);
  assert.deepEqual(glosses('Re-sit Exam'), ['Re-sit=补考', 'Exam=考试']);
  assert.deepEqual(glosses('Group Project'), ['Group Project=小组项目'], 'any space between words');
});

test('the owner\'s course terms', () => {
  assert.deepEqual(glosses('Getting to know you'), ['Getting to know you=认识你']);
  assert.deepEqual(glosses('Online Lesson 4 Practice Questions'), ['Online Lesson=网课', 'Practice Questions=练习题']);
  assert.deepEqual(glosses('FT MSc/MBA - Management - Autumn 2026 Term (Lecture B)', { course: true }), ['Management=管理学', 'Lecture=大课']);
  // Not added until the owner confirms what they stand for at the school.
  assert.deepEqual(glosses('DBA DIBA'), []);
});

test('course names: no FT / PT / Term, which every course has', () => {
  const name = 'PT MSBA - Descriptive Analytics - Group A B - Autumn 2026 Term';
  assert.deepEqual(glosses(name, { course: true }), ['Descriptive Analytics=描述性分析']);
  assert.deepEqual(glosses('FT MBA - Finance - Spring 2027 Semester', { course: true }), ['Finance=金融']);
  // In assignment and announcement titles they are glossed.
  assert.deepEqual(glosses('Term 2 timetable'), ['Term=学期', 'timetable=课表']);
});

test('never inside codes, group letters or names', () => {
  assert.deepEqual(glosses('MGTG200520261001FTC'), []);
  assert.deepEqual(glosses('Group T U V W X'), []);
  assert.deepEqual(glosses('Dr Ada Lee'), []);
  assert.deepEqual(glosses('CW1'), [], 'a letter or digit right after is part of a code');
  assert.deepEqual(glosses('FT2026'), []);
  // No single-letter terms in the list.
  assert.ok(Object.keys(TERMS).every((t) => t.replace(/\W/g, '').length > 1));
});

test('each term once per text', () => {
  assert.deepEqual(glosses('Quiz 1 and Quiz 2'), ['Quiz=小测']);
  assert.equal(joined('Quiz 1 and Quiz 2'), 'Quiz 1 and Quiz 2');
  assert.deepEqual(glosses('quiz then Quiz'), ['quiz=小测'], 'case does not make it a new term');
});

test('the list: short Chinese glosses, no duplicates', () => {
  const keys = Object.keys(TERMS).map((t) => t.toLowerCase());
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.length >= 120, `${keys.length} terms`);
  for (const [en, zh] of Object.entries(TERMS)) {
    assert.match(zh, /^[一-鿿]{1,8}$/, en);
    assert.equal(en.trim(), en);
  }
});
