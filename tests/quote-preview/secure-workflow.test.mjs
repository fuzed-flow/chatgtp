import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { initialQuoteSelections } from "../../src/lib/quoteSelections.js";

const migration = await readFile(new URL("../../supabase/migrations/20261005211504_secure_public_quote_workflow.sql", import.meta.url), "utf8");
const recipientMigration = await readFile(new URL("../../supabase/migrations/20261005233121_public_quote_recipient_identity.sql", import.meta.url), "utf8");
const resendMigration = await readFile(new URL("../../supabase/migrations/20261008163723_reset_quote_approval_on_resend.sql", import.meta.url), "utf8");
const publicView = await readFile(new URL("../../src/pages/PublicQuoteView.jsx", import.meta.url), "utf8");
const staffView = await readFile(new URL("../../src/pages/QuoteView.jsx", import.meta.url), "utf8");
const presentation = await readFile(new URL("../../src/components/quotes/QuotePresentation.jsx", import.meta.url), "utf8");
const clientPortal = await readFile(new URL("../../src/pages/ClientPortal.jsx", import.meta.url), "utf8");
const pdfGenerator = await readFile(new URL("../../src/components/pdf/PDFGenerator.jsx", import.meta.url), "utf8");

const COMPANY_A = "10000000-0000-4000-8000-000000000001";
const COMPANY_B = "20000000-0000-4000-8000-000000000001";
const CLIENT_A = "10000000-0000-4000-8000-000000000002";
const CLIENT_B = "20000000-0000-4000-8000-000000000002";
const USER_A = "10000000-0000-4000-8000-000000000003";
const USER_B = "20000000-0000-4000-8000-000000000003";
const QUOTE_A = "10000000-0000-4000-8000-000000000004";
const QUOTE_B = "20000000-0000-4000-8000-000000000004";
const EXPIRED_QUOTE = "10000000-0000-4000-8000-000000000005";
const LEAD_A = "10000000-0000-4000-8000-000000000011";
const LEAD_QUOTE = "10000000-0000-4000-8000-000000000012";
const PHASE_A = "10000000-0000-4000-8000-000000000006";
const PHASE_B = "20000000-0000-4000-8000-000000000006";
const EXPIRED_PHASE = "10000000-0000-4000-8000-000000000007";
const ITEM_A = "10000000-0000-4000-8000-000000000008";
const OPTIONAL_ITEM_A = "10000000-0000-4000-8000-000000000009";
const ITEM_B = "20000000-0000-4000-8000-000000000008";
const EXPIRED_ITEM = "10000000-0000-4000-8000-000000000010";

