import assert from "node:assert/strict";
import test from "node:test";
import {
  formatFileSize,
  hasPdfHeader,
  normalizePdfAsset,
  pdfFileName
} from "../static/pdf-reader-core.js";

test("PDF reader only accepts same-origin SiYuan asset paths", () => {
  assert.equal(
    normalizePdfAsset("/assets/项目%20资料/说明.pdf", "http://127.0.0.1:6806"),
    "/assets/%E9%A1%B9%E7%9B%AE%20%E8%B5%84%E6%96%99/%E8%AF%B4%E6%98%8E.pdf"
  );
  assert.throws(() => normalizePdfAsset("https://example.com/a.pdf", "http://127.0.0.1:6806"), /仅允许/);
  assert.throws(() => normalizePdfAsset("/data/a.pdf", "http://127.0.0.1:6806"), /仅允许/);
  assert.throws(() => normalizePdfAsset("/assets/a\\b.pdf", "http://127.0.0.1:6806"), /仅允许/);
});

test("PDF header inspection accepts legal leading metadata and rejects non-PDF files", () => {
  assert.equal(hasPdfHeader(new TextEncoder().encode("%PDF-1.7\n")), true);
  assert.equal(hasPdfHeader(new TextEncoder().encode("\ufeff\n%PDF-1.4\n")), true);
  assert.equal(hasPdfHeader(new TextEncoder().encode("<html>not pdf</html>")), false);
});

test("PDF display names and file sizes remain user-readable", () => {
  assert.equal(pdfFileName("/assets/generated.pdf", "项目报告"), "项目报告.pdf");
  assert.equal(pdfFileName("/assets/generated.pdf", "项目/报告.PDF"), "项目-报告.PDF");
  assert.equal(formatFileSize(512), "512 B");
  assert.equal(formatFileSize(2048), "2.0 KB");
  assert.equal(formatFileSize(3 * 1024 * 1024), "3.00 MB");
});
