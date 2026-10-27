// 💡 帮助 (title card and footer) first asks which help: 完整教程 (the
// spotlight tour again), 卡片教程 (the frosted cards) or 常见问题. Replaying
// saves nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFaq } from '../lib/faq.js';
import { GUIDE_PAGES, TOUR_STEPS } from '../public/guide.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const html = read('../public/index.html');
const css = read('../public/style.css');
const help = read('../public/help.js');

test('the choice box: same glass as the welcome box, three choices in order, the note under them', () => {
  const at = html.indexOf('<div id="helpChoice"');
  assert.ok(at > html.indexOf('</footer>'), 'a dialog at the end of the page, like the others');
  const box = html.slice(at, html.indexOf('<div id="demoNote"', at));
  assert.match(box, /^<div id="helpChoice" class="guide-scrim" hidden>/);
  assert.match(box, /<div id="helpChoiceBox" class="welcome help-choice" role="dialog" aria-modal="true" aria-labelledby="helpChoiceTitle">/);
  const choices = [...box.matchAll(/<button id="(\w+)" type="button" aria-label="([^"]+)"[^>]*><b>([^<]+)<\/b><span>([^<]+)<\/span><\/button>/g)]
    .map(([, id, label, title, sub]) => ({ id, label, title, sub }));
  assert.deepEqual(choices.map((c) => c.id), ['helpTour', 'helpCards', 'helpFaq']);
  assert.deepEqual(choices.map((c) => c.title), ['完整教程', '卡片教程', '常见问题']);
  assert.equal(choices[0].label, '完整教程：跟着页面一步步走');
  assert.equal(choices[1].label, '卡片教程：几张卡片快速看');
  // A screen reader hears the same words as on the button.
  for (const c of choices) assert.equal(c.label, `${c.title}：${c.sub}`);
  assert.match(box, /<p class="welcome-note">完整教程大约 2 分钟，会把折叠的区临时展开，看完恢复原样。<\/p>/);
  assert.doesNotMatch(box, /[!！]|alert/, 'calm');
  // The old card above the footer and the footer replay link are gone.
  assert.doesNotMatch(html, /id="relearn|guideFooter|再看一遍新手引导/);
});

test('💡 帮助 and the footer 帮助 open the box; 常见问题 still goes straight to the FAQ', () => {
  assert.match(html, /<button id="helpBtn" type="button" aria-haspopup="dialog">💡 帮助<\/button>/);
  assert.match(help, /for \(const id of \['helpBtn', 'helpFooter'\]\) \$\(id\)\.addEventListener\('click', openHelpChoice\);/);
  assert.match(help, /\$\('helpTour'\)\.addEventListener\('click', \(\) => choose\('tour'\)\);/);
  assert.match(help, /\$\('helpCards'\)\.addEventListener\('click', \(\) => choose\('cards'\)\);/);
  assert.match(help, /\$\('helpFaq'\)\.addEventListener\('click', \(\) => choose\('faq'\)\);/);
  assert.match(help, /for \(const id of \['faqBtn', 'faqFooter'\]\) \$\(id\)\.addEventListener\('click', \(\) => openGuide\(helpAction\('faq', GUIDE_PAGES\)\.page\)\)/);
});

test('完整教程 is the first-start tour for the sign-in state; nothing is saved by any choice', () => {
  const choose = help.match(/function choose\(choice\) \{\n([\s\S]*?)\n\}/)[1];
  assert.match(choose, /if \(choice === 'tour'\) walkAgain\(true, \(\) => backInView\(from\)\);/);
  const walk = help.match(/function walkAgain\(.*\) \{\n([\s\S]*?)\n\}/)[1];
  // All of TOUR_STEPS (with the black-window card); spotlight.js leaves out the steps for the other sign-in state.
  assert.match(walk, /startTour\(withCard \? TOUR_STEPS : TOUR_STEPS\.filter\(\(s\) => !s\.mustSee\), \{ signedIn: isSignedIn, onEnd \}\)/);
  assert.ok(TOUR_STEPS.some((s) => s.when === 'signedIn') && TOUR_STEPS.some((s) => s.when === 'signedOut'));
  // guideSeen / tourSeen are saved only by the first start and 要不要看看 after signing in.
  for (const fn of ['openHelpChoice', 'closeHelpChoice', 'choose', 'walkAgain', 'backInView']) {
    const body = help.match(new RegExp(`function ${fn}\\(.*\\) \\{\\n([\\s\\S]*?)\\n\\}`))[1];
    assert.doesNotMatch(body, /saveFlags|guideSeen|tourSeen/, fn);
  }
  assert.equal(help.split('saveFlags(').length - 1, 3, 'the definition, the first start, 要不要看看');
});

test('Esc or a click outside closes it; Tab stays on the three choices; never on top of another box', () => {
  const wiring = help.slice(help.indexOf("$('helpChoice').addEventListener('click'"));
  assert.match(wiring, /if \(e\.target === \$\('helpChoice'\)\) closeHelpChoice\(\);/);
  assert.match(wiring, /if \(e\.key === 'Escape'\) \{\n\s+e\.preventDefault\(\);\n\s+closeHelpChoice\(\);/);
  assert.match(wiring, /const items = \[\$\('helpTour'\), \$\('helpCards'\), \$\('helpFaq'\)\];/);
  assert.match(help, /const busy = \(\) => [^;]*!\$\('helpChoice'\)\.hidden/);
  assert.match(help.match(/export function openHelpChoice\(\) \{[\s\S]*?\n\}/)[0], /if \(busy\(\)\) return;/);
  // Focus goes back to the button that opened it, so the cards and the tour return there too.
  assert.match(help, /back\.focus\(\{ preventScroll: true \}\);/);
});

test('card page 1 no longer has its own replay link; the cards and the FAQ point to 💡 帮助', () => {
  assert.doesNotMatch(help, /walkAgain'|guide-walk|TOUR_AGAIN|在页面上再带我走一遍/);
  assert.doesNotMatch(css, /\.guide-walk|\.relearn/);
  const sentence = '点 💡 帮助，可以选完整教程或卡片教程';
  const last = GUIDE_PAGES.find((p) => p.faq);
  assert.ok(last.lines.some((l) => l.startsWith(sentence)), 'the FAQ card says it');
  assert.ok(last.lines.length <= 3);
  // The tour's 💡 帮助 step borrows that line, so the bubble on the button says it too.
  const step = TOUR_STEPS.find((s) => s.id === 'help');
  assert.ok(last.lines[step.lines[0]].startsWith(sentence));
  const faq = read('../docs/FAQ.md');
  const q = parseFaq(faq).groups.flatMap((g) => g.questions).find((x) => x.title === '怎么重新看新手引导？');
  const words = JSON.stringify(q.blocks);
  for (const w of [sentence, '完整教程：跟着页面一步步走', '卡片教程：几张卡片快速看', '不会改动你的任何设置', 'Esc']) assert.ok(words.includes(w), w);
  assert.ok(faq.split(sentence).length - 1 >= 2, 'also in 登录以后问「要不要看看各个功能在哪？」');
  assert.doesNotMatch(faq, /在页面上再带我走一遍|再看一遍新手引导|\*\*重新看新手引导\*\*/);
});

test('look: words on the glass itself (4.5:1 in every palette, tour.test.js), stacked at phone width', () => {
  const rules = css.match(/\.help-choices?[^{]*\{[^}]*\}/g);
  assert.ok(rules.length >= 5);
  for (const r of rules) assert.doesNotMatch(r.replace(/var\(--[\w-]+\)/g, ''), /#[0-9a-f]{3,8}\b|rgba?\(/i, r);
  // Outlined, not filled: the words sit on the glass, whose contrast is checked for every palette.
  assert.match(css, /\.help-choices button \{[^}]*background: transparent;[^}]*color: var\(--text\);/);
  const phone = css.slice(css.indexOf('@media (max-width: 600px) {\n  body'));
  assert.match(phone, /\.help-choices \{ flex-direction: column; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.help-choices button:active \{ transform: none; \} \}/);
});
