import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isValidOptionalPhone, normalizeOptionalPhone } from '../../src/lib/phoneNumber.js';

const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('optional employee phone numbers normalize and validate as E.164', () => {
  assert.equal(normalizeOptionalPhone(' (403) 555-1234 '), '4035551234');
  assert.equal(normalizeOptionalPhone(' +1 (403) 555-1234 '), '+14035551234');
  assert.equal(normalizeOptionalPhone(''), null);
  assert.equal(isValidOptionalPhone(''), true);
  assert.equal(isValidOptionalPhone('+14035551234'), true);
  assert.equal(isValidOptionalPhone('4035551234'), false);
  assert.equal(isValidOptionalPhone('+01234567890'), false);
});

test('employee portal offers a user-initiated push setup and saves the preference', async () => {
  const [portal, prompt, settings] = await Promise.all([
    read('src/pages/EmployeePortal.jsx'),
    read('src/components/employee/EmployeePushSetupPrompt.jsx'),
    read('src/components/settings/PersonalNotificationSettings.jsx'),
  ]);

  assert.match(portal, /<EmployeePushSetupPrompt \/>/);
  assert.match(prompt, /onClick=\{enablePush\}/);
  assert.match(prompt, /enableNotificationPush\(\)/);
  assert.match(prompt, /push: true/);
  assert.match(prompt, /save_notification_preferences/);
  assert.match(settings, /Push notifications are enabled on this device/);
  assert.doesNotMatch(prompt, /Notification\.requestPermission\(\).*useEffect/s);
});

test('team invites accept an optional phone that signup copies into the profile', async () => {
  const [teamSettings, migration] = await Promise.all([
    read('src/components/settings/TeamManagementSettings.jsx'),
    read('supabase/migrations/20261007200000_employee_phone_and_push_onboarding.sql'),
  ]);

  assert.match(teamSettings, /phone: normalizeOptionalPhone\(formData\.phone\)/);
  assert.match(teamSettings, /Phone Number/);
  assert.match(migration, /add column if not exists phone text/);
  assert.match(migration, /insert into public\.profiles \(id, full_name, email, company_id, role, hourly_rate, phone\)/);
});

