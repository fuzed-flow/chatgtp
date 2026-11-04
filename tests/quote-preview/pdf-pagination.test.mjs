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

test("quote layouts wrap long items and show the same selected prices and deposit", async () => {
  const flooring = "MSI Stone ULC Ibis Oak 6 MIL x 6-inch W x 36-inch L Waterproof Luxury Vinyl Plank Flooring";
  const quote = {
    returnBase64: true,
    quote_number: "TEST-WRAP",
    deposit_amount: 504.10,
    discount_amount: 25,
    client_selected_items_json: '{"optional":false}',
  };
  const phases = [{ id: "materials", phase_name: "Materials" }];
  const items = [
    { name: flooring, phase_id: "materials", quantity: 200, unit: "sqft", unit_price: 4.92, taxable: true },
    { id: "optional", name: "Excluded item", phase_id: "materials", unit_price: 500, is_optional: true },
  ];
  const organization = { settings: { currency: "CAD", tax_rate: 5, tax_label: "GST" } };

  for (const [layout, pageWidth] of [[undefined, 595], ["mobile", 283]]) {
    const result = await generateQuotePDF(quote, null, phases, items, organization, { layout });
    const pdf = Buffer.from(result, "base64").toString("latin1");
    const cover = pdf.split("endstream")[0];
    assert.match(pdf, new RegExp(`/MediaBox \\[0 0 ${pageWidth}\\.`));
    const text = [...pdf.matchAll(/\(([^()]*)\) Tj/g)].map(match => match[1]);
    const start = text.findIndex(line => line.startsWith("MSI Stone ULC"));
    const end = text.findIndex(line => line.endsWith("Flooring"));
    assert.ok(start >= 0 && end > start, "long product name must span more than one line");
    assert.equal(text.slice(start, end + 1).join(" "), flooring);
    assert.ok(!pdf.includes("Excluded item"));
    assert.match(cover, /\(Quote Total\) Tj/);
    assert.match(cover, /\(CAD 1,008\.20\) Tj/);
    assert.match(cover, /\(CAD 504\.10\) Tj/);
    assert.match(pdf, /CAD 984\.00/);
    assert.match(pdf, /CAD 49\.20/);
    assert.match(pdf, /-CAD 25\.00/);
    assert.equal((pdf.match(/CAD 1,008\.20/g) || []).length, 2);
  }
});

test("both quote PDF covers fit wide and portrait banners proportionally", async (t) => {
  const jpegPrefix = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCA";
  const jpegSuffix = "BAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AAAD/2Q==";
  const savedImage = globalThis.Image;
  const savedDocument = globalThis.document;
  t.after(() => {
    globalThis.Image = savedImage;
    globalThis.document = savedDocument;
  });

  for (const [width, height, dimensions] of [[30, 10, "AKAB4"], [10, 30, "AeAAo"]]) {
    const banner = `data:image/jpeg;base64,${jpegPrefix}${dimensions}${jpegSuffix}`;
    globalThis.Image = class {
      width = width;
      height = height;
      set src(url) {
        URL.revokeObjectURL(url);
        this.onload();
      }
    };
    globalThis.document = { createElement: () => ({
      getContext: () => ({ fillRect() {}, drawImage() {} }),
      toDataURL: () => banner,
    }) };

    for (const [layout, pageWidth, margin, maxHeight] of [[undefined, 210, 15, 65], ["mobile", 100, 6, 35]]) {
      const result = await generateQuotePDF({ returnBase64: true, hero_image_url: banner }, null, [], [], null, { layout });
      const cover = Buffer.from(result, "base64").toString("latin1").split("endstream")[0];
      const placement = cover.match(/([\d.]+) 0 0 ([\d.]+) ([\d.]+) [\d.]+ cm\n\/I\d+ Do/);
      assert.ok(placement, "banner is drawn on the cover");
      const [drawnWidth, drawnHeight, left] = placement.slice(1).map(value => Number(value) * 25.4 / 72);
      assert.ok(Math.abs(drawnWidth / drawnHeight - width / height) < 0.001);
      assert.ok(Math.abs(left * 2 + drawnWidth - pageWidth) < 0.01);
      assert.ok(Math.abs((width > height ? drawnWidth : drawnHeight) - (width > height ? pageWidth - margin * 2 : maxHeight)) < 0.01);
      assert.match(cover, /\(Quote Total\) Tj/);
    }
  }
});