const schema = `
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create table public.companies(
  id uuid primary key, name text, logo_url text, company_logo_url text, settings jsonb default '{}'::jsonb
);
create table public.clients(
  id uuid primary key, company_id uuid not null, name text, first_name text, surname text,
  billing_address text, site_address text
);
create table public.profiles(
  id uuid primary key, company_id uuid not null, role text, is_active boolean default true
);
create table public.leads(
  id uuid primary key, company_id uuid not null, contact_name text, contact_email text,
  contact_phone text, site_address text, notes text
);
create function public.get_auth_company_id() returns uuid language sql stable as $$
  select company_id from public.profiles where id = auth.uid()
$$;
create table public.quotes(
  id uuid primary key, company_id uuid not null, client_id uuid, lead_id uuid, quote_number text, title text,
  status text default 'Draft', is_template boolean default false, subtotal numeric default 0,
  tax numeric default 0, total numeric default 0, overall_scope text, client_message text, terms text,
  deposit_amount numeric default 0, deposit_paid_amount numeric default 0, discount_amount numeric default 0,
  discount_type text, discount_percentage numeric default 0, show_discount_amount boolean default true,
  has_payment_schedule boolean default false, hero_image_url text, end_photos jsonb default '[]'::jsonb,
  documents jsonb default '[]'::jsonb, site_address text, show_overall_scope boolean default true,
  issue_date date default current_date, expiry_date date, client_selected_items_json text,
  client_selected_items jsonb, client_signature text, signed_at text, signed_by text, decline_reason text,
  viewed_at date, created_at timestamptz default now(), updated_at timestamptz default now()
);
create table public.quote_approvals(
  id uuid primary key default gen_random_uuid(), company_id uuid not null, quote_id uuid not null,
  client_id uuid, approval_token text not null unique, approval_status text default 'Pending',
  signer_name text, signer_email text, client_ip text, sent_at timestamptz, viewed_at timestamptz,
  signed_at timestamptz, created_at timestamptz default now()
);
create table public.quote_phases(
  id uuid primary key, company_id uuid not null, quote_id uuid not null, phase_name text,
  scope_of_work text, internal_notes text, show_scope_to_client boolean default true,
  photos jsonb default '[]'::jsonb, sort_order integer default 0, is_optional boolean default false,
  default_selected boolean default false
);
create table public.quote_line_items(
  id uuid primary key, company_id uuid not null, quote_id uuid not null, phase_id uuid,
  name text, description text, quantity numeric, unit text, unit_price numeric, unit_cost numeric,
  supplier text, taxable boolean default false, photo_url text, is_optional boolean default false,
  default_selected boolean default false, display_order integer default 0
);
create table public.quote_payment_schedules(
  id uuid primary key, company_id uuid not null, quote_id uuid not null, payment_name text,
  due_event text, amount numeric, amount_type text, percentage numeric, sort_order integer default 0
);
create table public.quote_views(
  id uuid primary key default gen_random_uuid(), company_id uuid not null, quote_id uuid not null,
  viewer_type text, viewed_at timestamptz default now()
);
alter table public.quotes enable row level security;
alter table public.quote_phases enable row level security;
alter table public.quote_line_items enable row level security;
alter table public.quote_payment_schedules enable row level security;
alter table public.quote_views enable row level security;
alter table public.quote_approvals enable row level security;
create policy "Allow public link viewing for sent quotes" on public.quotes for select to anon using (true);
create policy "Allow public to update quote status" on public.quotes for update to anon using (true) with check (true);
create policy "Allow public link viewing for phases" on public.quote_phases for select to anon using (true);
create policy "Allow public link viewing for line items" on public.quote_line_items for select to anon using (true);
create policy "Public can read Quote Schedules if they have the ID" on public.quote_payment_schedules for select to anon using (true);
create policy "Anyone can insert views" on public.quote_views for insert to anon with check (true);
create policy "Company users can read views" on public.quote_views for select to authenticated using (true);
grant all on public.quotes, public.quote_phases, public.quote_line_items, public.quote_payment_schedules,
  public.quote_views, public.quote_approvals to anon, authenticated, service_role;
`;

