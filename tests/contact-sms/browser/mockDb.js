const query = new URLSearchParams(window.location.search);
const kind = query.get('kind') === 'lead' ? 'lead' : 'client';
export const fixture = window.smsFixture ||= {
  kind, companyId: 'sample-company', phone: '(403) 555-0123', name: kind === 'lead' ? 'Sample Lead' : 'Sample Client',
  rows: [{ id: 'incoming-one', company_id: 'sample-company', client_id: kind === 'client' ? 'sample-client' : null,
    lead_id: kind === 'lead' ? 'sample-lead' : null, type: 'SMS', direction: 'Inbound', status: 'Received',
    subject: 'SMS reply received', message: 'Would Tuesday morning work for the walkthrough?', sent_by: '+14035550123', created_at: '2026-11-02T18:00:00Z' }],
  calls: [], queries: [], writes: [], replyStatus: { email: true, sms: true },
};

export const supabase = {
  from(table) {
    const record = { table, filters: [], or: null, mode: 'select' };
    const chain = {
      select() { return chain; }, eq(key, value) { record.filters.push([key, value]); return chain; },
      or(value) { record.or = value; return chain; }, order() { return chain; },
      update(payload) { record.mode = 'update'; record.payload = payload; return chain; },
      insert(payload) { record.mode = 'insert'; record.payload = payload; return chain; },
      then(resolve, reject) {
        fixture.queries.push(record);
        if (record.mode !== 'select') { fixture.writes.push(record); return Promise.resolve({ data: null, error: null }).then(resolve, reject); }
        const rows = table === 'client_communications' ? fixture.rows.filter(row => record.filters.every(([key, value]) => row[key] === value) && (!record.or || !row.delivery_kind || row.delivery_kind === 'communication')) : [];
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return chain;
  },
  async rpc(name) {
    if (name !== 'communication_reply_status') throw new Error('Unexpected fixture RPC');
    return { data: fixture.replyStatus, error: null };
  },
  functions: { async invoke(name, { body }) {
    if (name !== 'send-sms') throw new Error('Unexpected fixture function');
    fixture.calls.push({ name, body: { ...body } });
    if (fixture.nextSend) return fixture.nextSend();
    fixture.rows.unshift({ id: `outgoing-${fixture.calls.length}`, company_id: fixture.companyId, client_id: body.client_id,
      lead_id: body.lead_id, type: 'SMS', direction: 'Outbound', status: 'Sent', subject: 'Text message sent',
      message: body.message_body, delivery_kind: 'communication', created_at: new Date().toISOString(), sent_by: 'Sample team member' });
    return { data: { success: true, message_sid: 'SM00000000000000000000000000000001' }, error: null };
  } },
};
