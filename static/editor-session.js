const SESSION_PREFIX = "siyuan-cloud-document-suite:view:v1";

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
  if (!doc.getElementById("cloud-editor-notice-style")) {
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
  root.hidden = true;
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
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
    actions: [{ label: "重新检查", run: () => location.reload() }]
  });
  return true;
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
