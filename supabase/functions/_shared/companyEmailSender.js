// All subscriber email uses the platform's verified sending domain. Only the
// display name changes; never take a sender address or company name from a request.
export const COMPANY_EMAIL_ADDRESS = 'alerts@mail.fuzedflow.com';

export function companyEmailFrom(company) {
  const name = typeof company?.name === 'string'
    ? company.name.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
  if (!name) throw new Error('Save your company name in Settings before sending an email.');
  // A bounded quoted display name safely preserves commas, quotes, Unicode,
  // and other punctuation without allowing additional addresses or headers.
  const displayName = Array.from(name).slice(0, 150).join('').trim()
    .replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${displayName}" <${COMPANY_EMAIL_ADDRESS}>`;
}

export async function resolveCompanyEmailSender(db, companyId) {
  const { data: company, error } = await db.from('companies')
    .select('name,settings').eq('id', companyId).single();
  if (error || !company) throw new Error('Your company email identity is unavailable. Please retry.');
  return { company, from: companyEmailFrom(company) };
}
