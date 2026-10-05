import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { canAttemptAIRewrite, friendlyRetryDelay, shouldUseWritingTools } from "../../src/lib/aiRewrite.js";

const id = value => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

async function guardedDatabase({ withLegacySubscriber = false } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema workflow_private;
    grant usage on schema workflow_private to service_role;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.companies(
      id uuid primary key,
      plan_id text default 'starter',
      subscription_tier text default 'starter',
      subscription_status text default 'incomplete'
    );
    create table public.profiles(
      id uuid primary key,
      company_id uuid references public.companies(id),
      is_active boolean default true
    );
  `);
  if (withLegacySubscriber) {
    await db.query("insert into companies(id,plan_id,subscription_status) values($1,'starter','Active')", [id(90)]);
    await db.query("insert into profiles(id,company_id) values($1,$2)", [id(91), id(90)]);
  }
  await db.exec(await readFile(new URL("../../supabase/migrations/20261005140000_ai_rewrite_guardrails.sql", import.meta.url), "utf8"));
  return db;
}

test("large controlled text entries receive writing tools while compact fields remain unchanged", () => {
  const onChange = () => {};
  assert.equal(shouldUseWritingTools({ value: "", onChange, rows: 3 }), true);
  assert.equal(shouldUseWritingTools({ value: "", onChange, maxLength: 5000 }), true);
  assert.equal(shouldUseWritingTools({ value: "", onChange, className: "min-h-[120px]" }), true);
  assert.equal(shouldUseWritingTools({ value: "", onChange, rows: 2 }), false);
  assert.equal(shouldUseWritingTools({ value: "", onChange, rows: 8, writingTools: false }), false);
  assert.equal(canAttemptAIRewrite({ user: { id: "u" }, company: { plan_id: "professional", subscription_status: "Active" } }), true);
  assert.equal(canAttemptAIRewrite({ user: { id: "u" }, company: { plan_id: "starter", subscription_status: "incomplete" } }), false);
  assert.equal(friendlyRetryDelay(413), "about 7 minutes");
});

test("existing active subscribers are grandfathered while new Starter companies are denied", async () => {
  const db = await guardedDatabase({ withLegacySubscriber: true });
  try {
    const newCompany = id(92), newUser = id(93);
    await db.query("insert into companies(id,plan_id,subscription_status) values($1,'starter','Active')", [newCompany]);
    await db.query("insert into profiles(id,company_id) values($1,$2)", [newUser, newCompany]);
    await db.exec("set role service_role");

    const legacy = (await db.query("select public.claim_ai_rewrite($1,$2,$3,100,'general_business_text') result", [id(90), id(91), id(900)])).rows[0].result;
    const starter = (await db.query("select public.claim_ai_rewrite($1,$2,$3,100,'general_business_text') result", [newCompany, newUser, id(901)])).rows[0].result;
    assert.equal(legacy.allowed, true);
    assert.equal(starter.allowed, false);
    assert.equal(starter.code, "PLAN_REQUIRED");
  } finally {
    await db.close();
  }
});

test("normal use succeeds and bursts are stopped at the configured user limit", async () => {
  const db = await guardedDatabase();
  try {
    const company = id(1), user = id(10);
    await db.query("insert into companies(id,plan_id,subscription_status) values($1,'professional','Active')", [company]);
    await db.query("insert into profiles(id,company_id) values($1,$2)", [user, company]);
    await db.exec("set role service_role");

    const first = (await db.query("select public.claim_ai_rewrite($1,$2,$3,120,'general_business_text') result", [company, user, id(100)])).rows[0].result;
    assert.equal(first.allowed, true);
    assert.equal(first.user_hour_remaining, 29);
    const completed = (await db.query("select public.complete_ai_rewrite_usage($1,$2,$3,'succeeded',180,240,null) completed", [first.usage_id, company, user])).rows[0].completed;
    assert.equal(completed, true);

    for (let attempt = 1; attempt < 30; attempt += 1) {
      const result = (await db.query("select public.claim_ai_rewrite($1,$2,$3,80,'general_business_text') result", [company, user, id(100 + attempt)])).rows[0].result;
      assert.equal(result.allowed, true);
    }
    const limited = (await db.query("select public.claim_ai_rewrite($1,$2,$3,80,'general_business_text') result", [company, user, id(999)])).rows[0].result;
    assert.equal(limited.allowed, false);
    assert.equal(limited.code, "USER_HOURLY_LIMIT");
    assert.ok(limited.retry_after_seconds > 0);
    assert.equal((await db.query("select count(*)::int n from workflow_private.ai_rewrite_usage where status='denied' and denial_reason='USER_HOURLY_LIMIT'")).rows[0].n, 1);
  } finally {
    await db.close();
  }
});

test("usage and identity checks are isolated across companies", async () => {
  const db = await guardedDatabase();
  try {
    const companyA = id(1), companyB = id(2), userA = id(10), userB = id(20);
    await db.query("insert into companies(id,plan_id,subscription_status) values($1,'professional','Active'),($2,'professional','Active')", [companyA, companyB]);
    await db.query("insert into profiles(id,company_id) values($1,$2),($3,$4)", [userA, companyA, userB, companyB]);
    await db.exec("set role service_role");

    const wrongTenant = (await db.query("select public.claim_ai_rewrite($1,$2,$3,100,'general_business_text') result", [companyB, userA, id(500)])).rows[0].result;
    assert.equal(wrongTenant.allowed, false);
    assert.equal(wrongTenant.code, "INVALID_COMPANY_CONTEXT");
    assert.equal((await db.query("select count(*)::int n from workflow_private.ai_rewrite_usage where company_id=$1", [companyB])).rows[0].n, 0);

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const result = (await db.query("select public.claim_ai_rewrite($1,$2,$3,100,'general_business_text') result", [companyA, userA, id(600 + attempt)])).rows[0].result;
      assert.equal(result.allowed, true);
    }
    const companyBResult = (await db.query("select public.claim_ai_rewrite($1,$2,$3,100,'general_business_text') result", [companyB, userB, id(800)])).rows[0].result;
    assert.equal(companyBResult.allowed, true);
    assert.equal(companyBResult.user_hour_remaining, 29);
  } finally {
    await db.close();
  }
});

test("usage data and guardrail RPCs are not available to authenticated clients", async () => {
  const db = await guardedDatabase();
  try {
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select * from workflow_private.ai_rewrite_usage"), /permission denied/);
    await assert.rejects(db.query("select public.claim_ai_rewrite($1,$2,$3,10,'general_business_text')", [id(1), id(10), id(50)]), /permission denied/);
  } finally {
    await db.close();
  }
});
