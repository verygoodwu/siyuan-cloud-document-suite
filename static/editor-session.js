const SESSION_PREFIX = "siyuan-cloud-document-suite:view:v1";
const themedDocuments = new WeakMap();

// Observe only theme attributes, never the editor subtree; no polling or network requests.
export function syncEditorTheme(doc = document) {
  if (themedDocuments.has(doc)) return themedDocuments.get(doc);
  const win = doc.defaultView;
  let host = doc;
  try {
    let parent = win;
    while (parent.parent !== parent) { parent = parent.parent; host = parent.document; }
  } catch { /* Cross-origin embedding falls back to this document/system theme. */ }
  const media = win.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    const mode = host.documentElement.getAttribute("data-theme-mode");
    const dark = mode === "dark" ? true : mode === "light" ? false : media.matches;
    const palette = dark
      ? { bg: "#202124", panel: "#292a2d", text: "#e8eaed", muted: "#a7adb8", border: "#45474c", accent: "#8ab4f8", soft: "#263b5c", hover: "#37383c" }
      : { bg: "#ffffff", panel: "#f7f8fa", text: "#202124", muted: "#667085", border: "#d0d5dd", accent: "#3478f6", soft: "#edf3ff", hover: "#eef0f4" };
    const style = host.defaultView.getComputedStyle(host.documentElement);
    for (const [key, name] of Object.entries({ bg: "background", panel: "surface", text: "on-background", muted: "on-surface", border: "surface-lighter", accent: "primary" })) {
      const value = style.getPropertyValue(`--b3-theme-${name}`).trim();
      if (value) palette[key] = value;
    }
    const root = doc.documentElement.style;
    for (const [name, key] of Object.entries({ bg: "bg", panel: "panel", "panel-strong": "hover", "cell-bg": "bg", text: "text", muted: "muted", border: "border", "border-strong": "border", accent: "accent", "accent-soft": "soft", hover: "hover", gutter: "panel", "current-line": "soft", "board-bg": "bg", "board-surface": "panel", "board-panel": "panel", "board-panel-hover": "hover", "board-text": "text", "board-muted": "muted", "board-border": "border", "board-accent": "accent" })) root.setProperty(`--${name}`, palette[key]);
    root.setProperty("--shadow", dark ? "#0008" : "#10182822");
    root.setProperty("--board-shadow", dark ? "0 8px 28px #0008" : "0 8px 28px #0002");
    root.setProperty("--board-grid", dark ? "#8b8f9730" : "#c8cdd540");
    root.colorScheme = dark ? "dark" : "light";
  };
  const observer = new win.MutationObserver(apply);
  const themeLoaded = (event) => {
    if (event.target?.tagName === "LINK" && event.target.rel === "stylesheet") apply();
  };
  const observe = () => {
    observer.observe(host.documentElement, { attributes: true, attributeFilter: ["data-theme-mode", "data-light-theme", "data-dark-theme", "class"] });
    host.addEventListener("load", themeLoaded, true);
    apply();
  };
  const pause = () => {
    observer.disconnect();
    host.removeEventListener("load", themeLoaded, true);
  };
  const dispose = () => {
    observer.disconnect();
    media.removeEventListener("change", apply);
    win.removeEventListener("pagehide", pause);
    win.removeEventListener("pageshow", observe);
    host.removeEventListener("load", themeLoaded, true);
    themedDocuments.delete(doc);
  };
  media.addEventListener("change", apply);
  win.addEventListener("pagehide", pause);
  win.addEventListener("pageshow", observe);
  themedDocuments.set(doc, dispose);
  observe();
  return dispose;
}

// Conservative UTF-16 payload budget; keep the current snapshot even if it alone exceeds it.
export function trimSnapshotHistory(history, maxBytes = 16 * 1024 * 1024, maxEntries = 100) {
  let bytes = history.reduce((total, snapshot) => total + snapshot.length * 2, 0);
  let removed = 0;
  while (history.length > 1 && (history.length > maxEntries || bytes > maxBytes)) {
    bytes -= history.shift().length * 2;
    removed += 1;
  }
  return { removed, bytes };
}

