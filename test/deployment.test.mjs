import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

test('production pages resolve their scripts, styles and links within the Pages project', async (t) => {
  const outDir = await mkdtemp(join(tmpdir(), 'gait-pages-test-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const result = await build({
    configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)),
    logLevel: 'silent',
    build: { outDir },
  });

  for (const page of ['index.html', 'viewer.html', 'parade.html']) {
    const html = await readFile(join(outDir, page), 'utf8');
    if (page !== 'index.html') {
      assert.match(html, /<script\b[^>]*type="module"[^>]*src="\.\/assets\//);
      assert.doesNotMatch(html, /src="(?:\.\/|\/)?src\//);
    }
    // Exercise both a root deployment and a GitHub Pages repository subpath.
    for (const base of ['/', '/gait/']) {
      const pageUrl = new URL(`${base}${page}`, 'https://example.test');
      for (const [, ref] of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
        const url = new URL(ref, pageUrl);
        if (url.origin !== pageUrl.origin || ref.startsWith('#')) continue;
        assert.ok(url.pathname.startsWith(base), `${page}: ${ref} escapes ${base}`);
        assert.ok((await stat(join(outDir, url.pathname.slice(base.length)))).isFile(), `${page}: ${ref} is missing`);
      }
    }
  }

  for (const chunk of result.output.filter((entry) => entry.type === 'chunk')) {
    assert.doesNotMatch(chunk.code, /import\.meta\.glob\(/, `${chunk.fileName} contains an unbuilt Vite glob`);
    for (const dependency of [...chunk.imports, ...chunk.dynamicImports]) {
      assert.ok((await stat(join(outDir, dependency))).isFile(), `${chunk.fileName}: ${dependency} is missing`);
    }
  }
});
