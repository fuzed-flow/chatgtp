import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  new URL("../../supabase/migrations/20261006191000_secure_public_invoice_workflow.sql", import.meta.url),
  "utf8",
);

const COMPANY_A = "10000000-0000-4000-8000-000000000001";
const COMPANY_B = "20000000-0000-4000-8000-000000000001";
const CLIENT_A = "10000000-0000-4000-8000-000000000002";
const CLIENT_B = "20000000-0000-4000-8000-000000000002";
const USER_A = "10000000-0000-4000-8000-000000000003";
const USER_B = "20000000-0000-4000-8000-000000000003";
const INACTIVE_USER = "10000000-0000-4000-8000-000000000013";
const MANAGER_USER = "10000000-0000-4000-8000-000000000023";
const INVOICE_A = "10000000-0000-4000-8000-000000000004";
const INVOICE_A_SECOND = "10000000-0000-4000-8000-000000000014";
const INVOICE_B = "20000000-0000-4000-8000-000000000004";
const DRAFT_INVOICE = "10000000-0000-4000-8000-000000000024";
const PROJECT_A = "10000000-0000-4000-8000-000000000005";
const PHASE_A = "10000000-0000-4000-8000-000000000006";
const ITEM_A = "10000000-0000-4000-8000-000000000007";
const SCHEDULE_A = "10000000-0000-4000-8000-000000000008";
const PAYMENT_A = "10000000-0000-4000-8000-000000000009";

const OLD_TEMPLATE = "Hi {{client_name}},\n\nPlease find attached Invoice {{invoice_number}} for the amount of ${{balance_due}}.\n\nYou can view your interactive invoice history, milestones, and secure credit card payment options online using the link provided.";
const NEW_TEMPLATE = "Hi {{client_name}},\n\nYour invoice {{invoice_number}} for ${{balance_due}} is ready to review.\n\nUse the private secure link below to view the detailed invoice and payment options.";

