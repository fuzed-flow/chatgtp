import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { checkAccess } from '../../src/lib/planConfig.js';

const tasks = await fs.readFile(new URL('../../src/pages/Tasks.jsx', import.meta.url), 'utf8');

test('Tasks reuses the complete company record from AuthContext', () => {
  assert.match(tasks, /const \{ profile, company \} = useAuth\(\)/);
  assert.doesNotMatch(tasks, /queryKey:\s*\["company",\s*companyId\]/);
  assert.match(tasks, /company\?\.name \|\| "Company"/);
});

test('Business and Professional plan checks are normalized', () => {
  assert.equal(checkAccess('business', 'hasAdvancedReporting'), true);
  assert.equal(checkAccess(' Business ', 'hasAdvancedReporting'), true);
  assert.equal(checkAccess('PROFESSIONAL', 'hasAdvancedReporting'), true);
  assert.equal(checkAccess('starter', 'hasAdvancedReporting'), false);
  assert.equal(checkAccess(undefined, 'hasAdvancedReporting'), false);
});
