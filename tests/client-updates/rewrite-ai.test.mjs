import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { transform } from "esbuild";

const local = path => new URL(path, import.meta.url);
const source = await fs.readFile(local("../../supabase/functions/rewrite-text/index.ts"), "utf8");
const javascript = (await transform(source.replace(/^import .*\n/gm, ""), { loader: "ts", format: "iife" })).code;

function fixture({
  invalidUser = false,
  profile = { company_id: "company-1", is_active: true },
  profileError = null,
  modelReply = "The electrical rough-in is complete.",
  claim = { allowed: true, code: "OK", usage_id: "usage-1" },
} = {}) {
  const observed = { clients: [], completions: [], tokens: [], rpcs: [] };
  let handler;
  const createClient = (...args) => {
    observed.clients.push(args);
    if (args[1] === "service-role-key") {
      return {
        rpc: async (name, params) => {
          observed.rpcs.push({ name, params });
          if (name === "claim_ai_rewrite") return { data: claim, error: null };
          return { data: true, error: null };
        },
      };
    }
    return {
      auth: { getUser: async token => {
        observed.tokens.push(token);
        return { data: { user: invalidUser ? null : { id: "user-1" } }, error: null };
      } },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: profileError }) }) }) }),
    };
  };
  class OpenAI {
    chat = { completions: { create: async params => {
      observed.completions.push(params);
      return { choices: [{ message: { content: modelReply } }] };
    } } };
  }
  const env = {
    SUPABASE_URL: "https://project.example",
    SUPABASE_ANON_KEY: "public-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    OPENAI_API_KEY: "test-only",
  };
  new Function("serve", "createClient", "OpenAI", "Deno", "Response", "console", javascript)(
    fn => { handler = fn; },
    createClient,
    OpenAI,
    { env: { get: name => env[name] } },
    Response,
    { error() {} },
  );
  const request = (body, authorized = true) => handler(new Request("https://edge.example/rewrite-text", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(authorized ? { Authorization: "Bearer user-jwt" } : {}) },
    body: JSON.stringify(body),
  }));
  return { request, observed };
}

test("AI rewrite authenticates and validates the caller before model use", async () => {
  const noAuth = fixture();
  assert.equal((await noAuth.request({ text: "Draft", field: "project_summary" }, false)).status, 401);
  assert.equal(noAuth.observed.clients.length, 0);
  assert.equal(noAuth.observed.completions.length, 0);

  const invalid = fixture({ invalidUser: true });
  assert.equal((await invalid.request({ text: "Draft", field: "project_summary" })).status, 401);
  assert.equal(invalid.observed.completions.length, 0);

  const inactive = fixture({ profile: { company_id: "company-1", is_active: false } });
  assert.equal((await inactive.request({ text: "Draft", field: "project_summary" })).status, 403);
  assert.equal(inactive.observed.completions.length, 0);
});

test("AI rewrite validates text length and the approved field list before claiming usage", async () => {
  for (const body of [
    { text: "", field: "project_summary" },
    { text: "a".repeat(10001), field: "project_summary" },
    { text: "Draft", field: "private_admin_note" },
  ]) {
    const instance = fixture();
    assert.equal((await instance.request(body)).status, 400);
    assert.equal(instance.observed.completions.length, 0);
    assert.equal(instance.observed.rpcs.length, 0);
  }
});

test("normal use is claimed, rewritten and completed without logging source text", async () => {
  const { request, observed } = fixture({ modelReply: "Electrical rough-in completed\nCity inspection passed" });
  const response = await request({
    text: "electric done\ninspection passed",
    field: "completed_work",
    request_id: "00000000-0000-4000-8000-000000000009",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { text: "Electrical rough-in completed\nCity inspection passed" });
  assert.equal(observed.clients[0][1], "public-anon-key");
  assert.equal(observed.clients[1][1], "service-role-key");
  assert.equal(observed.clients[0][2].global.headers.Authorization, "Bearer user-jwt");
  assert.deepEqual(observed.tokens, ["user-jwt"]);

  assert.equal(observed.rpcs[0].name, "claim_ai_rewrite");
  assert.deepEqual(observed.rpcs[0].params, {
    p_company_id: "company-1",
    p_user_id: "user-1",
    p_request_id: "00000000-0000-4000-8000-000000000009",
    p_input_chars: 31,
    p_field_category: "completed_work",
  });
  assert.equal(Object.values(observed.rpcs[0].params).includes("electric done\ninspection passed"), false);
  assert.equal(observed.rpcs[1].name, "complete_ai_rewrite_usage");
  assert.equal(observed.rpcs[1].params.p_status, "succeeded");

  const completion = observed.completions[0];
  assert.equal(completion.model, "gpt-5.6-terra");
  assert.equal(completion.max_completion_tokens, 1800);
  assert.match(completion.messages[0].content, /Preserve every fact, name, date, amount, measurement/);
  assert.match(completion.messages[0].content, /one item per line with no bullets/);
  assert.match(completion.messages[0].content, /Never invent/);
  assert.equal(completion.messages[1].content, "electric done\ninspection passed");
  assert.doesNotMatch(completion.messages[0].content, /company-1|user-1/);
});

test("a burst limit returns 429, a retry delay and does not call the model", async () => {
  const instance = fixture({
    claim: {
      allowed: false,
      code: "USER_HOURLY_LIMIT",
      message: "AI Rewrite has reached its usage limit. Please try again later.",
      retry_after_seconds: 413,
    },
  });
  const response = await instance.request({ text: "Draft", field: "general_business_text" });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "413");
  assert.deepEqual(await response.json(), {
    error: "AI Rewrite has reached its usage limit. Please try again later.",
    code: "USER_HOURLY_LIMIT",
    retry_after_seconds: 413,
  });
  assert.equal(instance.observed.completions.length, 0);
});

test("an ineligible plan is rejected before model use", async () => {
  const instance = fixture({
    claim: {
      allowed: false,
      code: "PLAN_REQUIRED",
      message: "AI Rewrite is available on Professional and Business plans.",
    },
  });
  const response = await instance.request({ text: "Draft", field: "general_business_text" });
  assert.equal(response.status, 403);
  assert.equal(instance.observed.completions.length, 0);
});

test("an empty provider response marks the claim failed", async () => {
  const instance = fixture({ modelReply: "" });
  const response = await instance.request({ text: "Draft", field: "client_notes" });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "AI Rewrite is unavailable right now. Please try again." });
  assert.equal(instance.observed.rpcs.at(-1).name, "complete_ai_rewrite_usage");
  assert.equal(instance.observed.rpcs.at(-1).params.p_status, "failed");
});