async function database() {
  const db = new PGlite();
  await db.exec(schema);
  await db.exec(migration);
  await db.exec(recipientMigration);
  await db.exec(resendMigration);
  await db.query("insert into companies(id,name,settings) values($1,'Company A',$3),($2,'Company B',$4)", [
    COMPANY_A, COMPANY_B,
    JSON.stringify({ tax_rate: 5, enable_secondary_tax: false, currency: "CAD", pdf: { brand_color: "#f59e0b" }, private_billing_key: "do-not-expose" }),
    JSON.stringify({ tax_rate: 13, currency: "USD" }),
  ]);
  await db.query("insert into clients(id,company_id,name,billing_address) values($1,$2,'Client A','A Street'),($3,$4,'Client B','B Street')", [CLIENT_A, COMPANY_A, CLIENT_B, COMPANY_B]);
  await db.query("insert into leads(id,company_id,contact_name,contact_email,contact_phone,site_address,notes) values($1,$2,'Alex Lead','private@example.test','4035550100','Lead Street','never public')", [LEAD_A, COMPANY_A]);
  await db.query("insert into profiles(id,company_id,role) values($1,$2,'manager'),($3,$4,'manager')", [USER_A, COMPANY_A, USER_B, COMPANY_B]);
  await db.query(`insert into quotes(id,company_id,client_id,quote_number,title,status,subtotal,tax,total,discount_type,expiry_date)
    values($1,$2,$3,'Q-A','Quote A','Sent',9999,999,10998,'fixed',current_date + 7),
          ($4,$5,$6,'Q-B','Quote B','Sent',100,13,113,'fixed',current_date + 7),
          ($7,$2,$3,'Q-X','Expired','Sent',40,2,42,'fixed',current_date - 1)`,
    [QUOTE_A, COMPANY_A, CLIENT_A, QUOTE_B, COMPANY_B, CLIENT_B, EXPIRED_QUOTE]);
  await db.query("insert into quotes(id,company_id,lead_id,quote_number,title,status,subtotal,tax,total,discount_type,expiry_date) values($1,$2,$3,'Q-L','Lead Quote','Sent',200,10,210,'fixed',current_date + 7)", [LEAD_QUOTE, COMPANY_A, LEAD_A]);
  await db.query("insert into quote_phases(id,company_id,quote_id,phase_name,internal_notes) values($1,$2,$3,'Phase A','never public'),($4,$5,$6,'Phase B','secret B'),($7,$2,$8,'Expired phase','secret')", [PHASE_A, COMPANY_A, QUOTE_A, PHASE_B, COMPANY_B, QUOTE_B, EXPIRED_PHASE, EXPIRED_QUOTE]);
  await db.query(`insert into quote_line_items(id,company_id,quote_id,phase_id,name,quantity,unit_price,unit_cost,supplier,taxable,is_optional,default_selected,display_order)
    values($1,$2,$3,$4,'Required',2,100,50,'Private Supplier',true,false,false,1),
          ($5,$2,$3,$4,'Optional',1,25,10,'Private Supplier',false,true,false,2),
          ($6,$7,$8,$9,'Other company',1,80,40,'Private B',true,false,false,1),
          ($10,$2,$11,$12,'Expired item',1,40,20,'Private Supplier',true,false,false,1)`,
    [ITEM_A, COMPANY_A, QUOTE_A, PHASE_A, OPTIONAL_ITEM_A, ITEM_B, COMPANY_B, QUOTE_B, PHASE_B, EXPIRED_ITEM, EXPIRED_QUOTE, EXPIRED_PHASE]);
  return db;
}

async function issueToken(db, user, quote) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  return (await db.query("select issue_quote_share_token($1) token", [quote])).rows[0].token;
}

test("migration removes direct anonymous quote access and keeps only token RPC access", async () => {
  const db = await database();
  try {
    const direct = await db.query("select has_table_privilege('anon','public.quotes','SELECT') allowed");
    const update = await db.query("select has_table_privilege('anon','public.quotes','UPDATE') allowed");
    const rpc = await db.query("select has_function_privilege('anon','public.get_public_quote_bundle(uuid,text)','EXECUTE') allowed");
    assert.equal(direct.rows[0].allowed, false);
    assert.equal(update.rows[0].allowed, false);
    assert.equal(rpc.rows[0].allowed, true);
  } finally {
    await db.close();
  }
});