const schema = `
create role anon;
create role authenticated;
create role service_role;

create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;

-- PGlite does not bundle pgcrypto. This deterministic 32-byte test double lets
-- the migration exercise digest-only storage; production uses pgcrypto SHA-256.
create schema extensions;
create function extensions.digest(value text, algorithm text)
returns bytea language sql immutable as $$
  select substring(convert_to(value, 'UTF8') from 1 for 32)
$$;
create function extensions.hmac(value text, secret text, algorithm text)
returns bytea language sql immutable as $$
  select decode(md5(value || secret) || md5(secret || value), 'hex')
$$;

create schema app_review_private;
create schema notification_private;
create function notification_private.server_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'notification_cron_secret',
    'test-reminder-secret-that-is-longer-than-thirty-two-characters'
  )
$$;

create table public.companies(
  id uuid primary key,
  name text,
  logo_url text,
  company_logo_url text,
  settings jsonb default '{}'::jsonb
);
create table public.clients(
  id uuid primary key,
  company_id uuid not null,
  name text,
  first_name text,
  surname text,
  billing_address text,
  site_address text
);
create table public.profiles(
  id uuid primary key,
  company_id uuid not null,
  role text,
  permissions jsonb default '[]'::jsonb,
  is_active boolean default true
);
create function app_review_private.member_company()
returns uuid language sql stable security definer set search_path = '' as $$
  select company_id from public.profiles
  where id = auth.uid() and is_active is distinct from false
$$;
create function app_review_private.module_allowed(module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid() and is_active is distinct from false
  )
$$;

create table public.projects(
  id uuid primary key,
  company_id uuid not null,
  client_id uuid,
  name text,
  project_number text,
  site_address text
);
create table public.invoices(
  id uuid primary key,
  company_id uuid not null,
  client_id uuid,
  quote_id uuid,
  project_id uuid,
  invoice_number text,
  status text default 'Draft',
  issue_date date,
  due_date date,
  site_address text,
  subtotal numeric default 0,
  tax numeric default 0,
  total numeric default 0,
  amount_paid numeric default 0,
  balance_due numeric default 0,
  deposit_amount numeric default 0,
  has_payment_schedule boolean default false,
  notes text,
  billing_address text,
  due_terms text,
  show_notes boolean default true,
  internal_notes text,
  discount_amount numeric default 0,
  discount_type text,
  change_order_id uuid,
  last_reminder_sent_at timestamptz,
  automation_stage integer,
  created_at timestamptz default now()
);
create table public.invoice_phases(
  id uuid primary key,
  company_id uuid not null,
  invoice_id uuid not null,
  phase_name text,
  scope_of_work text,
  internal_notes text,
  sort_order integer default 0
);
create table public.invoice_line_items(
  id uuid primary key,
  company_id uuid not null,
  invoice_id uuid not null,
  phase_id uuid,
  name text,
  description text,
  quantity numeric,
  unit text,
  unit_price numeric,
  unit_cost numeric,
  supplier text,
  amount numeric,
  line_total numeric,
  taxable boolean,
  display_order integer default 0,
  created_at timestamptz default now()
);
create table public.invoice_payment_schedules(
  id uuid primary key,
  company_id uuid not null,
  invoice_id uuid not null,
  payment_name text,
  due_event text,
  amount numeric,
  amount_paid numeric,
  status text,
  sort_order integer default 0,
  paid_date date,
  amount_type text,
  percentage numeric,
  due_date date,
  created_at timestamptz default now()
);
create table public.payments(
  id uuid primary key,
  company_id uuid not null,
  invoice_id uuid not null,
  schedule_item_id uuid,
  amount numeric,
  payment_method text,
  notes text,
  payment_date date,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  created_at timestamptz default now()
);

create function public.request_document_notification(p_document uuid, p_event text, p_message text default '')
returns boolean language sql security definer set search_path = '' as $$ select true $$;
create function public.handle_invoice_status_update()
returns trigger language plpgsql security definer as $$ begin return new; end $$;

alter table public.invoices enable row level security;
alter table public.invoice_phases enable row level security;
alter table public.invoice_line_items enable row level security;
alter table public.invoice_payment_schedules enable row level security;
alter table public.payments enable row level security;

create policy "Public can read Invoices if they have the ID"
  on public.invoices for select to anon using (true);
create policy "Public can read Invoice Phases if they have the ID"
  on public.invoice_phases for select to anon using (true);
create policy "Company users can manage invoice phases"
  on public.invoice_phases for all using (true) with check (true);
create policy "Public can read Invoice Line Items if they have the ID"
  on public.invoice_line_items for select to anon using (true);
create policy "Public can read Invoice Schedules if they have the ID"
  on public.invoice_payment_schedules for select to anon using (true);
create policy "Public can read invoice payments"
  on public.payments for select using (true);
create policy "Legacy authenticated invoice access"
  on public.invoices for all to authenticated using (true) with check (true);

grant all on public.invoices, public.invoice_phases, public.invoice_line_items,
  public.invoice_payment_schedules, public.payments to anon, authenticated, service_role;
grant select on public.profiles to authenticated;
grant execute on function public.handle_invoice_status_update() to public, anon, authenticated, service_role;
`;

