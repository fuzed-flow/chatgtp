import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL("../../supabase/migrations/20261005204500_lead_detail_delete.sql", import.meta.url), "utf8");
const COMPANY_A = "10000000-0000-4000-8000-000000000001";
const COMPANY_B = "10000000-0000-4000-8000-000000000002";
const USER_A = "10000000-0000-4000-8000-000000000003";
const USER_B = "10000000-0000-4000-8000-000000000004";
const LEAD_A = "10000000-0000-4000-8000-000000000005";
const LEAD_B = "10000000-0000-4000-8000-000000000006";

const schema = `
create role anon;
create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table public.profiles(id uuid primary key, company_id uuid not null, is_active boolean default true);
create table public.leads(id uuid primary key, company_id uuid not null, contact_name text);
create table public.quotes(id uuid primary key, company_id uuid not null, lead_id uuid);
create table public.notes(id uuid primary key, company_id uuid not null, related_type text, related_id uuid);
create table public.tasks(id uuid primary key, company_id uuid not null, lead_id uuid references public.leads(id) on delete set null);

grant usage on schema public, auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant select on public.profiles to authenticated;
grant select, update, delete on public.leads to authenticated;
grant select, update on public.quotes to authenticated;
grant select, delete on public.notes to authenticated;
grant select on public.tasks to authenticated;

alter table public.profiles enable row level security;
alter table public.leads enable row level security;
alter table public.quotes enable row level security;
alter table public.notes enable row level security;
alter table public.tasks enable row level security;

create policy profile_self on public.profiles for select to authenticated using(id=auth.uid());
create policy lead_company on public.leads for all to authenticated
  using(company_id=(select company_id from public.profiles where id=auth.uid()));
create policy quote_company on public.quotes for all to authenticated
  using(company_id=(select company_id from public.profiles where id=auth.uid()))
  with check(company_id=(select company_id from public.profiles where id=auth.uid()));
create policy note_company on public.notes for all to authenticated
  using(company_id=(select company_id from public.profiles where id=auth.uid()));
create policy task_company on public.tasks for select to authenticated
  using(company_id=(select company_id from public.profiles where id=auth.uid()));
`;

async function database() {
  const db = new PGlite();
  await db.exec(schema);
  await db.exec(migration);
  await db.query("insert into profiles(id,company_id) values($1,$2),($3,$4)", [USER_A, COMPANY_A, USER_B, COMPANY_B]);
  await db.query("insert into leads(id,company_id,contact_name) values($1,$2,'Company A lead'),($3,$4,'Company B lead')", [LEAD_A, COMPANY_A, LEAD_B, COMPANY_B]);
  await db.query("insert into quotes(id,company_id,lead_id) values(gen_random_uuid(),$1,$2)", [COMPANY_A, LEAD_A]);
  await db.query("insert into tasks(id,company_id,lead_id) values(gen_random_uuid(),$1,$2)", [COMPANY_A, LEAD_A]);
  await db.query("insert into notes(id,company_id,related_type,related_id) values(gen_random_uuid(),$1,'Lead',$2)", [COMPANY_A, LEAD_A]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [USER_A]);
  await db.exec("set role authenticated");
  return db;
}

test("deleting a lead preserves and unlinks its quotes and tasks", async () => {
  const db = await database();
  try {
    const result = (await db.query("select public.delete_lead($1) as result", [LEAD_A])).rows[0].result;
    assert.equal(result.deleted_lead_id, LEAD_A);
    assert.equal(result.unlinked_quotes, 1);
    assert.equal(result.unlinked_tasks, 1);
    assert.equal((await db.query("select count(*)::int as count from leads where id=$1", [LEAD_A])).rows[0].count, 0);
    assert.equal((await db.query("select lead_id from quotes where company_id=$1", [COMPANY_A])).rows[0].lead_id, null);
    assert.equal((await db.query("select lead_id from tasks where company_id=$1", [COMPANY_A])).rows[0].lead_id, null);
    assert.equal((await db.query("select count(*)::int as count from notes where company_id=$1", [COMPANY_A])).rows[0].count, 0);
  } finally {
    await db.close();
  }
});

test("a company user cannot delete another company's lead", async () => {
  const db = await database();
  try {
    await assert.rejects(
      db.query("select public.delete_lead($1)", [LEAD_B]),
      /Lead not found or access denied/i,
    );
    await db.exec("reset role");
    assert.equal((await db.query("select count(*)::int as count from leads where id=$1", [LEAD_B])).rows[0].count, 1);
  } finally {
    await db.close();
  }
});

test("lead detail exposes guarded desktop and mobile delete actions", () => {
  const detail = readFileSync(new URL("../../src/pages/LeadDetail.jsx", import.meta.url), "utf8");
  const tracker = readFileSync(new URL("../../src/pages/LeadTracker.jsx", import.meta.url), "utf8");
  const confirmation = readFileSync(new URL("../../src/components/shared/ConfirmDeleteDialog.jsx", import.meta.url), "utf8");

  assert.match(detail, /supabase\.rpc\("delete_lead", \{ p_lead_id: leadId \}\)/);
  assert.equal((detail.match(/setDeleteDialogOpen\(true\)/g) || []).length, 2);
  assert.match(detail, /Delete Lead/);
  assert.match(detail, /<ConfirmDeleteDialog/);
  assert.match(detail, /navigate\("\/LeadTracker", \{ replace: true \}\)/);
  assert.match(detail, /linked.*quote.*task.*kept but unlinked/s);
  assert.match(tracker, /supabase\.rpc\("delete_lead", \{ p_lead_id: id \}\)/);
  assert.match(confirmation, /event\.preventDefault\(\)/);
});
