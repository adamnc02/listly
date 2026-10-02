// The floating nav is hidden while the on-screen keyboard is up.
//
// The mechanism is deliberately outside React: index.html's measureAll()
// calls reflectKeyboard(), which writes data-keyboard="open" on <html>, and
// one CSS rule hides the pill and its bottom fade. The pill is `absolute`, so
// hiding it reflows nothing.
//
// WHAT THIS PREVENTS, and why it is not just a grep:
//
//  1. A SECOND KEYBOARD DETECTOR. In iOS standalone, window.innerHeight
//     shrinks WITH the keyboard, so the usual
//     `innerHeight - visualViewport.height > 150` test reads ~0 and never
//     fires. index.html compares against 75% of screen.height instead. That
//     is not obvious, so anyone adding keyboard handling is likely to write
//     the obvious version somewhere else and have it silently never fire.
//     This file extracts the REAL function out of index.html and runs it
//     against fake viewports, including the exact case the obvious version
//     gets wrong.
//  2. Reducing <main>'s bottom padding along with it, which reflows the list
//     under the finger of whoever is typing.
//  3. Dropping setAppHeight's own isKeyboardOpen() guard, which would let the
//     shell resize to the keyboard and undo the Phase 4 viewport fix.

import { readFileSync } from 'node:fs'

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`  ${pass ? '✓' : '✗'} ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  if (!pass) failures++
}

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')

console.log('\n── One detector, and it is the hard-won one ──')

check('isKeyboardOpen is defined exactly once', (html.match(/function isKeyboardOpen\(/g) ?? []).length, 1)
check('reflectKeyboard is defined exactly once', (html.match(/function reflectKeyboard\(/g) ?? []).length, 1)
check('measureAll calls it, so every resize re-decides', /function measureAll\(\)[\s\S]*?reflectKeyboard\(\)[\s\S]*?\n        \}/.test(html), true)
check('it writes data-keyboard on <html>', /setAttribute\('data-keyboard', 'open'\)/.test(html), true)
check('…and removes it again', /removeAttribute\('data-keyboard'\)/.test(html), true)
// The existing guard this change must not disturb.
check('setAppHeight still returns early when the keyboard is up', /function setAppHeight\(\)\s*\{\s*\n\s*if \(isKeyboardOpen\(\)\) return/.test(html), true)
// The obvious-but-broken test must not appear in CODE. Two comments here
// describe it in order to warn against it, which is exactly why the comments
// have to come off before this assertion means anything.
const codeOnly = html
  .split('\n')
  .filter((line) => !/^\s*\/\//.test(line))
  .join('\n')
check('(control) comment stripping drops a warned-about detector, keeps a real one', [
  /innerHeight\s*-\s*visualViewport\.height/.test('  // innerHeight - visualViewport.height is useless here'.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')),
  /innerHeight\s*-\s*visualViewport\.height/.test('return innerHeight - visualViewport.height > 150'),
], [false, true])
check('no innerHeight-minus-viewport detector in the code itself', /innerHeight\s*-\s*(window\.)?visualViewport\.height/.test(codeOnly), false)

console.log('\n── The real predicate, run against fake viewports ──')

// Extracted rather than reimplemented: a copy here could pass while the
// shipped one is wrong, which is the whole failure this guards.
const src = html.match(/function isKeyboardOpen\(\)[\s\S]*?\n        \}/)?.[0] ?? ''
check('the function body was extracted from index.html', src.length > 0, true)
const isKeyboardOpen = new Function('window', `${src}; return isKeyboardOpen()`) as (w: unknown) => boolean
const fake = (opts: { vvh?: number; screenH?: number; standalone?: boolean; innerHeight?: number }) => ({
  visualViewport: opts.vvh === undefined ? undefined : { height: opts.vvh },
  screen: { height: opts.screenH ?? 844 },
  navigator: { standalone: opts.standalone ?? true },
  innerHeight: opts.innerHeight ?? opts.vvh ?? 844,
})

// An iPhone 13 (844pt tall) with the keyboard up leaves roughly 450pt.
check('keyboard up on an iPhone → open', isKeyboardOpen(fake({ vvh: 450 })), true)
check('no keyboard → closed', isKeyboardOpen(fake({ vvh: 800 })), false)
check('just above the threshold (0.75 of 844 = 633) → closed', isKeyboardOpen(fake({ vvh: 634 })), false)
check('just below it → open', isKeyboardOpen(fake({ vvh: 632 })), true)
check('a Safari tab, not standalone → closed, whatever the height', isKeyboardOpen(fake({ vvh: 300, standalone: false })), false)
check('no visualViewport at all → closed', isKeyboardOpen(fake({})), false)

// 🚨 The discriminating case. With the keyboard up, innerHeight has shrunk to
// match the visual viewport, so the obvious detector sees a difference of 0.
const keyboardUp = fake({ vvh: 450, innerHeight: 450 })
check('the real predicate fires when innerHeight has shrunk WITH the keyboard', isKeyboardOpen(keyboardUp), true)
const obvious = (w: { innerHeight: number; visualViewport?: { height: number } }) => w.innerHeight - (w.visualViewport?.height ?? 0) > 150
check('(control) the obvious innerHeight test does NOT fire on that same case', obvious(keyboardUp), false)

console.log('\n── The CSS rule ──')

check('the pill is hidden on data-keyboard="open"', /html\[data-keyboard='open'\] nav/.test(css), true)
check('…and so is the bottom fade it floats in', /html\[data-keyboard='open'\] \.edge-fade-bottom/.test(css), true)
check('they are hidden with display: none', /html\[data-keyboard='open'\][\s\S]{0,120}\{ display: none; \}/.test(css), true)
// Deliberate non-change: reflowing the scroll area under a typing finger.
check('main\'s padding is NOT touched while the keyboard is up', /html\[data-keyboard='open'\][^{]*main/.test(css), false)
check('the pill is still absolute, not fixed', /^nav \{[\s\S]*?position: absolute;/m.test(css), true)

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nAll checks passed')
