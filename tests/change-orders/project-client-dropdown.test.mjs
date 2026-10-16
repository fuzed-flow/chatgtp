import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../../src/pages/ChangeOrderBuilder.jsx', import.meta.url),
  'utf8',
);

test('linked-project options include the associated client name', () => {
  assert.match(source, /clients\(id, name, email, phone\)/);
  assert.match(source, /const clientName = getProjectClient\(project\)\?\.name/);
  assert.match(source, />\{clientName\}<\/span>/);
  assert.match(source, /textValue=\{`\$\{projectLabel\} \$\{clientName\}`\}/);
});

test('selected project keeps the compact project-only trigger label', () => {
  assert.match(
    source,
    /selectedProject\.project_number\} - \$\{selectedProject\.name\}/,
  );
});