export function editorDialog({ title, message = "", value, validate = () => "", confirmLabel = "确定", restoreFocus }, doc = document) {
  if (doc.querySelector(".cloud-dialog[open]")) return Promise.resolve(null);
  const previous = doc.activeElement;
  if (!doc.getElementById("cloud-dialog-style")) {
    const style = doc.createElement("style");
    style.id = "cloud-dialog-style";
    style.textContent = `.cloud-dialog{box-sizing:border-box;width:min(420px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;padding:20px;border:1px solid var(--border,#cbd0d8);border-radius:12px;background:var(--panel,#fff);color:var(--text,#202124);font:14px/1.5 system-ui}.cloud-dialog::backdrop{background:#0005}.cloud-dialog h2{margin:0 0 10px;font-size:18px}.cloud-dialog p{margin:8px 0}.cloud-dialog input{box-sizing:border-box;width:100%;padding:8px;border:1px solid var(--border,#cbd0d8);border-radius:6px;color:inherit;background:var(--bg,#fff);font:inherit}.cloud-dialog [role=alert]{min-height:22px;color:#d92d20}.cloud-dialog footer{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.cloud-dialog button{padding:6px 14px;border:1px solid var(--border,#cbd0d8);border-radius:6px;background:var(--bg,#fff);color:inherit;cursor:pointer}.cloud-dialog button[type=submit]{background:var(--accent,#3370ff);color:white}`;
    doc.head.append(style);
  }
  return new Promise((resolve) => {
    const dialog = doc.createElement("dialog");
    dialog.className = "cloud-dialog";
    dialog.setAttribute("aria-label", title);
    const form = doc.createElement("form");
    const heading = doc.createElement("h2"); heading.textContent = title;
    const description = doc.createElement("p"); description.textContent = message;
    const input = doc.createElement("input"); input.value = value ?? ""; input.setAttribute("aria-label", title);
    const error = doc.createElement("p"); error.setAttribute("role", "alert");
    const footer = doc.createElement("footer");
    const cancel = doc.createElement("button"); cancel.type = "button"; cancel.textContent = "取消";
    const submit = doc.createElement("button"); submit.type = "submit"; submit.textContent = confirmLabel;
    footer.append(cancel, submit);
    form.append(heading, description);
    if (value !== undefined) form.append(input);
    form.append(error, footer); dialog.append(form); doc.body.append(dialog);
    let result = null;
    cancel.addEventListener("click", () => dialog.close());
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const next = value === undefined ? true : input.value.trim();
      const reason = validate(next);
      error.textContent = reason || "";
      input.setAttribute("aria-invalid", String(Boolean(reason)));
      if (reason) { input.focus(); return; }
      result = next; dialog.close();
    });
    dialog.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") { event.preventDefault(); dialog.close(); }
      event.stopPropagation();
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (restoreFocus) restoreFocus(); else if (previous?.isConnected) previous.focus({ preventScroll: true });
      resolve(result);
    }, { once: true });
    dialog.showModal();
    if (value !== undefined) { input.focus(); input.select(); } else cancel.focus();
  });
}

function storageKey(kind, asset) {
  return `${SESSION_PREFIX}:${kind}:${String(asset || "unknown")}`;
}

