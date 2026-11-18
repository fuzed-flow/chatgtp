import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["src/components/pdf/PDFGenerator.jsx"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  loader: { ".jsx": "jsx" },
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`;
const { generateQuotePDF } = await import(moduleUrl);

for (const clientMessage of ['', 'CUSTOM-CLIENT-MESSAGE', null]) {
  test(`quote PDF respects the saved client message: ${JSON.stringify(clientMessage)}`, async () => {
    const base64 = await generateQuotePDF(
      { returnBase64: true, quote_number: 'TEST-MESSAGE', title: 'Client message test', client_message: clientMessage },
      { name: 'Test Client' }, [], [],
      { name: 'Test Company', settings: { quote_client_message: 'DEFAULT-CLIENT-MESSAGE' } },
    );
    const source = Buffer.from(base64, 'base64').toString('latin1');
    assert.equal(source.includes('DEFAULT-CLIENT-MESSAGE'), clientMessage === null);
    assert.equal(source.includes('CUSTOM-CLIENT-MESSAGE'), clientMessage === 'CUSTOM-CLIENT-MESSAGE');
    assert.equal(source.includes('Message from the Team'), clientMessage !== '');
  });
}

test("long quote terms continue across PDF pages without losing the final clause", async () => {
  const finalClause = "FINAL-TERMS-CLAUSE-120";
  const terms = Array.from({ length: 120 }, (_, index) => (
    index === 119
      ? finalClause
      : `Clause ${index + 1}: This is a long test term that must remain visible.`
  )).join("\n");

  const base64 = await generateQuotePDF(
    {
      returnBase64: true,
      quote_number: "TEST-LONG-TERMS",
      title: "Long terms pagination test",
      issue_date: "2026-10-13",
      terms,
      subtotal: 0,
      tax: 0,
      total: 0,
    },
    { name: "Test Client" },
    [],
    [],
    { name: "Test Company", settings: { currency: "CAD" } },
  );

  const pdfSource = Buffer.from(base64, "base64").toString("latin1");
  const pageCount = (pdfSource.match(/\/Type \/Page\b/g) || []).length;

  assert.ok(pageCount >= 3, `expected at least 3 pages, received ${pageCount}`);
  assert.ok(pdfSource.includes("Terms & Conditions \\(continued\\)"));
  assert.match(pdfSource, new RegExp(finalClause));
});
