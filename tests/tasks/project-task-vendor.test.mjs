import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = new URL("../../supabase/migrations/20261006035904_project_task_vendor_assignment.sql", import.meta.url);
const id = value => `70000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

test("project task vendors are optional, same-company, editable, and cleared safely on vendor deletion", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create table public.vendors (
        id uuid primary key,
        company_id uuid,
        name text not null
      );
      create table public.project_tasks (
        id uuid primary key,
        company_id uuid,
        title text not null
      );
    `);
    await db.exec(await readFile(migration, "utf8"));

    const company = id(1);
    const otherCompany = id(2);
    const vendor = id(3);
    const foreignVendor = id(4);
    const task = id(5);

    await db.query("insert into vendors(id,company_id,name) values($1,$2,'Same-company trade'),($3,$4,'Foreign trade')", [vendor, company, foreignVendor, otherCompany]);
    await db.exec("grant usage on schema public to authenticated; grant select on public.vendors to authenticated; grant select,insert,update,delete on public.project_tasks to authenticated; set role authenticated;");
    await db.query("insert into project_tasks(id,company_id,title,vendor_id) values($1,$2,'Install millwork',$3)", [task, company, vendor]);
    assert.equal((await db.query("select vendor_id from project_tasks where id=$1", [task])).rows[0].vendor_id, vendor);

    await assert.rejects(
      db.query("update project_tasks set vendor_id=$1 where id=$2", [foreignVendor, task]),
      /must belong to the project task company/
    );
    await assert.rejects(
      db.query("update project_tasks set company_id=$1 where id=$2", [otherCompany, task]),
      /must belong to the project task company/
    );

    await db.query("update project_tasks set vendor_id=null where id=$1", [task]);
    assert.equal((await db.query("select vendor_id from project_tasks where id=$1", [task])).rows[0].vendor_id, null);

    await db.query("update project_tasks set vendor_id=$1 where id=$2", [vendor, task]);
    await db.exec("reset role");
    await db.query("delete from vendors where id=$1", [vendor]);
    assert.equal((await db.query("select vendor_id from project_tasks where id=$1", [task])).rows[0].vendor_id, null);

    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("select app_review_private.validate_project_task_vendor()"),
      /permission denied/
    );

    await db.exec("reset role");

    const indexes = (await db.query("select indexname from pg_indexes where schemaname='public' and tablename='project_tasks' and indexname like 'project_tasks_vendor_%' order by indexname")).rows.map(row => row.indexname);
    assert.deepEqual(indexes, ["project_tasks_vendor_company", "project_tasks_vendor_fk"]);
  } finally {
    await db.close();
  }
});

test("every shared create-task entry point loads vendors and project task writes preserve the selection", async () => {
  const [hook, tasks, dashboard, clientDetail, leadDetail, projectStaff] = await Promise.all([
    readFile(new URL("../../src/hooks/useTaskVendors.js", import.meta.url), "utf8"),
    readFile(new URL("../../src/pages/Tasks.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../src/pages/Dashboard.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../src/pages/ClientDetail.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../src/pages/LeadDetail.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../src/components/pm/PMStaffTab.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(hook, /select\("id, name, category"\)/);
  assert.match(hook, /VENDOR_MANAGEMENT_ROLES\.includes\(role\)/);
  assert.match(hook, /company_id: companyId/);
  assert.doesNotMatch(tasks, /delete payload\.vendor_id/);
  assert.match(tasks, /taskPayload\.vendor_id = \(!payload\.vendor_id/);

  for (const source of [tasks, dashboard, clientDetail, leadDetail, projectStaff]) {
    assert.match(source, /useTaskVendors\(\{ companyId, role: profile\?\.role \}\)/);
    assert.match(source, /vendors=\{vendors\}/);
    assert.match(source, /onCreateVendor=\{canCreateVendor \? createVendor : undefined\}/);
  }

  for (const source of [dashboard, clientDetail, projectStaff]) {
    assert.match(source, /vendor_id: \(!payload\.vendor_id \|\| payload\.vendor_id === "none"\) \? null : payload\.vendor_id/);
  }
});
