import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('existing signup trigger creates accessible companies and consumes reserved invitations', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL('../notifications/schema.sql', import.meta.url), 'utf8'));
    await db.exec(`
      alter table auth.users add column raw_user_meta_data jsonb;
      create table invoice_payment_schedules(id uuid primary key default gen_random_uuid(),company_id uuid,invoice_id uuid,amount_type text,percentage numeric,amount numeric,amount_paid numeric default 0,sort_order int,status text);
      grant all on all tables in schema public to anon,authenticated,service_role;
    `);
    for (const table of ['quote_phases', 'quote_line_items', 'invoice_phases', 'invoice_line_items', 'purchase_order_line_items', 'change_order_phases', 'change_order_line_items']) {
      await db.exec(`create table ${table}(id uuid primary key default gen_random_uuid(),company_id uuid);grant all on ${table} to authenticated,service_role;`);
    }
    for (const table of ['profiles', 'companies', 'team_invites']) {
      await db.exec(`alter table ${table} enable row level security;create policy legacy_permissive_access on ${table} for all to authenticated using(true) with check(true);`);
    }
    for (const name of ['20261004201943_storefront_review_repairs.sql', '20261004204119_project_tenant_boundaries.sql']) {
      await db.exec(await readFile(new URL('../../supabase/migrations/' + name, import.meta.url), 'utf8'));
    }
    await db.exec(await readFile(new URL('./fixtures/handle-new-user.sql', import.meta.url), 'utf8'));
    await db.exec('create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();');

    const signup = (number, email, metadata) => db.query(
      'insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',
      [id(number), email, JSON.stringify(metadata)],
    );
    await signup(101, 'owner@example.test', { full_name: 'Fixture Owner', company_name: 'Signup Fixture', plan_id: 'starter' });
    const owner = (await db.query('select company_id,role from profiles where id=$1', [id(101)])).rows[0];
    assert.equal(owner.role, 'admin');
    assert.equal((await db.query('select plan_id from companies where id=$1', [owner.company_id])).rows[0].plan_id, 'starter');

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(101)]);
    await db.exec('set role authenticated');
    assert.equal((await db.query('select count(*)::int n from profiles')).rows[0].n, 1);
    assert.equal((await db.query('select count(*)::int n from companies')).rows[0].n, 1);
    await db.exec("reset role;select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','service_role',false);");

    // One purchased seat can be reserved and then consumed at signup, even at capacity.
    await db.query('update companies set max_users=2 where id=$1', [owner.company_id]);
    await db.query('insert into team_invites(id,company_id,email,role,is_pending) values($1,$2,$3,$4,true)', [id(201), owner.company_id, 'invitee@example.test', 'member']);
    await signup(102, 'invitee@example.test', { full_name: 'Invited Fixture' });
    const invitee = (await db.query('select company_id,role from profiles where id=$1', [id(102)])).rows[0];
    assert.equal(invitee.company_id, owner.company_id);
    assert.equal(invitee.role, 'member');
    assert.equal((await db.query('select is_pending from team_invites where id=$1', [id(201)])).rows[0].is_pending, false);
    assert.equal((await db.query('select count(*)::int n from companies')).rows[0].n, 1);

    await assert.rejects(db.query('insert into team_invites(company_id,email,role,is_pending) values($1,$2,$3,true)', [owner.company_id, 'over-capacity@example.test', 'member']), /PLAN LIMIT REACHED/);
    // Google signup can omit company metadata; the existing trigger still creates a usable account.
    await signup(103, 'google-fixture@example.test', {});
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)", [id(103)]);
    await db.exec('set role authenticated');
    assert.equal((await db.query('select count(*)::int n from profiles')).rows[0].n, 1);
    assert.equal((await db.query('select count(*)::int n from companies')).rows[0].n, 1);
    assert.equal((await db.query('select name from companies')).rows[0].name, "New User's Company");
  } finally {
    await db.close();
  }
});