async function database() {
  const db = new PGlite();
  await db.exec(schema);

  await db.query(
    `insert into companies(id,name,settings) values
      ($1,'Company A',$3::jsonb),
      ($2,'Company B',$4::jsonb)`,
    [
      COMPANY_A,
      COMPANY_B,
      JSON.stringify({
        address: "1 Main Street",
        email: "billing-a@example.test",
        tax_rate: 5,
        currency: "CAD",
        private_billing_key: "never-public",
        templates: { invoice_email_body: OLD_TEMPLATE },
        pdf: { brand_color: "#f59e0b", private_asset: "never-public" },
      }),
      JSON.stringify({
        currency: "USD",
        templates: { invoice_email_body: "A custom invoice message" },
      }),
    ],
  );
  await db.query(
    `insert into clients(id,company_id,name,first_name,surname,billing_address,site_address) values
      ($1,$2,'Client A','Alex','Client','A Billing','A Site'),
      ($3,$4,'Client B','Blair','Client','B Billing','B Site')`,
    [CLIENT_A, COMPANY_A, CLIENT_B, COMPANY_B],
  );
  await db.query(
    `insert into profiles(id,company_id,role,is_active) values
      ($1,$2,'admin',true),
      ($3,$4,'office',true),
      ($5,$2,'admin',false),
      ($6,$2,'manager',true)`,
    [USER_A, COMPANY_A, USER_B, COMPANY_B, INACTIVE_USER, MANAGER_USER],
  );
  await db.query(
    "insert into projects(id,company_id,client_id,name,project_number,site_address) values($1,$2,$3,'Project A','P-100','A Site')",
    [PROJECT_A, COMPANY_A, CLIENT_A],
  );
  await db.query(
    `insert into invoices(
      id,company_id,client_id,project_id,invoice_number,status,issue_date,due_date,
      site_address,subtotal,tax,total,amount_paid,balance_due,has_payment_schedule,
      notes,billing_address,due_terms,show_notes,internal_notes,discount_amount,discount_type
    ) values
      ($1,$2,$3,$4,'INV-A','Sent',current_date,current_date+14,'A Site',100,5,105,25,80,true,
       'Public note','A Billing','Net 14',true,'never public',0,'fixed'),
      ($5,$2,$3,$4,'INV-A2','Sent',current_date,current_date+14,'A Site',20,1,21,0,21,false,
       'Second public note','A Billing','Net 14',true,'second private note',0,'fixed'),
      ($6,$7,$8,null,'INV-B','Partial',current_date,current_date+14,'B Site',200,10,210,0,210,false,
       'B note','B Billing','Net 14',true,'B private',0,'fixed'),
      ($9,$2,$3,$4,'INV-DRAFT','Draft',current_date,current_date+14,'A Site',10,0.5,10.5,0,10.5,false,
       'Draft note','A Billing','Net 14',true,'draft private',0,'fixed')`,
    [
      INVOICE_A,
      COMPANY_A,
      CLIENT_A,
      PROJECT_A,
      INVOICE_A_SECOND,
      INVOICE_B,
      COMPANY_B,
      CLIENT_B,
      DRAFT_INVOICE,
    ],
  );
  await db.query(
    "insert into invoice_phases(id,company_id,invoice_id,phase_name,scope_of_work,internal_notes,sort_order) values($1,$2,$3,'Phase A','Client scope','never public',1)",
    [PHASE_A, COMPANY_A, INVOICE_A],
  );
  await db.query(
    `insert into invoice_line_items(
      id,company_id,invoice_id,phase_id,name,description,quantity,unit,unit_price,
      unit_cost,supplier,amount,line_total,taxable,display_order
    ) values
      ($1,$2,$3,$4,'Public item','Public description',2,'ea',50,12,'Private Supplier',100,100,true,1),
      (gen_random_uuid(),$5,$3,$4,'Cross-company poison row','Must never leak',1,'ea',999,1,'Private B',999,999,true,2)`,
    [ITEM_A, COMPANY_A, INVOICE_A, PHASE_A, COMPANY_B],
  );
  await db.query(
    `insert into invoice_payment_schedules(
      id,company_id,invoice_id,payment_name,due_event,amount,amount_paid,status,sort_order,amount_type,percentage,due_date
    ) values($1,$2,$3,'Final payment','On completion',80,0,'Pending',1,'fixed',null,current_date+14)`,
    [SCHEDULE_A, COMPANY_A, INVOICE_A],
  );
  await db.query(
    `insert into payments(
      id,company_id,invoice_id,schedule_item_id,amount,payment_method,notes,payment_date,
      stripe_checkout_session_id,stripe_payment_intent_id
    ) values($1,$2,$3,$4,25,'Card','private processor reference',current_date,'cs_private','pi_private')`,
    [PAYMENT_A, COMPANY_A, INVOICE_A, SCHEDULE_A],
  );

  await db.exec(migration);
  return db;
}

async function actAs(db, user, role = "authenticated") {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user || ""]);
  await db.query("select set_config('request.jwt.claim.role',$1,false)", [role]);
}

async function issueToken(db, user, invoice) {
  await actAs(db, user);
  return (await db.query("select issue_invoice_share_token($1) token", [invoice])).rows[0].token;
}

test("migration removes direct anonymous invoice data access and exposes only token RPCs", async () => {
  const db = await database();
  try {
    for (const table of [
      "invoices",
      "invoice_phases",
      "invoice_line_items",
      "invoice_payment_schedules",
      "payments",
      "invoice_share_links",
    ]) {
      for (const privilegeName of [
        "SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER",
      ]) {
        const privilege = await db.query(
          "select has_table_privilege('anon',$1,$2) allowed",
          [`public.${table}`, privilegeName],
        );
        assert.equal(
          privilege.rows[0].allowed,
          false,
          `anon must not have ${privilegeName} on ${table}`,
        );
      }
    }

    const bundleRpc = await db.query(
      "select has_function_privilege('anon','public.get_public_invoice_bundle(uuid,text)','EXECUTE') allowed",
    );
    const issueRpc = await db.query(
      "select has_function_privilege('anon','public.issue_invoice_share_token(uuid)','EXECUTE') allowed",
    );
    assert.equal(bundleRpc.rows[0].allowed, true);
    assert.equal(issueRpc.rows[0].allowed, false);

    const unsafePolicies = await db.query(`
      select policyname from pg_policies
      where schemaname='public'
        and tablename in ('invoices','invoice_phases','invoice_line_items','invoice_payment_schedules','payments')
        and exists(select 1 from unnest(roles) r where r::text in ('public','anon'))
    `);
    assert.deepEqual(unsafePolicies.rows, []);

    const billingBoundaries = await db.query(`
      select tablename,permissive from pg_policies
      where schemaname='public'
        and policyname='invoice_billing_role_access'
      order by tablename
    `);
    assert.deepEqual(
      billingBoundaries.rows,
      ["invoice_line_items", "invoice_payment_schedules", "invoice_phases", "invoices", "payments"]
        .map(tablename => ({ tablename, permissive: "RESTRICTIVE" })),
    );
  } finally {
    await db.close();
  }
});