test("opaque tokens are isolated by quote and company and return a restricted bundle", async () => {
  const db = await database();
  try {
    const tokenA = await issueToken(db, USER_A, QUOTE_A);
    const tokenB = await issueToken(db, USER_B, QUOTE_B);
    assert.equal(tokenA.length, 64);
    assert.notEqual(tokenA, tokenB);
    await assert.rejects(db.query("select get_public_quote_bundle($1,$2)", [QUOTE_B, tokenA]), /invalid/i);

    const bundle = (await db.query("select get_public_quote_bundle($1,$2) bundle", [QUOTE_A, tokenA])).rows[0].bundle;
    assert.equal(bundle.quote.id, QUOTE_A);
    assert.deepEqual(bundle.recipient, { source_type: "client", name: "Client A", billing_address: "A Street", site_address: null });
    assert.equal(bundle.company.settings.currency, "CAD");
    assert.equal(bundle.company.settings.private_billing_key, undefined);
    assert.equal(bundle.phases[0].internal_notes, undefined);
    assert.equal(bundle.items[0].unit_cost, undefined);
    assert.equal(bundle.items[0].supplier, undefined);

    const ownPortalQuotes = (await db.query("select get_client_portal_quotes($1,$2) quotes", [CLIENT_A, tokenA])).rows[0].quotes;
    const foreignPortalQuotes = (await db.query("select get_client_portal_quotes($1,$2) quotes", [CLIENT_B, tokenA])).rows[0].quotes;
    assert.deepEqual(ownPortalQuotes.map(quote => quote.id), [QUOTE_A]);
    assert.deepEqual(foreignPortalQuotes, []);
  } finally {
    await db.close();
  }
});

test("public quote recipient uses the selected lead name without exposing private lead fields", async () => {
  const db = await database();
  try {
    const token = await issueToken(db, USER_A, LEAD_QUOTE);
    const bundle = (await db.query("select get_public_quote_bundle($1,$2) bundle", [LEAD_QUOTE, token])).rows[0].bundle;
    assert.equal(bundle.client, null);
    assert.deepEqual(bundle.recipient, { source_type: "lead", name: "Alex Lead" });
    assert.equal(bundle.recipient.contact_email, undefined);
    assert.equal(bundle.recipient.contact_phone, undefined);
    assert.equal(bundle.recipient.notes, undefined);
  } finally {
    await db.close();
  }
});

test("approval is atomic, server-calculated, and cannot be repeated", async () => {
  const db = await database();
  try {
    const token = await issueToken(db, USER_A, QUOTE_A);
    const result = (await db.query(
      "select respond_to_public_quote($1,$2,'approve',$3,'Alex Client','alex@example.com',true,null) result",
      [QUOTE_A, token, JSON.stringify({ [OPTIONAL_ITEM_A]: true })],
    )).rows[0].result;
    assert.deepEqual(result, { status: "Approved", subtotal: 225, tax: 10, total: 235 });
    const quote = (await db.query("select status,subtotal,tax,total,signed_by from quotes where id=$1", [QUOTE_A])).rows[0];
    assert.deepEqual(quote, { status: "Approved", subtotal: "225.00", tax: "10.00", total: "235.00", signed_by: "Alex Client" });
    await assert.rejects(
      db.query("select respond_to_public_quote($1,$2,'decline','{}'::jsonb,null,null,false,'changed mind')", [QUOTE_A, token]),
      /no longer accepts a response/i,
    );
  } finally {
    await db.close();
  }
});

test("resending a completed quote clears its prior response cycle", async () => {
  const db = await database();
  try {
    const token = await issueToken(db, USER_A, QUOTE_A);
    await db.query(
      "select respond_to_public_quote($1,$2,'approve',$3,'Alex Client','alex@example.com',true,null)",
      [QUOTE_A, token, JSON.stringify({ [OPTIONAL_ITEM_A]: true })],
    );
    await db.query("update quotes set status='Sent' where id=$1", [QUOTE_A]);

    const resentToken = (await db.query(
      "select reset_quote_approval_cycle($1) token",
      [QUOTE_A],
    )).rows[0].token;
    assert.equal(resentToken, token);

    const approval = (await db.query(
      "select approval_status,viewed_at,signed_at,signer_name,signer_email,client_ip from quote_approvals where quote_id=$1",
      [QUOTE_A],
    )).rows[0];
    assert.deepEqual(approval, {
      approval_status: "Sent",
      viewed_at: null,
      signed_at: null,
      signer_name: null,
      signer_email: null,
      client_ip: null,
    });

    const reopenedQuote = (await db.query(
      "select client_selected_items,client_selected_items_json,client_signature,signed_at,signed_by from quotes where id=$1",
      [QUOTE_A],
    )).rows[0];
    assert.deepEqual(reopenedQuote, {
      client_selected_items: {},
      client_selected_items_json: null,
      client_signature: null,
      signed_at: null,
      signed_by: null,
    });

    const result = (await db.query(
      "select respond_to_public_quote($1,$2,'approve',$3,'Alex Client','alex@example.com',true,null) result",
      [QUOTE_A, resentToken, JSON.stringify({ [OPTIONAL_ITEM_A]: false })],
    )).rows[0].result;
    assert.equal(result.status, "Approved");
  } finally {
    await db.close();
  }
});

