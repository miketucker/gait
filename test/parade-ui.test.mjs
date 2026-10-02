// Contract for the parade page's Restart control: the button exists in the
// page controls and the scene module wires it to reset the playback clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../parade.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../src/js/parade.js', import.meta.url), 'utf8');

test('parade page has a Restart button in the controls', () => {
  assert.match(html, /<button[^>]*\bid="restart"[^>]*>\s*Restart\s*<\/button>/);
});

test('parade scene resets playback to the start when Restart is used', () => {
  assert.match(js, /getElementById\(['"]restart['"]\)/);
  assert.match(js, /simTime\s*=\s*0/);
  assert.match(js, /__parade\s*=\s*\{[\s\S]*restart/);
});
