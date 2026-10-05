import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { clientUpdatePortalUrl, escapeEmailHtml, itemsToLines, linesToItems, matchesClientUpdate } from "../../src/lib/clientUpdates.js";

const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

test("client update helpers normalize list fields, search all useful content and build portal links", () => {
  assert.deepEqual(linesToItems("- Plumbing complete\n2. Inspection passed\n\n * Paint started"), ["Plumbing complete", "Inspection passed", "Paint started"]);
  assert.equal(itemsToLines(["One", "Two"]), "One\nTwo");
  assert.equal(matchesClientUpdate({ title: "Weekly update", completed_work: ["Inspection passed"] }, { name: "Mount Cornwall" }, { name: "Scott" }, "inspection"), true);
  assert.equal(matchesClientUpdate({ title: "Weekly update" }, { name: "Mount Cornwall" }, { name: "Scott" }, "edgeland"), false);
  assert.equal(clientUpdatePortalUrl("https://app.fuzedflow.com", id(20), id(40)), `https://app.fuzedflow.com/ClientPortal?id=${id(20)}&tab=updates&update=${id(40)}`);
  assert.equal(escapeEmailHtml(`<script>"test" & 'x'</script>`), "&lt;script&gt;&quot;test&quot; &amp; &#039;x&#039;&lt;/script&gt;");
});

test("client updates enforce tenant/project ownership and expose only published portal fields", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      grant usage on schema auth to anon, authenticated, service_role;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.companies(id uuid primary key, name text);
      create table public.profiles(id uuid primary key, company_id uuid, full_name text, role text, permissions jsonb default '[]', is_active boolean default true);
      create table public.clients(id uuid primary key, company_id uuid, name text, email text, phone text, site_address text);
      create table public.projects(id uuid primary key, company_id uuid, client_id uuid, name text, project_number text, site_address text);
      create table public.project_staff(company_id uuid, project_id uuid, user_id uuid, is_active boolean);
      create schema workflow_private;
      grant usage on schema workflow_private to anon, authenticated, service_role;
      create function workflow_private.staff_access(c uuid, p uuid default null)
      returns boolean language sql stable security definer set search_path='' as $$
        select exists(select 1 from public.profiles u where u.id=(select auth.uid()) and u.company_id=c
          and u.is_active is distinct from false and u.role in ('owner','admin','office','manager'))
      $$;
      grant execute on function workflow_private.staff_access(uuid,uuid) to authenticated;
    `);
    await db.exec(await readFile(new URL("../../supabase/migrations/20261005025000_client_project_updates.sql", import.meta.url), "utf8"));

    const company = id(1), other = id(2), admin = id(10), outsider = id(11), client = id(20), project = id(30), update = id(40), draft = id(41);
    await db.query("insert into companies(id,name) values($1,'Company'),($2,'Other')", [company, other]);
    await db.query("insert into profiles(id,company_id,full_name,role) values($1,$2,'Project Manager','admin'),($3,$4,'Outsider','owner')", [admin, company, outsider, other]);
    await db.query("insert into clients(id,company_id,name,email) values($1,$2,'Saved Client','client@example.invalid')", [client, company]);
    await db.query("insert into projects(id,company_id,client_id,name,project_number) values($1,$2,$3,'Saved Project','PRJ-1001')", [project, company, client]);

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
    await db.exec("set role authenticated");
    await db.query("insert into client_updates(id,company_id,project_id,client_id,title,summary,completed_work,upcoming_work,created_by,updated_by) values($1,$2,$3,$4,'Weekly update','Good progress',array['Inspection passed'],array['Tile starts Monday'],$5,$5)", [update, company, project, id(999), admin]);
    const saved = (await db.query("select client_id,prepared_by_name,status from client_updates where id=$1", [update])).rows[0];
    assert.equal(saved.client_id, client);
    assert.equal(saved.prepared_by_name, "Project Manager");
    assert.equal(saved.status, "Draft");
    await db.query("update client_updates set status='Published' where id=$1", [update]);
    await db.query("insert into client_updates(id,company_id,project_id,client_id,title,summary,created_by,updated_by) values($1,$2,$3,$4,'Private draft','Not public',$5,$5)", [draft, company, project, client, admin]);
    await db.exec("reset role");

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [outsider]);
    await db.exec("set role authenticated");
    assert.equal((await db.query("select count(*)::int n from client_updates")).rows[0].n, 0);
    await db.exec("reset role");

    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.exec("set role anon");
    const portal = (await db.query("select * from get_client_portal_updates($1)", [client])).rows;
    assert.equal(portal.length, 1);
    assert.equal(portal[0].id, update);
    assert.equal(portal[0].project_name, "Saved Project");
    assert.equal(Object.prototype.hasOwnProperty.call(portal[0], "company_id"), false);
    await assert.rejects(db.query("select * from client_updates"), /permission denied/);
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});

