import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const schema = await readFile(new URL("../notifications/schema.sql", import.meta.url), "utf8");
const peopleSchema = await readFile(new URL("../notifications/people-schema.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../../supabase/migrations/20261006160202_employee_portal_authorization_guardrails.sql", import.meta.url), "utf8");

const id = value => `10000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const COMPANY = id(1);
const OTHER_COMPANY = id(2);
const OWNER = id(10);
const ADMIN = id(11);
const OFFICE = id(12);
const MANAGER = id(13);
const EMPLOYEE = id(14);
const WORKER = id(15);
const INACTIVE = id(16);
const REPORTER = id(17);
const OUTSIDER = id(20);
const PROJECT = id(30);
const OTHER_PROJECT = id(31);
const FOREIGN_PROJECT = id(32);
const CLIENT = id(33);
const FOREIGN_CLIENT = id(34);
const LEAD = id(35);
const FOREIGN_LEAD = id(36);
const ASSIGNED_PROJECT_TASK = id(40);
const OTHER_PROJECT_TASK = id(41);
const FOREIGN_PROJECT_TASK = id(42);
const ASSIGNED_LEGACY_TASK = id(43);
const OTHER_LEGACY_TASK = id(44);
const OWN_EXPENSE = id(50);
const OTHER_EXPENSE = id(51);
const FOREIGN_EXPENSE = id(52);
const OWN_TIME_ENTRY = id(60);
const LEGACY_TIME_ENTRY = id(61);
const OTHER_TIME_ENTRY = id(62);
const FOREIGN_TIME_ENTRY = id(63);
const OWN_TIME_OFF = id(70);
const OTHER_TIME_OFF = id(71);
const FOREIGN_TIME_OFF = id(72);
const OWN_LOG = id(80);
const OTHER_LOG = id(81);
const FOREIGN_LOG = id(82);
const OWN_INVENTORY_TRANSACTION = id(90);
const LEGACY_INVENTORY_TRANSACTION = id(91);
const OTHER_INVENTORY_TRANSACTION = id(92);
const FOREIGN_INVENTORY_TRANSACTION = id(93);

async function setup() {
  const db = new PGlite();
  await db.exec(schema);
  await db.exec(peopleSchema);
  await db.exec(`
    alter table public.time_entries add column if not exists user_id uuid;
    alter table public.time_off_requests add column if not exists user_id uuid;
    alter table public.time_off_requests add column if not exists approved_by text;
    alter table public.inventory_transactions add column if not exists user_id uuid;
    alter table public.notifications add column if not exists event_key text;

    create table public.users(
      id uuid primary key,
      company_id uuid,
      full_name text,
      email text,
      role text,
      is_active boolean default true
    );
    grant select,insert,update,delete on public.users to authenticated;

    create schema notification_private;
    grant usage on schema notification_private to authenticated,service_role;

    create schema storage;
    grant usage on schema storage to anon,authenticated,service_role;
    create table storage.buckets(
      id text primary key,
      public boolean default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects(
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null,
      name text not null,
      owner_id text,
      metadata jsonb default '{}'::jsonb
    );
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
    grant all on storage.objects,storage.buckets to service_role;
    grant select on storage.buckets to anon,authenticated;
    insert into storage.buckets(id,public) values('receipts',true),('daily_logs',true);

    create policy "Allow public uploads to daily logs" on storage.objects for insert to public with check(bucket_id='daily_logs');
    create policy "Allow public uploads to receipts" on storage.objects for insert to public with check(bucket_id='receipts');
    create policy "Allow public viewing of daily logs" on storage.objects for select to public using(bucket_id='daily_logs');
    create policy "Allow public viewing of receipts" on storage.objects for select to public using(bucket_id='receipts');

    alter table public.profiles enable row level security;
    create policy legacy_profiles_open on public.profiles for all to authenticated using(true) with check(true);
    alter table public.users enable row level security;
    create policy legacy_users_open on public.users for all to authenticated using(true) with check(true);
    create schema app_review_private;
    create function app_review_private.member_company() returns uuid language sql stable security definer set search_path='' as $$
      select company_id from public.profiles where id=auth.uid() and is_active is distinct from false
    $$;
    grant usage on schema app_review_private to authenticated;
    grant execute on function app_review_private.member_company() to authenticated;
    create policy review_company_boundary on public.users as restrictive for all to authenticated
      using(company_id=(select app_review_private.member_company()))
      with check(company_id=(select app_review_private.member_company()));
    alter table public.companies enable row level security;
    grant select,update on public.companies to authenticated;
    create policy legacy_company_access on public.companies for all to authenticated using(true) with check(true);
  `);
  await db.exec(migration);
  await db.exec(`
    insert into public.companies(id,name,plan_id,settings) values
      ('${COMPANY}','Primary company','business','{"features":{"tasks":true}}'),
      ('${OTHER_COMPANY}','Other company','business','{}');
    insert into public.profiles(id,company_id,full_name,email,role,permissions,is_active) values
      ('${OWNER}','${COMPANY}','Owner','owner@example.invalid','owner','[]',true),
      ('${ADMIN}','${COMPANY}','Administrator','admin@example.invalid','admin','[]',true),
      ('${OFFICE}','${COMPANY}','Office User','office@example.invalid','office','["tasks","projects","human_resources","reports","DailyLogs","inventory"]',true),
      ('${MANAGER}','${COMPANY}','Manager User','manager@example.invalid','manager','["tasks","projects","settings"]',true),
      ('${EMPLOYEE}','${COMPANY}','Field Employee','field@example.invalid','employee','[]',true),
      ('${WORKER}','${COMPANY}','Other Worker','worker@example.invalid','employee','[]',true),
      ('${INACTIVE}','${COMPANY}','Inactive Worker','inactive@example.invalid','employee','[]',false),
      ('${REPORTER}','${COMPANY}','Reports Manager','reporter@example.invalid','manager','["reports"]',true),
      ('${OUTSIDER}','${OTHER_COMPANY}','Other Tenant','outsider@example.invalid','admin','[]',true);
    insert into public.users(id,company_id,full_name,email,role,is_active)
      select id,company_id,full_name,email,role,is_active from public.profiles;
    insert into public.projects(id,company_id,name,status) values
      ('${PROJECT}','${COMPANY}','Assigned project','Active'),
      ('${OTHER_PROJECT}','${COMPANY}','Other project','Active'),
      ('${FOREIGN_PROJECT}','${OTHER_COMPANY}','Foreign project','Active');
    insert into public.clients(id,company_id,name) values
      ('${CLIENT}','${COMPANY}','Primary client'),
      ('${FOREIGN_CLIENT}','${OTHER_COMPANY}','Foreign client');
    insert into public.leads(id,company_id,contact_name) values
      ('${LEAD}','${COMPANY}','Primary lead'),
      ('${FOREIGN_LEAD}','${OTHER_COMPANY}','Foreign lead');
    insert into public.project_staff(company_id,project_id,user_id,is_active) values
      ('${COMPANY}','${PROJECT}','${MANAGER}',true),
      ('${COMPANY}','${PROJECT}','${EMPLOYEE}',true);
    insert into public.project_tasks(id,company_id,project_id,title,status,assigned_to) values
      ('${ASSIGNED_PROJECT_TASK}','${COMPANY}','${PROJECT}','Assigned project task','To Do',array['${EMPLOYEE}'::uuid]),
      ('${OTHER_PROJECT_TASK}','${COMPANY}','${OTHER_PROJECT}','Other worker task','To Do',array['${WORKER}'::uuid]),
      ('${FOREIGN_PROJECT_TASK}','${OTHER_COMPANY}','${FOREIGN_PROJECT}','Foreign task','To Do',array['${EMPLOYEE}'::uuid]);
    insert into public.tasks(id,company_id,project_id,title,status,assigned_to) values
      ('${ASSIGNED_LEGACY_TASK}','${COMPANY}','${PROJECT}','Assigned legacy task','To Do','field@example.invalid'),
      ('${OTHER_LEGACY_TASK}','${COMPANY}','${PROJECT}','Substring must not match','To Do','prefix-${EMPLOYEE}-suffix');
    insert into public.expenses(id,company_id,user_id,user_email,employee_name,date,amount,description,status) values
      ('${OWN_EXPENSE}','${COMPANY}','${EMPLOYEE}','field@example.invalid','Field Employee','2026-10-01',25,'Own expense','Submitted'),
      ('${OTHER_EXPENSE}','${COMPANY}','${WORKER}','worker@example.invalid','Other Worker','2026-10-01',30,'Other expense','Submitted'),
      ('${FOREIGN_EXPENSE}','${OTHER_COMPANY}','${OUTSIDER}','outsider@example.invalid','Other Tenant','2026-10-01',35,'Foreign expense','Submitted');
    insert into public.time_entries(id,company_id,project_id,user_id,employee_name,date,total_hours,entry_type,status) values
      ('${OWN_TIME_ENTRY}','${COMPANY}','${PROJECT}','${EMPLOYEE}','Field Employee','2026-10-01',8,'Manual','Pending'),
      ('${LEGACY_TIME_ENTRY}','${COMPANY}','${PROJECT}',null,'Field Employee','2026-10-02',4,'Manual','Approved'),
      ('${OTHER_TIME_ENTRY}','${COMPANY}','${OTHER_PROJECT}','${WORKER}','Other Worker','2026-10-01',7,'Manual','Pending'),
      ('${FOREIGN_TIME_ENTRY}','${OTHER_COMPANY}','${FOREIGN_PROJECT}','${OUTSIDER}','Other Tenant','2026-10-01',6,'Manual','Pending');
    insert into public.time_off_requests(id,company_id,user_id,employee_name,type,start_date,end_date,total_days,reason,status) values
      ('${OWN_TIME_OFF}','${COMPANY}','${EMPLOYEE}','Field Employee','Vacation','2026-11-01','2026-11-02',2,'Personal','Pending'),
      ('${OTHER_TIME_OFF}','${COMPANY}','${WORKER}','Other Worker','Vacation','2026-11-03','2026-11-03',1,'Personal','Pending'),
      ('${FOREIGN_TIME_OFF}','${OTHER_COMPANY}','${OUTSIDER}','Other Tenant','Vacation','2026-11-04','2026-11-04',1,'Personal','Pending');
    insert into public.project_daily_logs(id,company_id,project_id,user_id,date,summary) values
      ('${OWN_LOG}','${COMPANY}','${PROJECT}','${EMPLOYEE}','2026-10-01','Own assigned log'),
      ('${OTHER_LOG}','${COMPANY}','${OTHER_PROJECT}','${WORKER}','2026-10-01','Other project log'),
      ('${FOREIGN_LOG}','${OTHER_COMPANY}','${FOREIGN_PROJECT}','${OUTSIDER}','2026-10-01','Foreign log');
    insert into public.inventory_transactions(id,company_id,user_id,employee_name,project_name,quantity_changed,transaction_type) values
      ('${OWN_INVENTORY_TRANSACTION}','${COMPANY}','${EMPLOYEE}','Field Employee','Assigned project',-1,'consume'),
      ('${LEGACY_INVENTORY_TRANSACTION}','${COMPANY}',null,'Field Employee','Assigned project',-2,'consume'),
      ('${OTHER_INVENTORY_TRANSACTION}','${COMPANY}','${WORKER}','Other Worker','Other project',-1,'consume'),
      ('${FOREIGN_INVENTORY_TRANSACTION}','${OTHER_COMPANY}','${OUTSIDER}','Other Tenant','Foreign project',-1,'consume');
  `);

  const actor = async (user, role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)", [user || "", role]);
    await db.exec(`set role ${role}`);
  };
  const root = async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','',false)");
  };
  return { db, actor, root };
}

const values = result => result.rows.map(row => Object.values(row)[0]);

test("field users see exact assigned tasks and may change status only", async () => {
  const { db, actor, root } = await setup();
  try {
    await actor(EMPLOYEE);
    assert.deepEqual(values(await db.query("select id from public.project_tasks order by id")), [ASSIGNED_PROJECT_TASK]);
    assert.deepEqual(values(await db.query("select id from public.tasks order by id")), [ASSIGNED_LEGACY_TASK]);

    assert.equal((await db.query("update public.project_tasks set status='Done' where id=$1 returning status", [ASSIGNED_PROJECT_TASK])).rows[0].status, "Done");
    await assert.rejects(
      db.query("update public.project_tasks set title='Changed by field user' where id=$1", [ASSIGNED_PROJECT_TASK]),
      /status only/i,
    );
    assert.equal((await db.query("update public.project_tasks set status='Done' where id=$1 returning id", [OTHER_PROJECT_TASK])).rows.length, 0);
    await assert.rejects(
      db.query("insert into public.project_tasks(company_id,project_id,title,status,assigned_to) values($1,$2,'Unauthorized insert','To Do',array[$3::uuid])", [COMPANY, PROJECT, EMPLOYEE]),
      /row-level security|policy/i,
    );

    await root();
    assert.equal((await db.query("select title from public.project_tasks where id=$1", [ASSIGNED_PROJECT_TASK])).rows[0].title, "Assigned project task");
  } finally {
    await db.close();
  }
});

test("office and admin task workflows remain available while anonymous and cross-company access are denied", async () => {
  const { db, actor } = await setup();
  try {
    await actor(OFFICE);
    assert.deepEqual(new Set(values(await db.query("select id from public.project_tasks"))), new Set([ASSIGNED_PROJECT_TASK, OTHER_PROJECT_TASK]));
    assert.equal((await db.query("update public.project_tasks set title='Office update' where id=$1 returning title", [OTHER_PROJECT_TASK])).rows[0].title, "Office update");

    await actor(ADMIN);
    assert.equal((await db.query("delete from public.project_tasks where id=$1 returning id", [OTHER_PROJECT_TASK])).rows.length, 1);

    await actor(OUTSIDER);
    assert.deepEqual(values(await db.query("select id from public.project_tasks")), [FOREIGN_PROJECT_TASK]);

    await actor(null, "anon");
    await assert.rejects(db.query("select id from public.project_tasks"), /permission denied/i);
    await assert.rejects(db.query("update public.project_tasks set status='Done' where id=$1", [ASSIGNED_PROJECT_TASK]), /permission denied/i);
  } finally {
    await db.close();
  }
});

test("authorization migration is idempotent and narrows direct table privileges to required CRUD", async () => {
  const { db } = await setup();
  try {
    await db.exec(migration);
    const tables = [
      "tasks", "project_tasks", "expenses", "time_entries", "time_off_requests",
      "project_daily_logs", "profiles", "users", "inventory_transactions",
    ];
    for (const table of tables) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        assert.equal(
          (await db.query("select has_table_privilege('authenticated',$1,$2) allowed", [`public.${table}`, privilege])).rows[0].allowed,
          true,
          `authenticated retains ${privilege} on public.${table}`,
        );
      }
      for (const privilege of ["TRUNCATE", "TRIGGER", "REFERENCES"]) {
        assert.equal(
          (await db.query("select has_table_privilege('authenticated',$1,$2) allowed", [`public.${table}`, privilege])).rows[0].allowed,
          false,
          `authenticated cannot use ${privilege} on public.${table}`,
        );
      }
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "TRIGGER", "REFERENCES"]) {
        assert.equal(
          (await db.query("select has_table_privilege('anon',$1,$2) allowed", [`public.${table}`, privilege])).rows[0].allowed,
          false,
          `anon cannot use ${privilege} on public.${table}`,
        );
      }
    }
  } finally {
    await db.close();
  }
});

test("task workflow comments follow exact assignment while structural writes remain management-only", async () => {
  const { db, actor } = await setup();
  const access = async (table, taskId, write) => (
    await db.query("select notification_private.people_task_access($1,$2,$3) allowed", [table, taskId, write])
  ).rows[0].allowed;
  try {
    await actor(EMPLOYEE);
    assert.equal(await access("project_tasks", ASSIGNED_PROJECT_TASK, false), true, "Assigned field users can read/comment on the project task.");
    assert.equal(await access("project_tasks", ASSIGNED_PROJECT_TASK, true), false, "Field users cannot change dependencies or task structure.");
    assert.equal(await access("project_tasks", OTHER_PROJECT_TASK, false), false);
    assert.equal(await access("tasks", ASSIGNED_LEGACY_TASK, false), true, "Exact legacy email assignment remains supported.");
    assert.equal(await access("tasks", OTHER_LEGACY_TASK, false), false, "Substring assignment never grants comment access.");

    await actor(OFFICE);
    assert.equal(await access("project_tasks", OTHER_PROJECT_TASK, true), true);
    assert.equal(await access("tasks", ASSIGNED_LEGACY_TASK, true), true);

    await actor(MANAGER);
    assert.equal(await access("project_tasks", ASSIGNED_PROJECT_TASK, true), true, "An assigned manager with project permission retains workflow editing.");
    assert.equal(await access("project_tasks", OTHER_PROJECT_TASK, true), false, "Manager project scope remains enforced.");

    await actor(OUTSIDER);
    assert.equal(await access("project_tasks", ASSIGNED_PROJECT_TASK, false), false);
    await actor(INACTIVE);
    assert.equal(await access("project_tasks", ASSIGNED_PROJECT_TASK, false), false);
  } finally {
    await db.close();
  }
});

test("employees manage only their own submitted expenses while authorized office review remains intact", async () => {
  const { db, actor, root } = await setup();
  try {
    await actor(EMPLOYEE);
    assert.deepEqual(values(await db.query("select id from public.expenses order by id")), [OWN_EXPENSE]);
    const inserted = await db.query(`insert into public.expenses(company_id,user_id,date,amount,description,status)
      values($1,$2,'2026-10-02',12.50,'Parking','Submitted') returning user_email,employee_name`, [COMPANY, EMPLOYEE]);
    assert.deepEqual(inserted.rows[0], { user_email: "field@example.invalid", employee_name: "Field Employee" });
    assert.equal((await db.query("update public.expenses set description='Updated receipt' where id=$1 returning description", [OWN_EXPENSE])).rows[0].description, "Updated receipt");
    await assert.rejects(db.query("update public.expenses set admin_notes='Self approved' where id=$1", [OWN_EXPENSE]), /claim details|office staff/i);
    await assert.rejects(
      db.query("insert into public.expenses(company_id,user_id,date,amount,description,status) values($1,$2,'2026-10-02',10,'Spoofed','Submitted')", [COMPANY, WORKER]),
      /row-level security|own expense|policy/i,
    );

    await actor(OFFICE);
    assert.equal((await db.query("select count(*)::int n from public.expenses")).rows[0].n, 3);
    assert.equal((await db.query("update public.expenses set status='Approved',admin_notes='Reviewed' where id=$1 returning status", [OTHER_EXPENSE])).rows[0].status, "Approved");

    await root();
    assert.equal((await db.query("select status from public.expenses where id=$1", [OTHER_EXPENSE])).rows[0].status, "Approved");
  } finally {
    await db.close();
  }
});

test("time entries enforce own clock-in and clock-out invariants while preserving HR review", async () => {
  const { db, actor } = await setup();
  try {
    await actor(EMPLOYEE);
    assert.deepEqual(values(await db.query("select id from public.time_entries order by id")), [OWN_TIME_ENTRY, LEGACY_TIME_ENTRY]);

    const clockedIn = await db.query(`insert into public.time_entries(
      company_id,project_id,user_id,date,total_hours,clock_in,entry_type,status,qbo_sync_status
    ) values($1,$2,$3,'2026-10-06',0,now()-interval '1 hour','Clock','Clocked In','none')
      returning id,employee_name`, [COMPANY, PROJECT, EMPLOYEE]);
    assert.equal(clockedIn.rows[0].employee_name, "Field Employee");
    const clockId = clockedIn.rows[0].id;
    const clockedOut = await db.query(`update public.time_entries
      set clock_out=clock_in+interval '1 hour',total_hours=1,status='Pending'
      where id=$1 returning status,total_hours`, [clockId]);
    assert.equal(clockedOut.rows[0].status, "Pending");
    assert.equal(Number(clockedOut.rows[0].total_hours), 1);

    await assert.rejects(
      db.query(`insert into public.time_entries(company_id,user_id,date,total_hours,entry_type,status)
        values($1,$2,'2026-10-06',8,'Manual','Approved')`, [COMPANY, EMPLOYEE]),
      /pending HR review/i,
    );
    await assert.rejects(
      db.query("update public.time_entries set notes='Changed after submission' where id=$1", [OWN_TIME_ENTRY]),
      /clock out their own active shift/i,
    );
    assert.equal((await db.query("delete from public.time_entries where id=$1 returning id", [OWN_TIME_ENTRY])).rows.length, 0);

    await actor(OFFICE);
    assert.equal((await db.query("select count(*)::int n from public.time_entries")).rows[0].n, 4);
    assert.equal((await db.query("update public.time_entries set status='Approved',approved_by='Office User' where id=$1 returning status", [OTHER_TIME_ENTRY])).rows[0].status, "Approved");

    await actor(OUTSIDER);
    assert.deepEqual(values(await db.query("select id from public.time_entries order by id")), [FOREIGN_TIME_ENTRY]);
    await actor(INACTIVE);
    assert.equal((await db.query("select count(*)::int n from public.time_entries")).rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test("time off is own-only for employees and reviewable only through HR access", async () => {
  const { db, actor } = await setup();
  try {
    await actor(EMPLOYEE);
    assert.deepEqual(values(await db.query("select id from public.time_off_requests order by id")), [OWN_TIME_OFF]);
    const inserted = await db.query(`insert into public.time_off_requests(
      company_id,type,start_date,end_date,total_days,reason,status
    ) values($1,'Vacation','2026-12-01','2026-12-02',2,'Family','Pending')
      returning id,user_id,employee_name`, [COMPANY]);
    assert.equal(inserted.rows[0].user_id, EMPLOYEE);
    assert.equal(inserted.rows[0].employee_name, "Field Employee");
    await assert.rejects(
      db.query("update public.time_off_requests set reason='Changed scope' where id=$1", [OWN_TIME_OFF]),
      /cancel only your own pending time off/i,
    );
    assert.equal((await db.query("update public.time_off_requests set status='Cancelled' where id=$1 returning status", [OWN_TIME_OFF])).rows[0].status, "Cancelled");
    await assert.rejects(
      db.query(`insert into public.time_off_requests(company_id,user_id,type,start_date,end_date,status)
        values($1,$2,'Vacation','2026-12-03','2026-12-04','Approved')`, [COMPANY, EMPLOYEE]),
      /own pending time off/i,
    );

    await actor(OFFICE);
    assert.equal((await db.query("select count(*)::int n from public.time_off_requests")).rows[0].n, 3);
    assert.equal((await db.query("update public.time_off_requests set status='Approved',approved_by='Office User' where id=$1 returning status", [OTHER_TIME_OFF])).rows[0].status, "Approved");

    await actor(OUTSIDER);
    assert.deepEqual(values(await db.query("select id from public.time_off_requests order by id")), [FOREIGN_TIME_OFF]);
    await actor(INACTIVE);
    assert.equal((await db.query("select count(*)::int n from public.time_off_requests")).rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test("daily logs enforce assignment, management context, and referenced tenant integrity", async () => {
  const { db, actor } = await setup();
  try {
    await actor(EMPLOYEE);
    assert.deepEqual(values(await db.query("select id from public.project_daily_logs order by id")), [OWN_LOG]);
    const inserted = await db.query(`insert into public.project_daily_logs(company_id,project_id,date,summary)
      values($1,$2,'2026-10-06','Walkthrough complete') returning id,user_id`, [COMPANY, PROJECT]);
    assert.equal(inserted.rows[0].user_id, EMPLOYEE);
    assert.equal((await db.query("update public.project_daily_logs set summary='Edited' where id=$1 returning id", [OWN_LOG])).rows.length, 0);
    await assert.rejects(
      db.query(`insert into public.project_daily_logs(company_id,project_id,date,summary)
        values($1,$2,'2026-10-06','Unassigned project')`, [COMPANY, OTHER_PROJECT]),
      /row-level security|daily log access/i,
    );
    assert.equal((await db.query("delete from public.project_daily_logs where id=$1 returning id", [inserted.rows[0].id])).rows.length, 1);

    await actor(MANAGER);
    assert.deepEqual(values(await db.query("select id from public.project_daily_logs order by id")), [OWN_LOG]);
    await assert.rejects(
      db.query(`insert into public.project_daily_logs(company_id,project_id,user_id,date,summary)
        values($1,$2,$3,'2026-10-06','Spoofed author')`, [COMPANY, PROJECT, WORKER]),
      /signed-in author/i,
    );
    await assert.rejects(
      db.query("update public.project_daily_logs set user_id=$1 where id=$2", [MANAGER, OWN_LOG]),
      /identity and author cannot be changed/i,
    );
    assert.equal((await db.query(`insert into public.project_daily_logs(company_id,project_id,date,summary)
      values($1,$2,'2026-10-06','Manager project note') returning user_id`, [COMPANY, PROJECT])).rows[0].user_id, MANAGER);
    await assert.rejects(
      db.query(`insert into public.project_daily_logs(company_id,lead_id,date,summary)
        values($1,$2,'2026-10-06','Lead note without permission')`, [COMPANY, LEAD]),
      /row-level security|daily log access/i,
    );

    await actor(ADMIN);
    await assert.rejects(
      db.query(`insert into public.project_daily_logs(company_id,client_id,date,summary)
        values($1,$2,'2026-10-06','Foreign client')`, [COMPANY, FOREIGN_CLIENT]),
      /client\/company mismatch/i,
    );
    await assert.rejects(
      db.query(`insert into public.project_daily_logs(company_id,lead_id,date,summary)
        values($1,$2,'2026-10-06','Foreign lead')`, [COMPANY, FOREIGN_LEAD]),
      /lead\/company mismatch/i,
    );

    await actor(OFFICE);
    assert.equal((await db.query("select count(*)::int n from public.project_daily_logs")).rows[0].n, 3);
    await actor(OUTSIDER);
    assert.deepEqual(values(await db.query("select id from public.project_daily_logs order by id")), [FOREIGN_LOG]);
    await actor(INACTIVE);
    assert.equal((await db.query("select count(*)::int n from public.project_daily_logs")).rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test("inventory history is personal in the field and writable only through authorized office workflows", async () => {
  const { db, actor } = await setup();
  try {
    await actor(EMPLOYEE);
    assert.deepEqual(values(await db.query("select id from public.inventory_transactions order by id")), [OWN_INVENTORY_TRANSACTION, LEGACY_INVENTORY_TRANSACTION]);
    await assert.rejects(
      db.query(`insert into public.inventory_transactions(company_id,user_id,employee_name,quantity_changed,transaction_type)
        values($1,$2,'Field Employee',-1,'consume')`, [COMPANY, EMPLOYEE]),
      /row-level security|policy/i,
    );
    assert.equal((await db.query("update public.inventory_transactions set notes='Changed' where id=$1 returning id", [OWN_INVENTORY_TRANSACTION])).rows.length, 0);

    await actor(OFFICE);
    assert.equal((await db.query("select count(*)::int n from public.inventory_transactions")).rows[0].n, 3);
    const officeWrite = await db.query(`insert into public.inventory_transactions(
      company_id,user_id,employee_name,quantity_changed,transaction_type
    ) values($1,$2,'Other Worker',2,'refund') returning id`, [COMPANY, WORKER]);
    assert.equal((await db.query("delete from public.inventory_transactions where id=$1 returning id", [officeWrite.rows[0].id])).rows.length, 1);

    await actor(MANAGER);
    assert.equal((await db.query("select count(*)::int n from public.inventory_transactions")).rows[0].n, 0);
    await actor(REPORTER);
    assert.equal((await db.query("select count(*)::int n from public.inventory_transactions")).rows[0].n, 3, "Reports-only managers retain material usage reporting.");
    await assert.rejects(
      db.query(`insert into public.inventory_transactions(company_id,user_id,employee_name,quantity_changed,transaction_type)
        values($1,$2,'Other Worker',-1,'consume')`, [COMPANY, WORKER]),
      /row-level security|policy/i,
    );
    await actor(OUTSIDER);
    assert.deepEqual(values(await db.query("select id from public.inventory_transactions order by id")), [FOREIGN_INVENTORY_TRANSACTION]);
    await actor(INACTIVE);
    assert.equal((await db.query("select count(*)::int n from public.inventory_transactions")).rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test("inactive profiles retain only the self-read needed for sign-out and lose operational access", async () => {
  const { db, actor } = await setup();
  try {
    await actor(INACTIVE);
    assert.deepEqual(values(await db.query("select id from public.profiles order by id")), [INACTIVE]);
    assert.deepEqual(values(await db.query("select id from public.users order by id")), []);
    assert.equal((await db.query("select count(*)::int n from public.project_tasks")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from public.expenses")).rows[0].n, 0);
    await assert.rejects(
      db.query("update public.companies set settings='{}' where id=$1 returning id", [COMPANY]),
      /company settings access denied|active company/i,
    );
    await assert.rejects(
      db.query("insert into storage.objects(bucket_id,name) values('receipts',$1)", [`${COMPANY}/${INACTIVE}/blocked.jpg`]),
      /row-level security|policy/i,
    );
  } finally {
    await db.close();
  }
});

test("profile updates separate self-service, HR rate changes, and administrator access fields", async () => {
  const { db, actor, root } = await setup();
  try {
    await actor(EMPLOYEE);
    const self = await db.query(`update public.profiles set
      full_name='Field Employee Updated', phone='555-0100', dashboard_layout='{"compact":true}',
      onboarding_completed=true, notify_action_required_only=true
      where id=$1 returning full_name,phone,onboarding_completed,notify_action_required_only`, [EMPLOYEE]);
    assert.deepEqual(self.rows[0], {
      full_name: "Field Employee Updated",
      phone: "555-0100",
      onboarding_completed: true,
      notify_action_required_only: true,
    });
    for (const [column, expression] of [
      ["role", "'admin'"],
      ["permissions", "'[\"settings\"]'::jsonb"],
      ["company_id", `'${OTHER_COMPANY}'::uuid`],
      ["is_active", "false"],
      ["hourly_rate", "99"],
    ]) {
      await assert.rejects(
        db.query(`update public.profiles set ${column}=${expression} where id=$1`, [EMPLOYEE]),
        /company administrator|profile company|access/i,
        `Employee cannot change ${column}.`,
      );
    }

    await actor(OFFICE);
    assert.equal(Number((await db.query("update public.profiles set hourly_rate=45 where id=$1 returning hourly_rate", [WORKER])).rows[0].hourly_rate), 45);
    for (const [column, expression] of [["role", "'manager'"], ["permissions", "'[\"projects\"]'::jsonb"]]) {
      await assert.rejects(
        db.query(`update public.profiles set ${column}=${expression} where id=$1`, [WORKER]),
        /hourly rate/i,
        `HR-authorized office cannot change ${column}.`,
      );
    }

    await actor(ADMIN);
    const adminUpdate = await db.query("update public.profiles set role='manager',permissions='[\"projects\"]',hourly_rate=55,is_active=false where id=$1 returning role,hourly_rate,is_active", [WORKER]);
    assert.deepEqual({ ...adminUpdate.rows[0], hourly_rate: Number(adminUpdate.rows[0].hourly_rate) }, { role: "manager", hourly_rate: 55, is_active: false });
    assert.equal((await db.query("update public.profiles set hourly_rate=70 where id=$1 returning id", [OUTSIDER])).rows.length, 0, "Admin cannot cross the company boundary.");

    await actor(OWNER);
    const ownerUpdate = await db.query("update public.profiles set role='subcontractor',permissions='[\"projects\"]',hourly_rate=65 where id=$1 returning role,hourly_rate", [EMPLOYEE]);
    assert.deepEqual({ ...ownerUpdate.rows[0], hourly_rate: Number(ownerUpdate.rows[0].hourly_rate) }, { role: "subcontractor", hourly_rate: 65 });

    await actor(INACTIVE);
    assert.equal((await db.query("update public.profiles set phone='555-9999' where id=$1 returning id", [INACTIVE])).rows.length, 0);

    await root();
    const unchanged = (await db.query("select company_id,is_active from public.profiles where id=$1", [EMPLOYEE])).rows[0];
    assert.equal(unchanged.company_id, COMPANY);
    assert.equal(unchanged.is_active, true);
  } finally {
    await db.close();
  }
});

test("company settings separate manager-visible keys from owner and admin controls", async () => {
  const { db, actor, root } = await setup();
  try {
    await actor(EMPLOYEE);
    await assert.rejects(
      db.query("update public.companies set settings='{" + '"features":{"tasks":false}' + "}'::jsonb where id=$1", [COMPANY]),
      /company settings access denied/i,
    );
    await actor(OFFICE);
    await assert.rejects(
      db.query("update public.companies set settings='{" + '"features":{"tasks":false}' + "}'::jsonb where id=$1", [COMPANY]),
      /company settings access denied/i,
    );
    await actor(MANAGER);
    assert.equal((await db.query(`update public.companies
      set settings=jsonb_set(settings,'{quote_intro}','"Manager intro"'::jsonb,true)
      where id=$1 returning settings->>'quote_intro' value`, [COMPANY])).rows[0].value, "Manager intro");
    await assert.rejects(
      db.query(`update public.companies
        set settings=jsonb_set(settings,'{features,tasks}','false'::jsonb,true) where id=$1`, [COMPANY]),
      /manager-visible settings/i,
    );
    await assert.rejects(
      db.query(`update public.companies
        set settings=jsonb_set(settings,'{pdf}','{}'::jsonb,true) where id=$1`, [COMPANY]),
      /manager-visible settings/i,
    );
    await actor(OWNER);
    assert.equal((await db.query(`update public.companies
      set settings=jsonb_set(settings,'{pdf}','{"accent":"yellow"}'::jsonb,true)
      where id=$1 returning settings#>>'{pdf,accent}' value`, [COMPANY])).rows[0].value, "yellow");
    await actor(ADMIN);
    assert.equal((await db.query("update public.companies set settings='{" + '"features":{"tasks":false}' + "}'::jsonb where id=$1 returning id", [COMPANY])).rows.length, 1);
    await root();
    assert.equal((await db.query("select settings#>>'{features,tasks}' value from public.companies where id=$1", [COMPANY])).rows[0].value, "false");
  } finally {
    await db.close();
  }
});

