import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL("../../supabase/migrations/20261005140002_project_closeout_completion_gate.sql", import.meta.url), "utf8");
const COMPANY = "10000000-0000-4000-8000-000000000001";
const CLIENT = "10000000-0000-4000-8000-000000000002";
const PROJECT = "10000000-0000-4000-8000-000000000003";
const USER = "10000000-0000-4000-8000-000000000004";
const CLOSEOUT = "10000000-0000-4000-8000-000000000005";
const ITEM = "10000000-0000-4000-8000-000000000006";

const schema = `
create role anon;
create role authenticated;
create schema auth;
create schema workflow_private;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table public.companies(id uuid primary key);
create table public.clients(id uuid primary key, company_id uuid not null);
create table public.projects(id uuid primary key, company_id uuid not null, client_id uuid);
create table public.profiles(id uuid primary key, company_id uuid not null, is_active boolean default true, full_name text);
create table public.vendors(id uuid primary key, company_id uuid not null);
create table public.project_closeouts(
  id uuid primary key, company_id uuid not null, project_id uuid not null, client_id uuid not null,
  title text not null default 'Closeout', walkthrough_date date not null default current_date,
  notes text not null default '', status text not null default 'Draft', prepared_by_name text not null default '',
  published_at timestamptz, completed_at timestamptz, email_sent_at timestamptz, sms_sent_at timestamptz,
  subcontractors_sent_at timestamptz, created_by uuid not null, updated_by uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.project_closeout_items(
  id uuid primary key, company_id uuid not null, closeout_id uuid not null, project_id uuid not null,
  sort_order integer not null default 0, photo_url text not null, deficiency_type text not null default 'General',
  description text not null default '', assigned_vendor_id uuid, due_date date, status text not null default 'Open',
  subcontractor_sent_at timestamptz, created_by uuid not null, updated_by uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create function workflow_private.staff_access(target_company uuid, target_project uuid)
returns boolean language sql stable as $$
  select exists(select 1 from public.profiles where id=auth.uid() and company_id=target_company and is_active is distinct from false)
$$;
create function workflow_private.guard_project_closeout() returns trigger language plpgsql as $$ begin return new; end $$;
create function workflow_private.guard_project_closeout_item() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger project_closeouts_guard before insert or update on public.project_closeouts for each row execute function workflow_private.guard_project_closeout();
create trigger project_closeout_items_guard before insert or update on public.project_closeout_items for each row execute function workflow_private.guard_project_closeout_item();
`;

async function database() {
  const db = new PGlite();
  await db.exec(schema);
  await db.exec(migration);
  await db.query("insert into companies(id) values($1)", [COMPANY]);
  await db.query("insert into clients(id,company_id) values($1,$2)", [CLIENT, COMPANY]);
  await db.query("insert into projects(id,company_id,client_id) values($1,$2,$3)", [PROJECT, COMPANY, CLIENT]);
  await db.query("insert into profiles(id,company_id,full_name) values($1,$2,'Synthetic manager')", [USER, COMPANY]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [USER]);
  await db.query("insert into project_closeouts(id,company_id,project_id,client_id,created_by,updated_by) values($1,$2,$3,$4,$5,$5)", [CLOSEOUT, COMPANY, PROJECT, CLIENT, USER]);
  return db;
}

test("server blocks completion until every deficiency is Complete, then records valid completion", async () => {
  const db = await database();
  try {
    await db.query("insert into project_closeout_items(id,company_id,closeout_id,project_id,photo_url,description,status,created_by,updated_by) values($1,$2,$3,$4,'https://example.invalid/item.jpg','Open item','Open',$5,$5)", [ITEM, COMPANY, CLOSEOUT, PROJECT, USER]);
    await assert.rejects(
      db.query("update project_closeouts set status='Completed' where id=$1", [CLOSEOUT]),
      /Complete all deficiencies.*1 unresolved item/i,
    );
    assert.equal((await db.query("select status from project_closeouts where id=$1", [CLOSEOUT])).rows[0].status, "Draft");

    await db.query("update project_closeouts set status='Published' where id=$1", [CLOSEOUT]);
    await db.query("update project_closeout_items set status='Complete' where id=$1", [ITEM]);
    const completed = (await db.query("update project_closeouts set status='Completed' where id=$1 returning status,completed_at", [CLOSEOUT])).rows[0];
    assert.equal(completed.status, "Completed");
    assert.ok(completed.completed_at);
  } finally {
    await db.close();
  }
});

test("editing remains available and making a completed item unresolved reopens the closeout", async () => {
  const db = await database();
  try {
    await db.query("insert into project_closeout_items(id,company_id,closeout_id,project_id,photo_url,description,status,created_by,updated_by) values($1,$2,$3,$4,'https://example.invalid/item.jpg','Finished item','Complete',$5,$5)", [ITEM, COMPANY, CLOSEOUT, PROJECT, USER]);
    await db.query("update project_closeouts set status='Completed' where id=$1", [CLOSEOUT]);

    await db.query("update project_closeout_items set description='Corrected detail' where id=$1", [ITEM]);
    assert.equal((await db.query("select status from project_closeouts where id=$1", [CLOSEOUT])).rows[0].status, "Completed");

    await db.query("update project_closeout_items set status='Ready for Review' where id=$1", [ITEM]);
    const reopened = (await db.query("select status,completed_at,published_at from project_closeouts where id=$1", [CLOSEOUT])).rows[0];
    assert.equal(reopened.status, "Published");
    assert.equal(reopened.completed_at, null);
    assert.ok(reopened.published_at);
  } finally {
    await db.close();
  }
});

test("an empty closeout cannot be completed and deleting its final completed item reopens it", async () => {
  const db = await database();
  try {
    await assert.rejects(
      db.query("update project_closeouts set status='Completed' where id=$1", [CLOSEOUT]),
      /Add at least one deficiency/i,
    );
    await db.query("insert into project_closeout_items(id,company_id,closeout_id,project_id,photo_url,status,created_by,updated_by) values($1,$2,$3,$4,'https://example.invalid/item.jpg','Complete',$5,$5)", [ITEM, COMPANY, CLOSEOUT, PROJECT, USER]);
    await db.query("update project_closeouts set status='Completed' where id=$1", [CLOSEOUT]);
    await db.query("delete from project_closeout_items where id=$1", [ITEM]);
    assert.equal((await db.query("select status from project_closeouts where id=$1", [CLOSEOUT])).rows[0].status, "Published");
  } finally {
    await db.close();
  }
});