test("share-token issuance is active-user and company isolated while service-role automation remains supported", async () => {
  const db = await database();
  try {
    const token = await issueToken(db, USER_A, INVOICE_A);
    assert.equal(token.length, 64);

    await actAs(db, USER_A);
    await assert.rejects(
      db.query("select issue_invoice_share_token($1)", [INVOICE_B]),
      /permission required/i,
    );

    await actAs(db, INACTIVE_USER);
    await assert.rejects(
      db.query("select issue_invoice_share_token($1)", [INVOICE_A]),
      /permission required/i,
    );

    await actAs(db, MANAGER_USER);
    await assert.rejects(
      db.query("select issue_invoice_share_token($1)", [INVOICE_A]),
      /permission required/i,
    );

    await actAs(db, null, "service_role");
    const serviceToken = (await db.query(
      "select issue_invoice_share_token($1) token",
      [INVOICE_B],
    )).rows[0].token;
    assert.equal(serviceToken.length, 64);
  } finally {
    await db.close();
  }
});

test("restrictive billing role policy cannot be bypassed by a permissive legacy authenticated policy", async () => {
  const managerDb = await database();
  try {
    await actAs(managerDb, MANAGER_USER);
    await managerDb.exec("set role authenticated");
    assert.equal((await managerDb.query("select count(*) count from invoices")).rows[0].count, 0);
  } finally {
    await managerDb.close();
  }

  const adminDb = await database();
  try {
    await actAs(adminDb, USER_A);
    await adminDb.exec("set role authenticated");
    const ids = (await adminDb.query("select id from invoices order by id")).rows.map(row => row.id);
    assert.deepEqual(ids, [INVOICE_A, INVOICE_A_SECOND, DRAFT_INVOICE].sort());
    assert.ok(!ids.includes(INVOICE_B));
  } finally {
    await adminDb.close();
  }
});

test("token storage is digest-only and multiple sends preserve earlier active links", async () => {
  const db = await database();
  try {
    const first = await issueToken(db, USER_A, INVOICE_A);
    const second = await issueToken(db, USER_A, INVOICE_A);
    assert.notEqual(first, second);

    const stored = await db.query(
      "select token_hash,length(token_hash) chars,status,expires_at from invoice_share_links where invoice_id=$1 order by created_at",
      [INVOICE_A],
    );
    assert.equal(stored.rows.length, 2);
    assert.ok(stored.rows.every(row => row.chars === 64 && row.status === "Active"));
    assert.ok(stored.rows.every(row => /^[0-9a-f]{64}$/.test(row.token_hash)));
    assert.ok(stored.rows.every(row => !row.token_hash.includes(first)));
    assert.ok(stored.rows.every(row => row.expires_at === null));

    for (const token of [first, second]) {
      const bundle = (await db.query(
        "select get_public_invoice_bundle($1,$2) bundle",
        [INVOICE_A, token],
      )).rows[0].bundle;
      assert.equal(bundle.invoice.id, INVOICE_A);
    }
  } finally {
    await db.close();
  }
});

