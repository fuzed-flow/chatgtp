import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL("../../supabase/migrations/20261005195536_project_closeout_multiple_photos.sql", import.meta.url), "utf8");
const COMPANY = "20000000-0000-4000-8000-000000000001";
const CLIENT = "20000000-0000-4000-8000-000000000002";
const PROJECT = "20000000-0000-4000-8000-000000000003";
const USER = "20000000-0000-4000-8000-000000000004";
const CLOSEOUT = "20000000-0000-4000-8000-000000000005";
const ITEM = "20000000-0000-4000-8000-000000000006";

const schema = `
create role anon;
create role authenticated;
create schema workflow_private;
create table public.projects(
  id uuid primary key, company_id uuid not null, client_id uuid,
  name text, project_number text, site_address text
);
create table public.vendors(id uuid primary key, company_id uuid not null, name text);
create table public.project_closeouts(
  id uuid primary key, company_id uuid not null, project_id uuid not null, client_id uuid not null,
  title text not null default 'Closeout', walkthrough_date date not null default current_date,
  notes text not null default '', status text not null default 'Draft', prepared_by_name text not null default '',
  published_at timestamptz, completed_at timestamptz, created_by uuid not null, updated_by uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.project_closeout_items(
  id uuid primary key, company_id uuid not null, closeout_id uuid not null, project_id uuid not null,
  sort_order integer not null default 0, photo_url text not null,
  deficiency_type text not null default 'General', description text not null default '',
  assigned_vendor_id uuid, due_date date, status text not null default 'Open',
  created_by uuid not null, updated_by uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create function workflow_private.guard_project_closeout_item()
returns trigger language plpgsql as $$ begin return new; end $$;
create trigger project_closeout_items_guard before insert or update on public.project_closeout_items
for each row execute function workflow_private.guard_project_closeout_item();
`;

async function database() {
  const db = new PGlite();
  await db.exec(schema);
  await db.query("insert into projects(id,company_id,client_id,name,project_number,site_address) values($1,$2,$3,'Photo project','P-200','200 Main St')", [PROJECT, COMPANY, CLIENT]);
  await db.query("insert into project_closeouts(id,company_id,project_id,client_id,status,published_at,created_by,updated_by) values($1,$2,$3,$4,'Published',now(),$5,$5)", [CLOSEOUT, COMPANY, PROJECT, CLIENT, USER]);
  await db.query("insert into project_closeout_items(id,company_id,closeout_id,project_id,photo_url,created_by,updated_by) values($1,$2,$3,$4,'https://example.invalid/legacy.jpg',$5,$5)", [ITEM, COMPANY, CLOSEOUT, PROJECT, USER]);
  await db.exec(migration);
  return db;
}

test("migration backfills legacy images and exposes ordered photos to the client portal", async () => {
  const db = await database();
  try {
    const item = (await db.query("select photo_url,photo_urls from project_closeout_items where id=$1", [ITEM])).rows[0];
    assert.equal(item.photo_url, "https://example.invalid/legacy.jpg");
    assert.deepEqual(item.photo_urls, ["https://example.invalid/legacy.jpg"]);

    const portal = (await db.query("select items from workflow_private.client_portal_closeouts($1)", [CLIENT])).rows[0];
    assert.deepEqual(portal.items[0].photo_urls, ["https://example.invalid/legacy.jpg"]);
  } finally {
    await db.close();
  }
});

test("new clients can store several photos and legacy primary-image updates preserve the rest", async () => {
  const db = await database();
  try {
    const urls = ["https://example.invalid/one.jpg", "https://example.invalid/two.jpg", "https://example.invalid/three.jpg"];
    const saved = (await db.query("update project_closeout_items set photo_urls=$2 where id=$1 returning photo_url,photo_urls", [ITEM, urls])).rows[0];
    assert.equal(saved.photo_url, urls[0]);
    assert.deepEqual(saved.photo_urls, urls);

    const legacyUpdate = (await db.query("update project_closeout_items set photo_url='https://example.invalid/replacement.jpg' where id=$1 returning photo_url,photo_urls", [ITEM])).rows[0];
    assert.equal(legacyUpdate.photo_url, "https://example.invalid/replacement.jpg");
    assert.deepEqual(legacyUpdate.photo_urls, ["https://example.invalid/replacement.jpg", urls[1], urls[2]]);
  } finally {
    await db.close();
  }
});

test("database rejects empty, invalid, and oversized photo collections", async () => {
  const db = await database();
  try {
    await assert.rejects(
      db.query("update project_closeout_items set photo_urls='{}'::text[] where id=$1", [ITEM]),
      /between 1 and 10 photos/i,
    );
    await assert.rejects(
      db.query("update project_closeout_items set photo_urls=array[''] where id=$1", [ITEM]),
      /valid URL/i,
    );
    const eleven = Array.from({ length: 11 }, (_, index) => `https://example.invalid/${index}.jpg`);
    await assert.rejects(
      db.query("update project_closeout_items set photo_urls=$2 where id=$1", [ITEM, eleven]),
      /between 1 and 10 photos/i,
    );
  } finally {
    await db.close();
  }
});
