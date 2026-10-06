import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { normalizePhaseOrder } from '../../src/lib/phaseOrdering.js';

test('phase ordering is normalized after a reorder, deletion, or append', () => {
  const reordered = normalizePhaseOrder([
    { phase_name: 'C', sort_order: 2 },
    { phase_name: 'A', sort_order: 0 },
    { phase_name: 'B', sort_order: 1 },
  ]);

  assert.deepEqual(reordered.map(phase => phase.phase_name), ['C', 'A', 'B']);
  assert.deepEqual(reordered.map(phase => phase.sort_order), [0, 1, 2]);

  const afterDeleteAndAppend = normalizePhaseOrder([
    reordered[0],
    reordered[2],
    { phase_name: 'D', sort_order: 2 },
  ]);
  assert.deepEqual(afterDeleteAndAppend.map(phase => phase.sort_order), [0, 1, 2]);
});

test('phase text fields explicitly include AI Rewrite and expansion controls', async () => {
  const phaseCard = await fs.readFile(new URL('../../src/components/quotes/PhaseCard.jsx', import.meta.url), 'utf8');

  assert.equal((phaseCard.match(/writingTools/g) || []).length, 2);
  assert.equal((phaseCard.match(/rewriteField="general_business_text"/g) || []).length, 2);
  assert.match(phaseCard, /value=\{localScope\}[\s\S]*onUpdatePhase\(phaseIdx, "scope_of_work"/);
  assert.match(phaseCard, /value=\{localNotes\}[\s\S]*onUpdatePhase\(phaseIdx, "internal_notes"/);
});

test('quote template imports preserve phase fields and normalize their order', async () => {
  const quoteBuilder = await fs.readFile(new URL('../../src/pages/QuoteBuilder.jsx', import.meta.url), 'utf8');

  assert.match(quoteBuilder, /phase_name: phase\.phase_name/);
  assert.match(quoteBuilder, /scope_of_work: phase\.scope_of_work \|\| ""/);
  assert.match(quoteBuilder, /setPhases\(current => normalizePhaseOrder\(\[\.\.\.current, \.\.\.importedPhases\]\)\)/);
});