test("service reminder tokens are deterministic per stage, durable, and digest-only", async () => {
  const db = await database();
  try {
    await actAs(db, null, "service_role");
    const first = (await db.query(
      "select issue_invoice_reminder_share_token($1,1) token",
      [INVOICE_A],
    )).rows[0].token;
    const retry = (await db.query(
      "select issue_invoice_reminder_share_token($1,1) token",
      [INVOICE_A],
    )).rows[0].token;
    const nextStage = (await db.query(
      "select issue_invoice_reminder_share_token($1,2) token",
      [INVOICE_A],
    )).rows[0].token;

    assert.equal(first, retry);
    assert.notEqual(first, nextStage);
    assert.match(first, /^[0-9a-f]{64}$/);

    const links = await db.query(
      "select token_hash,expires_at,status from invoice_share_links where invoice_id=$1 order by token_hash",
      [INVOICE_A],
    );
    assert.equal(links.rows.length, 2);
    assert.ok(links.rows.every(link => link.expires_at === null && link.status === "Active"));
    assert.ok(links.rows.every(link => link.token_hash !== first && link.token_hash !== nextStage));

    await actAs(db, USER_A, "authenticated");
    await assert.rejects(
      db.query("select issue_invoice_reminder_share_token($1,1)", [INVOICE_A]),
      /service role required/i,
    );

    const privilege = await db.query(
      "select has_function_privilege('authenticated','public.issue_invoice_reminder_share_token(uuid,integer)','EXECUTE') allowed",
    );
    assert.equal(privilege.rows[0].allowed, false);
  } finally {
    await db.close();
  }
});

test("public bundle is tenant-bound and contains only the explicit client-safe projection", async () => {
  const db = await database();
  try {
    const tokenA = await issueToken(db, USER_A, INVOICE_A);
    const tokenB = await issueToken(db, USER_B, INVOICE_B);

    await assert.rejects(
      db.query("select get_public_invoice_bundle($1,$2)", [INVOICE_B, tokenA]),
      /invalid/i,
    );
    await assert.rejects(
      db.query("select get_public_invoice_bundle($1,$2)", [INVOICE_A, tokenB]),
      /invalid/i,
    );

    const bundle = (await db.query(
      "select get_public_invoice_bundle($1,$2) bundle",
      [INVOICE_A, tokenA],
    )).rows[0].bundle;
    assert.equal(bundle.invoice.id, INVOICE_A);
    assert.equal(bundle.invoice.internal_notes, undefined);
    assert.equal(bundle.invoice.last_reminder_sent_at, undefined);
    assert.equal(bundle.company.settings.currency, "CAD");
    assert.equal(bundle.company.settings.private_billing_key, undefined);
    assert.equal(bundle.company.settings.pdf.private_asset, undefined);
    assert.equal(bundle.phases[0].internal_notes, undefined);
    assert.deepEqual(bundle.items.map(item => item.id), [ITEM_A]);
    assert.equal(bundle.items[0].unit_cost, undefined);
    assert.equal(bundle.items[0].supplier, undefined);
    assert.equal(bundle.payments[0].notes, undefined);
    assert.equal(bundle.payments[0].stripe_checkout_session_id, undefined);
    assert.equal(bundle.project.name, "Project A");
  } finally {
    await db.close();
  }
});

test("draft, revoked, expired, malformed, and reassigned invoice capabilities are blocked", async () => {
  const db = await database();
  try {
    const draftToken = await issueToken(db, USER_A, DRAFT_INVOICE);
    await assert.rejects(
      db.query("select get_public_invoice_bundle($1,$2)", [DRAFT_INVOICE, draftToken]),
      /unavailable/i,
    );
    await db.query("update invoices set status='Pending' where id=$1", [DRAFT_INVOICE]);
    await assert.rejects(
      db.query("select get_public_invoice_bundle($1,$2)", [DRAFT_INVOICE, draftToken]),
      /unavailable/i,
    );

    const revokedToken = await issueToken(db, USER_A, INVOICE_A);
    await actAs(db, USER_A);
    assert.equal((await db.query(
      "select revoke_invoice_share_token($1,$2) count",
      [INVOICE_A, revokedToken],
    )).rows[0].count, 1);
    await assert.rejects(
      db.query("select get_public_invoice_bundle($1,$2)", [INVOICE_A, revokedToken]),
      /invalid/i,
    );

    const expiredToken = await issueToken(db, USER_A, INVOICE_A);
    await db.query(
      "update invoice_share_links set expires_at=now()-interval '1 minute' where token_hash=encode(extensions.digest($1,'sha256'),'hex')",
      [expiredToken],
    );
    await assert.rejects(
      db.query("select get_public_invoice_bundle($1,$2)", [INVOICE_A, expiredToken]),
      /invalid/i,
    );

    await assert.rejects(
      db.query("select get_public_invoice_bundle($1,'short')", [INVOICE_A]),
      /invalid/i,
    );

    const reassignedToken = await issueToken(db, USER_A, INVOICE_A);
    await db.query("update invoices set client_id=$1 where id=$2", [CLIENT_B, INVOICE_A]);
    await assert.rejects(
      db.query("select get_public_invoice_bundle($1,$2)", [INVOICE_A, reassignedToken]),
      /unavailable/i,
    );
  } finally {
    await db.close();
  }
});

