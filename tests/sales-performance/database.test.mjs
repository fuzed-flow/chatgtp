import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const id = value => `10000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const migration = await readFile(new URL("../../supabase/migrations/20261005183000_sales_performance_foundation.sql", import.meta.url), "utf8");
const creatorMigration = await readFile(new URL("../../supabase/migrations/20261005224734_sales_performance_creator_attribution.sql", import.meta.url), "utf8");

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    grant usage on schema auth to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table companies(id uuid primary key);
    create table profiles(id uuid primary key,company_id uuid not null references companies(id),full_name text,email text,role text,is_active boolean default true);
    create table clients(id uuid primary key,company_id uuid not null references companies(id));
    create table leads(id uuid primary key,company_id uuid not null references companies(id),client_id uuid references clients(id),contact_name text not null,source text,pipeline_stage text,value_estimate numeric,assigned_to text,next_follow_up_date date,next_meeting_date date,created_at timestamptz not null default now());
    create table quotes(id uuid primary key,company_id uuid not null references companies(id),lead_id uuid references leads(id),client_id uuid references clients(id),user_id uuid references profiles(id),quote_number text,title text not null,status text,total numeric,is_template boolean default false,created_at timestamptz default now(),issue_date date,sent_at timestamptz,signed_at timestamptz,viewed_at timestamptz,updated_at timestamptz default now(),next_follow_up_date date,decline_reason text);
    create table quote_views(id uuid primary key,quote_id uuid not null references quotes(id),viewer_type text,viewed_at timestamptz default now());
    create table client_communications(id uuid primary key,company_id uuid not null references companies(id),lead_id uuid references leads(id),client_id uuid references clients(id),type text,direction text,subject text,message text,status text,created_at timestamptz default now());
    create table invoices(id uuid primary key,company_id uuid not null references companies(id),quote_id uuid references quotes(id));
    create table payments(id uuid primary key,company_id uuid references companies(id),invoice_id uuid references invoices(id),quote_id uuid references quotes(id),amount numeric,payment_method text,payment_date date,created_at timestamptz default now());
    create function public.get_auth_company_id() returns uuid language sql stable security definer set search_path='' as $$select company_id from public.profiles where id=(select auth.uid())$$;
    alter table leads enable row level security;
    create policy lead_company on leads for all to authenticated using(company_id=(select public.get_auth_company_id())) with check(company_id=(select public.get_auth_company_id()));
    grant select on profiles to authenticated;
    grant all on leads,quotes,quote_views,client_communications,invoices,payments to authenticated,service_role;
  `);
  await db.exec(migration);
  await db.exec(creatorMigration);
  await db.query("insert into companies(id) values($1),($2)", [id(1), id(2)]);
  await db.query("insert into profiles(id,company_id,full_name,email,role) values($1,$2,'Owner A','a@example.test','owner'),($3,$4,'Owner B','b@example.test','owner')", [id(10), id(1), id(20), id(2)]);
  return db;
}

async function actor(db, userId) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  await db.exec("set role authenticated");
}

test("lead transitions are timestamped and append tenant-scoped activity", async () => {
  const db = await database();
  try {
    await actor(db, id(10));
    await db.query("insert into leads(id,company_id,contact_name,source,pipeline_stage,value_estimate,assigned_to) values($1,$2,'Homeowner','Referral','New',25000,$3)", [id(30), id(1), id(10)]);
    const attribution = (await db.query("select assigned_to_user_id,created_by_user_id from leads where id=$1", [id(30)])).rows[0];
    assert.equal(attribution.assigned_to_user_id, id(10));
    assert.equal(attribution.created_by_user_id, id(10));
    const createdActivity = (await db.query("select activity_type,user_id from sales_activities where lead_id=$1", [id(30)])).rows[0];
    assert.equal(createdActivity.activity_type, "lead_created");
    assert.equal(createdActivity.user_id, id(10));

    const won = (await db.query("update leads set pipeline_stage='Won' where id=$1 returning won_at,stage_changed_at", [id(30)])).rows[0];
    assert.ok(won.won_at);
    assert.ok(won.stage_changed_at);
    const activities = (await db.query("select activity_type,metadata from sales_activities where lead_id=$1 order by occurred_at", [id(30)])).rows;
    assert.deepEqual(activities.map(row => row.activity_type), ["lead_created", "deal_won"]);
    assert.equal(activities[1].metadata.to, "Won");
  } finally {
    await db.close();
  }
});

test("lead creator is tenant-safe and immutable after insert", async () => {
  const db = await database();
  try {
    await actor(db, id(10));
    await db.query("insert into leads(id,company_id,contact_name,pipeline_stage,created_by_user_id) values($1,$2,'Attributed lead','New',$3)", [id(33), id(1), id(20)]);
    assert.equal((await db.query("select created_by_user_id from leads where id=$1", [id(33)])).rows[0].created_by_user_id, id(10), "authenticated actor overrides a spoofed creator");

    await db.query("update leads set created_by_user_id=$1 where id=$2", [id(20), id(33)]);
    assert.equal((await db.query("select created_by_user_id from leads where id=$1", [id(33)])).rows[0].created_by_user_id, id(10), "creator attribution cannot be reassigned");
  } finally {
    await db.close();
  }
});

test("foreign assignees and targets are blocked server-side", async () => {
  const db = await database();
  try {
    await actor(db, id(10));
    await assert.rejects(db.query("insert into leads(id,company_id,contact_name,pipeline_stage,assigned_to_user_id) values($1,$2,'Invalid','New',$3)", [id(31), id(1), id(20)]), /assignee must belong to this company/i);
    await assert.rejects(db.query("insert into sales_targets(company_id,user_id,period_start,revenue_target) values($1,$2,'2026-10-01',100000)", [id(1), id(20)]), /target user must belong to this company/i);
    await assert.rejects(db.query("insert into sales_targets(company_id,period_start,revenue_target) values($1,'2026-10-01',100000)", [id(2)]), /row-level security/i);
  } finally {
    await db.close();
  }
});

test("sales activity and targets are isolated between companies", async () => {
  const db = await database();
  try {
    await actor(db, id(10));
    await db.query("insert into leads(id,company_id,contact_name,pipeline_stage) values($1,$2,'Tenant A lead','New')", [id(32), id(1)]);
    await db.query("insert into sales_targets(company_id,period_start,revenue_target) values($1,'2026-10-01',75000)", [id(1)]);
    assert.equal((await db.query("select count(*)::int n from sales_activities")).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int n from sales_targets")).rows[0].n, 1);

    await actor(db, id(20));
    assert.equal((await db.query("select count(*)::int n from sales_activities")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from sales_targets")).rows[0].n, 0);
  } finally {
    await db.close();
  }
});
