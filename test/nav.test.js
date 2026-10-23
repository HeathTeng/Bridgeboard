import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NAV_EDGE, navArrows, navReveal, navStep } from '../lib/display.js';

const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../public/layout.js', import.meta.url), 'utf8');

test('nav arrows: none when the bar fits, no ‹ at the far left, no › at the far right', () => {
  assert.deepEqual(navArrows({ scrollLeft: 0, scrollWidth: 900, clientWidth: 900 }), { prev: false, next: false });
  assert.deepEqual(navArrows({ scrollLeft: 0, scrollWidth: 900.5, clientWidth: 900 }), { prev: false, next: false }, 'rounding is not overflow');
  assert.deepEqual(navArrows({ scrollLeft: 0, scrollWidth: 700, clientWidth: 330 }), { prev: false, next: true });
  assert.deepEqual(navArrows({ scrollLeft: 150, scrollWidth: 700, clientWidth: 330 }), { prev: true, next: true });
  assert.deepEqual(navArrows({ scrollLeft: 370, scrollWidth: 700, clientWidth: 330 }), { prev: true, next: false });
  assert.deepEqual(navArrows({ scrollLeft: 369.4, scrollWidth: 700, clientWidth: 330 }), { prev: true, next: false }, 'within 1 px of the end');
});

test('nav arrows: one press moves about a screen width, never less than half the bar', () => {
  assert.equal(navStep(330), 330 - 2 * NAV_EDGE);
  assert.equal(navStep(100), 50);
});

test('nav arrows: the marked item scrolls into view, clear of the buttons', () => {
  const bar = { left: 20, right: 350 };
  assert.equal(navReveal({ left: 100, right: 180 }, bar), 0, 'already in view');
  assert.equal(navReveal({ left: 330, right: 420 }, bar), 420 - (350 - NAV_EDGE));
  assert.equal(navReveal({ left: -60, right: 10 }, bar), -60 - (20 + NAV_EDGE));
});

test('nav arrows: Chinese labels, at least 32 px, and a jump instead of a glide under 减少动态效果', () => {
  assert.match(layout, /'上一组'/);
  assert.match(layout, /'下一组'/);
  const size = css.match(/\.nav-arrow \{[^}]*width: (\d+)px; height: (\d+)px/);
  assert.ok(size && +size[1] >= 32 && +size[2] >= 32, 'buttons at least 32 px for a finger');
  assert.match(layout, /scrollBy\(\{ left: dir \* navStep\(navTrack\.clientWidth\), behavior: behavior\(\) \}\)/);
});
