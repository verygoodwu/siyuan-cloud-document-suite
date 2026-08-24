export class SaveConflictError extends Error {
  constructor(message = "思源中的附件已被其他页面或设备修改") {
    super(message);
    this.name = "SaveConflictError";
    this.code = "SAVE_CONFLICT";
  }
}

const RECOVERY_SCHEMA = "siyuan-cloud-document-recovery-v1";

async function sha256(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
}

function cacheBusted(url) {
  const value = new URL(url, location.origin);
  value.searchParams.set("cloudDocReload", String(Date.now()));
  return value.href;
}

export class SiyuanFileStore {
  constructor(asset, recoveryKey) {
    if (!asset) throw new Error("缺少附件路径");
    const url = new URL(asset, location.origin);
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      pathname = url.pathname;
    }
    if (url.origin !== location.origin || !pathname.startsWith("/assets/")) {
      throw new Error("仅允许保存思源 assets 目录中的附件");
    }
    this.asset = url.pathname;
    this.workspacePath = `/data${pathname}`;
    this.filename = pathname.split("/").pop() || "attachment";
    this.recoveryKey = recoveryKey;
    this.baseHash = null;
    this.conflicted = false;
  }

  findHostBlockId() {
    try {
      const explicit = new URL(location.href).searchParams.get("block");
      if (explicit) return explicit;
      return window.frameElement
        ?.closest?.("[data-node-id]")
        ?.getAttribute("data-node-id") || null;
    } catch {
      return null;
    }
  }

  async markForSync(hash) {
    const blockId = this.findHostBlockId();
    if (!blockId) return false;
    const response = await fetch("/api/attr/setBlockAttrs", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: blockId,
        attrs: {
          "custom-cloud-document-revision": `${Date.now()}-${hash.slice(0, 16)}`
        }
      })
    });
    if (!response.ok) throw new Error(`写入同步标记失败：HTTP ${response.status}`);
    const result = await response.json();
    if (result.code !== 0) throw new Error(result.msg || `写入同步标记失败：${result.code}`);
    return true;
  }

  async fetchRemote() {
    const response = await fetch(cacheBusted(this.asset), {
      cache: "no-store",
      credentials: "include"
    });
    if (!response.ok) throw new Error(`读取附件失败：HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async loadRemote() {
    const bytes = await this.fetchRemote();
    this.baseHash = await sha256(bytes);
    return bytes;
  }

  readRecovery() {
    const text = localStorage.getItem(this.recoveryKey);
    if (!text) return null;
    try {
      const value = JSON.parse(text);
      if (value?.schema === RECOVERY_SCHEMA) return { legacy: false, ...value };
      return { legacy: true, payload: value, baseHash: null, updatedAt: null };
    } catch {
      return null;
    }
  }

  cacheRecovery(payload) {
    localStorage.setItem(this.recoveryKey, JSON.stringify({
      schema: RECOVERY_SCHEMA,
      baseHash: this.baseHash,
      updatedAt: Date.now(),
      payload
    }));
  }

  clearRecovery() {
    localStorage.removeItem(this.recoveryKey);
  }

  async save(bytes, { force = false } = {}) {
    const desired = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const desiredHash = await sha256(desired);
    const current = await this.fetchRemote();
    const currentHash = await sha256(current);

    if (currentHash === desiredHash) {
      const syncMarked = await this.markForSync(desiredHash);
      this.baseHash = desiredHash;
      this.conflicted = false;
      this.clearRecovery();
      return { unchanged: true, hash: desiredHash, syncMarked };
    }
    if (!force && this.baseHash && currentHash !== this.baseHash) {
      this.conflicted = true;
      throw new SaveConflictError();
    }

    const form = new FormData();
    form.append("path", this.workspacePath);
    form.append("isDir", "false");
    form.append("modTime", String(Math.floor(Date.now() / 1000)));
    form.append("file", new Blob([desired]), this.filename);
    const response = await fetch("/api/file/putFile", {
      method: "POST",
      credentials: "include",
      body: form
    });
    if (!response.ok) throw new Error(`写入思源失败：HTTP ${response.status}`);
    const result = await response.json();
    if (result.code !== 0) throw new Error(result.msg || `写入思源失败：${result.code}`);

    const syncMarked = await this.markForSync(desiredHash);

    this.baseHash = desiredHash;
    this.conflicted = false;
    this.clearRecovery();
    return { unchanged: false, hash: desiredHash, syncMarked };
  }
}