test("selection initialization drops removed and non-optional IDs", () => {
  const removedId = "30000000-0000-4000-8000-000000000001";
  const selections = initialQuoteSelections(
    { client_selected_items_json: JSON.stringify({ [removedId]: true, [ITEM_A]: true, [OPTIONAL_ITEM_A]: false }) },
    [{ id: PHASE_A, is_optional: false, default_selected: false }],
    [
      { id: ITEM_A, is_optional: false, default_selected: false },
      { id: OPTIONAL_ITEM_A, is_optional: true, default_selected: true },
    ],
  );
  assert.deepEqual(selections, { [OPTIONAL_ITEM_A]: false });
});

test("expired approvals are blocked and change requests are persisted", async () => {
  const db = await database();
  try {
    const expiredToken = await issueToken(db, USER_A, EXPIRED_QUOTE);
    await assert.rejects(
      db.query("select respond_to_public_quote($1,$2,'approve','{}'::jsonb,'Alex Client',null,true,null)", [EXPIRED_QUOTE, expiredToken]),
      /expired/i,
    );

    const token = await issueToken(db, USER_A, QUOTE_A);
    const response = (await db.query(
      "select respond_to_public_quote($1,$2,'request_changes','{}'::jsonb,null,null,false,'Please revise the flooring.') result",
      [QUOTE_A, token],
    )).rows[0].result;
    assert.equal(response.status, "Pending");
    const request = (await db.query("select message,status from quote_change_requests where quote_id=$1", [QUOTE_A])).rows[0];
    assert.deepEqual(request, { message: "Please revise the flooring.", status: "Open" });
  } finally {
    await db.close();
  }
});

test("public, staff, and portal UIs share the safe presentation path", () => {
  assert.match(publicView, /getPublicQuoteBundle\(quoteId, token\)/);
  assert.match(publicView, /bundle\?\.recipient \|\| bundle\?\.client/);
  assert.doesNotMatch(publicView, /\.from\(["']quotes["']\)/);
  assert.match(publicView, /respondToPublicQuote/);
  assert.match(publicView, /expired && !closed/);
  assert.match(staffView, /<QuotePresentation[\s\S]*preview/);
  assert.match(staffView, /quote\.lead_id[\s\S]*\.from\(["']leads["']\)[\s\S]*contact_name/);
  assert.match(staffView, /name:\s*recipientResult\.data\.contact_name/);
  assert.match(staffView, /\.eq\(["']company_id["'],\s*quote\.company_id\)/);
  assert.doesNotMatch(staffView, /update\(|insert\(|upsert\(/);
  assert.match(clientPortal, /get_client_portal_quotes/);
  assert.match(clientPortal, /p_token: quoteAccessToken/);
  assert.match(clientPortal, /quote\.approval_token/);
  assert.match(presentation, /item\.photo_url/);
  assert.doesNotMatch(presentation, /hidden\s+sm:block/);
  assert.match(presentation, /min-h-11 min-w-11/);
  assert.match(pdfGenerator, /safelyAddImage\(doc, quote\.hero_image_url/);
  assert.match(pdfGenerator, /getCompanyCurrency\(organization\)/);
});