export function createEditorSession(kind, asset, storage = globalThis.localStorage) {
  const key = storageKey(kind, asset);
  return {
    key,
    read() {
      try {
        const value = JSON.parse(storage?.getItem(key) || "null");
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
      } catch {
        return {};
      }
    },
    write(patch) {
      try {
        const previous = this.read();
        const next = { ...previous, ...patch, updatedAt: Date.now() };
        const serialized = JSON.stringify(next);
        if (serialized.length > 16 * 1024) return false;
        storage?.setItem(key, serialized);
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      try { storage?.removeItem(key); } catch { /* Ignore unavailable storage. */ }
    }
  };
}

export function createOperationNotice(doc = document) {
  syncEditorTheme(doc);
  if (!doc.getElementById("cloud-editor-notice-style")) {
    // Let the browser/IME finish composition without dispatching editor commands.
    doc.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) event.stopPropagation();
    }, true);
    const style = doc.createElement("style");
    style.id = "cloud-editor-notice-style";
    style.textContent = `
      .cloud-editor-notice{position:fixed;z-index:10000;left:50%;bottom:46px;display:flex;max-width:min(680px,calc(100vw - 24px));align-items:center;gap:8px;padding:8px 11px;border:1px solid #d8dce3;border-radius:8px;background:#202124;color:#fff;box-shadow:0 8px 28px #0004;transform:translateX(-50%);font:13px/1.35 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
      .cloud-editor-notice[hidden]{display:none}.cloud-editor-notice[data-tone="error"]{background:#8f271f}.cloud-editor-notice[data-tone="warning"]{background:#765700}.cloud-editor-notice__message{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cloud-editor-notice__actions{display:flex;flex:0 0 auto;gap:5px}.cloud-editor-notice__actions button{height:26px;padding:0 8px;border:1px solid #ffffff55;border-radius:5px;background:#ffffff18;color:#fff;cursor:pointer;font:inherit}.cloud-editor-notice__actions button:hover,.cloud-editor-notice__actions button:focus-visible{background:#ffffff2c;outline:0}
      @media(max-width:620px){.cloud-editor-notice{bottom:38px;align-items:flex-start}.cloud-editor-notice__message{white-space:normal}.cloud-editor-notice__actions{max-width:45vw;overflow-x:auto}}
    `;
    doc.head.append(style);
  }
  const root = doc.createElement("div");
  root.className = "cloud-editor-notice";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.hidden = true;
  const message = doc.createElement("span");
  message.className = "cloud-editor-notice__message";
  const actionsHost = doc.createElement("span");
  actionsHost.className = "cloud-editor-notice__actions";
  root.append(message, actionsHost);
  doc.body.append(root);
  let timer;

  return {
    show(text, { tone = "default", duration = 2600, actions = [] } = {}) {
      clearTimeout(timer);
      message.textContent = String(text);
      root.dataset.tone = tone;
      actionsHost.replaceChildren();
      for (const action of actions) {
        if (!action?.label || typeof action.run !== "function") continue;
        const button = doc.createElement("button");
        button.type = "button";
        button.textContent = action.label;
        button.addEventListener("click", () => {
          root.hidden = true;
          action.run();
        });
        actionsHost.append(button);
      }
      root.hidden = false;
      if (duration > 0) timer = setTimeout(() => { root.hidden = true; }, duration);
    },
    hide() {
      clearTimeout(timer);
      root.hidden = true;
    }
  };
}

export function showStoreOpenError(error, store, notice, setStatus, reload = () => location.reload()) {
  const message = error instanceof Error ? error.message : String(error);
  if (error?.code !== "ASSET_MISSING") {
    setStatus?.(message, "error");
    return false;
  }
  setStatus?.("附件不存在，已暂停编辑", "error");
  const actions = [];
  if (error.recoverable) {
    actions.push({
      label: "恢复附件",
      run: async () => {
        notice.show("正在从当前浏览器的安全副本恢复附件…", { duration: 0 });
        try {
          await store.restoreBackup();
          notice.show("附件已恢复并校验，正在重新打开…");
          setTimeout(reload, 250);
        } catch (restoreError) {
          notice.show(`恢复失败：${restoreError instanceof Error ? restoreError.message : String(restoreError)}`, {
            tone: "error",
            duration: 0
          });
        }
      }
    });
  }
  actions.push({ label: "重新检查", run: reload });
  notice.show(
    error.recoverable
      ? "思源附件已不存在或被同步隔离，可以从当前浏览器的安全副本恢复。"
      : "思源附件已不存在或被同步隔离；当前浏览器没有安全副本，请从思源历史或同步冲突目录恢复。",
    { tone: "error", duration: 0, actions }
  );
  return true;
}

export function showLeaseState(store, notice, setStatus) {
  if (store.canEdit()) return false;
  const message = store.leaseDescription() || "该附件正在另一个页面中编辑";
  setStatus?.(`只读：${message}`, "error");
  notice.show(`${message}。当前页面已切换为只读，避免互相覆盖。`, {
    tone: "warning",
    duration: 0,
    actions: [{ label: "重新获取编辑权", run: async () => {
      const result = await store.acquireEditLease();
      if (result.acquired) {
        notice.show("已恢复编辑；保存时仍会检查远端内容是否发生变化。");
        setStatus?.("已恢复编辑", "idle");
      } else showLeaseState(store, notice, setStatus);
    } }]
  });
  return true;
}

export function watchEditLease(store, notice, setStatus, update) {
  store.onLeaseChange = (editable) => {
    update(editable);
    if (!editable) showLeaseState(store, notice, setStatus);
  };
  const check = () => {
    if (document.visibilityState !== "hidden" && store.leaseState === "acquired") void store.renewEditLease();
  };
  document.addEventListener("visibilitychange", check);
  window.addEventListener("focus", check);
  window.addEventListener("pagehide", () => {
    store.onLeaseChange = null;
    document.removeEventListener("visibilitychange", check);
    window.removeEventListener("focus", check);
  }, { once: true });
}

export function downloadBytes(bytes, fileName, mimeType = "application/octet-stream") {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
