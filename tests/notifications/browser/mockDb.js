export const profile = { id: 'fixture-user', company_id: 'fixture-company', role: 'owner', is_active: true, notify_action_required_only: localStorage.getItem('fixture-action-only') === 'true' };
const rows = Array.from({ length: 140 }, (_, i) => ({
  id: `fixture-${i}`, company_id: profile.company_id, user_id: profile.id,
  title: i === 0 ? 'Task overdue' : i === 1 ? 'Quote approved' : i === 2 ? 'Client viewed quote' : `Project update ${i}`,
  body: i === 0 ? 'Kitchen renovation: finish the cabinet measurements.' : i === 1 ? 'Kitchen renovation: Quote Q-104 has been approved.' : i === 2 ? 'Quote Q-104 was viewed by a client.' : 'An update to your assigned project.',
  category: i === 1 || i === 2 ? 'Financial' : 'Projects', severity: i === 0 ? 'Action Required' : i === 1 ? 'Important' : 'FYI',
  is_read: false, created_at: new Date(Date.now() - i * 60000).toISOString(),
  action_url: i === 0 ? '/Tasks?notificationTask=fixture-0' : '/QuoteBuilder?id=fixture-quote', metadata: {},
}));

class Query {
  constructor(table) { this.table = table; this.filters = []; this.sorts = []; }
  select(_columns, options) { this.options = options; return this; }
  eq(key, value) { this.filters.push(row => row[key] === value); return this; }
  order(key, { ascending }) { this.sorts.push([key, ascending]); return this; }
  range(start, end) { this.bounds = [start, end]; return this; }
  update(value) { this.updateValue = value; return this; }
  single() { this.one = true; return this; }
  then(resolve, reject) {
    const result = this.table === 'profiles' ? [profile] : rows;
    let matches = result.filter(row => this.filters.every(fn => fn(row)));
    if (this.updateValue) {
      matches.forEach(row => Object.assign(row, this.updateValue));
      if (this.table === 'profiles') localStorage.setItem('fixture-action-only', String(profile.notify_action_required_only));
    }
    const count = matches.length;
    matches = [...matches].sort((a, b) => {
      for (const [key, ascending] of this.sorts) if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * (ascending ? 1 : -1);
      return 0;
    });
    if (this.bounds) matches = matches.slice(this.bounds[0], this.bounds[1] + 1);
    return Promise.resolve({ data: this.one ? matches[0] : matches, count, error: null }).then(resolve, reject);
  }
}
export const supabase = {
  from: table => new Query(table),
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel: () => {},
};
