import type { CreatedDocument } from "./document-creator";

export interface ImportResult {
  name: string;
  document?: CreatedDocument;
  warning?: string;
  error?: string;
}

const escape = (value: string) => value.replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!
);

export function renderImportResults(destination: string, results: ImportResult[]): string {
  const succeeded = results.filter(result => result.document).length;
  const warnings = results.filter(result => result.warning).length;
  const summary = `成功 ${succeeded} 个 · 失败 ${results.length - succeeded} 个${warnings ? ` · ${warnings} 个预览异常` : ""}`;
  return `<section style="padding:16px 20px 20px">
    <p style="margin:0 0 4px;overflow-wrap:anywhere">${escape(destination)}</p>
    <p style="margin:0 0 12px;color:var(--b3-theme-on-surface)">${summary}</p>
    <ul role="list" style="padding:0;margin:0;list-style:none;overflow:auto;max-height:50vh">
      ${results.map((result, index) => {
        const detail = result.error || result.warning;
        const status = result.error ? "失败" : result.warning ? "已导入，预览失败" : "已导入";
        return `<li style="display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--b3-border-color)">
          <div style="min-width:0;flex:1;overflow-wrap:anywhere">
            <div style="font-weight:600">${escape(result.document?.title || result.name)}</div>
            <div style="color:${result.error ? "var(--b3-theme-error)" : "var(--b3-theme-on-surface)"};font-size:12px;margin-top:3px">${status}${detail ? ` · ${escape(detail)}` : ""}</div>
          </div>
          ${result.document ? `<button type="button" class="b3-button b3-button--outline" data-import-open="${index}" aria-label="打开 ${escape(result.document.title)}">打开</button>` : ""}
        </li>`;
      }).join("")}
    </ul>
    <div style="display:flex;justify-content:flex-end;padding-top:14px">
      <button type="button" class="b3-button" data-import-close>关闭</button>
    </div>
  </section>`;
}
