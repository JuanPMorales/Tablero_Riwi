import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('Vercel puede interpretar su configuración como JSON UTF-8 sin BOM', () => {
  const source = readFileSync(new URL('./vercel.json', import.meta.url), 'utf8');
  assert.doesNotThrow(() => JSON.parse(source));
});