test("portal RPC is invoice-scoped and cannot enumerate another invoice for the same client", async () => {
  const db = await database();
  try {
    const token = await issueToken(db, USER_A, INVOICE_A);
    const invoices = (await db.query(
      "select get_client_portal_invoices($1,$2) invoices",
      [CLIENT_A, token],
    )).rows[0].invoices;
    assert.deepEqual(invoices.map(invoice => invoice.id), [INVOICE_A]);
    assert.equal(invoices[0].share_token, token);
    assert.ok(!invoices.some(invoice => invoice.id === INVOICE_A_SECOND));

    await assert.rejects(
      db.query("select get_client_portal_invoices($1,$2)", [CLIENT_B, token]),
      /invalid/i,
    );
  } finally {
    await db.close();
  }
});

test("validated view tracking updates only its link and safely records repeat views", async () => {
  const db = await database();
  try {
    const first = await issueToken(db, USER_A, INVOICE_A);
    const second = await issueToken(db, USER_A, INVOICE_A);
    await db.query("select track_public_invoice_view($1,$2)", [INVOICE_A, first]);
    await db.query("select track_public_invoice_view($1,$2)", [INVOICE_A, first]);

    const links = await db.query(
      `select view_count,first_viewed_at is not null first_viewed,last_viewed_at is not null last_viewed
       from invoice_share_links where invoice_id=$1
       order by (token_hash=encode(extensions.digest($2,'sha256'),'hex')) desc`,
      [INVOICE_A, first],
    );
    assert.deepEqual(links.rows[0], { view_count: 2, first_viewed: true, last_viewed: true });
    assert.deepEqual(links.rows[1], { view_count: 0, first_viewed: false, last_viewed: false });

    assert.equal((await db.query(
      "select status from invoices where id=$1",
      [INVOICE_A],
    )).rows[0].status, "Viewed");

    const partialToken = await issueToken(db, USER_B, INVOICE_B);
    await db.query("select track_public_invoice_view($1,$2)", [INVOICE_B, partialToken]);
    assert.equal((await db.query(
      "select status from invoices where id=$1",
      [INVOICE_B],
    )).rows[0].status, "Partial");

    await assert.rejects(
      db.query("select track_public_invoice_view($1,$2)", [INVOICE_A, `${second.slice(0, -1)}x`]),
      /invalid/i,
    );
  } finally {
    await db.close();
  }
});

test("raw anonymous invoice-view notifications are blocked while other legacy document events remain available", async () => {
  const db = await database();
  try {
    await actAs(db, null, "anon");
    await assert.rejects(
      db.query(
        "select request_document_notification($1,'invoice_viewed','')",
        [INVOICE_A],
      ),
      /valid secure link/i,
    );
    assert.equal((await db.query(
      "select request_document_notification($1,'quote_viewed','') allowed",
      [INVOICE_A],
    )).rows[0].allowed, true);

    const privatePrivilege = await db.query(`
      select has_function_privilege(
        'anon',
        'invoice_share_private.request_document_notification(uuid,text,text)',
        'EXECUTE'
      ) allowed
    `);
    assert.equal(privatePrivilege.rows[0].allowed, false);
  } finally {
    await db.close();
  }
});

test("trigger execution is no longer public and its search_path is pinned empty", async () => {
  const db = await database();
  try {
    const privileges = await db.query(`
      select
        has_function_privilege('anon','public.handle_invoice_status_update()','EXECUTE') anon_execute,
        has_function_privilege('authenticated','public.handle_invoice_status_update()','EXECUTE') authenticated_execute
    `);
    assert.deepEqual(privileges.rows[0], { anon_execute: false, authenticated_execute: false });

    const config = (await db.query(`
      select proconfig from pg_proc
      where oid='public.handle_invoice_status_update()'::regprocedure
    `)).rows[0].proconfig;
    assert.ok(config.some(value => value === "search_path=\"\"" || value === "search_path="));
  } finally {
    await db.close();
  }
});

test("only the exact shipped attachment template is migrated", async () => {
  const db = await database();
  try {
    const rows = await db.query(
      "select id,settings #>> '{templates,invoice_email_body}' body from companies order by id",
    );
    assert.equal(rows.rows[0].body, NEW_TEMPLATE);
    assert.equal(rows.rows[1].body, "A custom invoice message");
  } finally {
    await db.close();
  }
});