test("storage policies bind active users to their own folder and configure safe upload types and sizes", async () => {
  const { db, actor } = await setup();
  try {
    await actor(EMPLOYEE);
    for (const [bucket, name] of [
      ["receipts", `${COMPANY}/${EMPLOYEE}/receipt.jpg`],
      ["receipts", `${EMPLOYEE}/legacy-receipt.pdf`],
      ["daily_logs", `${COMPANY}/${EMPLOYEE}/site-photo.webp`],
    ]) {
      assert.equal((await db.query("insert into storage.objects(bucket_id,name) values($1,$2) returning name", [bucket, name])).rows[0].name, name);
    }
    await assert.rejects(
      db.query("insert into storage.objects(bucket_id,name) values('receipts',$1)", [`${COMPANY}/${WORKER}/spoofed.jpg`]),
      /row-level security|policy/i,
    );
    await assert.rejects(
      db.query("insert into storage.objects(bucket_id,name) values('other',$1)", [`${COMPANY}/${EMPLOYEE}/wrong-bucket.jpg`]),
      /row-level security|policy/i,
    );
    assert.equal((await db.query("select count(*)::int n from storage.objects")).rows[0].n, 3);

    await actor(OFFICE);
    assert.equal((await db.query("select count(*)::int n from storage.objects")).rows[0].n, 3, "Office can review same-company employee media.");
    await assert.rejects(
      db.query("insert into storage.objects(bucket_id,name) values('receipts',$1)", [`${COMPANY}/${EMPLOYEE}/office-spoof.jpg`]),
      /row-level security|policy/i,
    );

    await actor(null, "anon");
    assert.equal((await db.query("select count(*)::int n from storage.objects")).rows[0].n, 0, "Public bucket downloads do not expose object listing.");
    await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('receipts','anonymous/file.jpg')"), /row-level security|policy/i);

    await actor(ADMIN);
    const buckets = await db.query("select id,file_size_limit,allowed_mime_types from storage.buckets order by id");
    const daily = buckets.rows.find(row => row.id === "daily_logs");
    const receipts = buckets.rows.find(row => row.id === "receipts");
    assert.equal(Number(daily.file_size_limit), 10 * 1024 * 1024);
    assert.equal(Number(receipts.file_size_limit), 10 * 1024 * 1024);
    assert.ok(daily.allowed_mime_types.includes("image/webp"));
    assert.equal(daily.allowed_mime_types.includes("image/gif"), false);
    assert.equal(daily.allowed_mime_types.includes("application/pdf"), false);
    assert.ok(receipts.allowed_mime_types.includes("application/pdf"));
  } finally {
    await db.close();
  }
});
