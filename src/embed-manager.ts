export class EmbedManager {
  private readonly observedContents = new Set<HTMLElement>();
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly editorSelector: string,
    private readonly iframeSelector: string,
    private readonly pluginVersion: string,
    private readonly mmVersion: string
  ) {
    this.resizeObserver = new ResizeObserver(() => this.fit());
  }

  start(): void {
    this.refresh();
    this.fit();
  }

  stop(): void {
    this.resizeObserver.disconnect();
    this.observedContents.clear();
  }

  refresh(): void {
    for (const frame of document.querySelectorAll<HTMLIFrameElement>(this.iframeSelector)) {
      const raw = frame.getAttribute("src") || frame.getAttribute("data-src");
      if (!raw) continue;
      let url: URL;
      try { url = new URL(raw, window.location.href); } catch { continue; }
      if (!/\/plugins\/siyuan-cloud-document-suite\/(?:mm|sheet|whiteboard)-editor\.html$/i.test(url.pathname)) continue;
      const version = /\/mm-editor\.html$/i.test(url.pathname) ? this.mmVersion : this.pluginVersion;
      if (url.searchParams.get("v") === version) continue;
      url.searchParams.set("v", version);
      const next = `${url.pathname}${url.search}${url.hash}`;
      frame.setAttribute("data-src", next);
      frame.setAttribute("src", next);
    }
  }

  affects(records: MutationRecord[]): boolean {
    return records.some((record) => {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (target?.closest(".protyle")?.querySelector(this.iframeSelector)) return true;
      return Array.from(record.addedNodes).some((node) => node instanceof Element && (node.matches(this.iframeSelector) || node.querySelector(this.iframeSelector)));
    });
  }

  fit(): void {
    for (const content of this.observedContents) {
      if (!content.isConnected) {
        this.resizeObserver.unobserve(content);
        this.observedContents.delete(content);
      }
    }
    for (const frame of document.querySelectorAll<HTMLIFrameElement>(this.iframeSelector)) {
      const block = frame.closest<HTMLElement>("[data-node-id].iframe");
      const editor = block?.closest<HTMLElement>(this.editorSelector);
      const content = block?.closest<HTMLElement>(".protyle-content");
      if (!block || !editor || !content) continue;
      if (!this.observedContents.has(content)) {
        this.resizeObserver.observe(content);
        this.observedContents.add(content);
      }
      const style = getComputedStyle(editor);
      const start = Number.parseFloat(style.paddingLeft) || 0;
      const end = Number.parseFloat(style.paddingRight) || 0;
      const contentRect = content.getBoundingClientRect();
      const blockRect = block.getBoundingClientRect();
      const height = Math.max(480, Math.floor(contentRect.bottom - blockRect.top));
      block.style.setProperty("--cloud-document-inline-start", `${-start}px`);
      block.style.setProperty("--cloud-document-inline-extra", `${start + end}px`);
      block.style.setProperty("--cloud-document-editor-height", `${height}px`);
    }
  }
}
