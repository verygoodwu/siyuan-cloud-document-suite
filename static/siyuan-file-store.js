export class SaveConflictError extends Error {
  constructor(message = "思源中的附件已被其他页面或设备修改") {
    super(message);
    this.name = "SaveConflictError";
    this.code = "SAVE_CONFLICT";
  }
}

export class MissingAssetError extends Error {
  constructor(message = "思源附件不存在或已被同步移入冲突目录", recoverable = false) {
    super(message);
    this.name = "MissingAssetError";
    this.code = "ASSET_MISSING";
    this.recoverable = Boolean(recoverable);
  }
}

export class EditLeaseError extends Error {
  constructor(message = "该附件正在另一个页面中编辑") {
    super(message);
    this.name = "EditLeaseError";
    this.code = "EDIT_LEASE_DENIED";
  }
}

const RECOVERY_SCHEMA = "siyuan-cloud-document-recovery-v1";
const BACKUP_DB = "siyuan-cloud-document-suite-recovery-v1";
const BACKUP_STORE = "asset-backups";
const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
const LEASE_DIRECTORY = "/temp/siyuan-cloud-document-suite/edit-locks";
const LEASE_TTL_MS = 45_000;
const LEASE_RENEW_MS = 15_000;
const utf8Encoder = new TextEncoder();

function randomId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function openBackupDatabase() {
  if (typeof globalThis.indexedDB?.open !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = globalThis.indexedDB.open(BACKUP_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(BACKUP_STORE)) {
        request.result.createObjectStore(BACKUP_STORE, { keyPath: "asset" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

const defaultBackupStore = {
  async read(asset) {
    const database = await openBackupDatabase();
    if (!database) return null;
    return new Promise((resolve) => {
      const transaction = database.transaction(BACKUP_STORE, "readonly");
      const request = transaction.objectStore(BACKUP_STORE).get(asset);
      request.onsuccess = () => {
        const bytes = request.result?.bytes;
        resolve(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null);
      };
      request.onerror = () => resolve(null);
      transaction.oncomplete = () => database.close();
      transaction.onabort = () => database.close();
    });
  },
  async write(asset, bytes) {
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (source.byteLength > MAX_BACKUP_BYTES) return false;
    const database = await openBackupDatabase();
    if (!database) return false;
    return new Promise((resolve) => {
      const transaction = database.transaction(BACKUP_STORE, "readwrite");
      transaction.objectStore(BACKUP_STORE).put({
        asset,
        bytes: source.slice().buffer,
        updatedAt: Date.now()
      });
      transaction.oncomplete = () => { database.close(); resolve(true); };
      transaction.onerror = () => { database.close(); resolve(false); };
      transaction.onabort = () => { database.close(); resolve(false); };
    });
  }
};

export function stripKnownTextResponseInjection(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const hasBom = source.length >= 3 && source[0] === 0xef && source[1] === 0xbb && source[2] === 0xbf;
  const payload = hasBom ? source.subarray(3) : source;
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(payload);
  } catch {
    return source;
  }
  if (!text.includes("local.adguard.org")) return source;
  const cleaned = text.replace(
    /<script\b(?=[^>]*\bsrc=["']\/\/local\.adguard\.org\?[^"']*(?:type=(?:content-script|user-script)|name=AdGuard))[^>]*><\/script>/gi,
    ""
  );
  if (cleaned === text) return source;
  const encoded = utf8Encoder.encode(cleaned);
  if (!hasBom) return encoded;
  const result = new Uint8Array(encoded.length + 3);
  result.set([0xef, 0xbb, 0xbf]);
  result.set(encoded, 3);
  return result;
}

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function rotateRight(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Fallback(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const message = new Uint8Array(paddedLength);
  message.set(source);
  message[source.length] = 0x80;
  const view = new DataView(message.buffer);
  const bitLength = source.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);
  const schedule = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index++) {
      schedule[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index++) {
      const first = schedule[index - 15];
      const second = schedule[index - 2];
      const sigma0 = rotateRight(first, 7) ^ rotateRight(first, 18) ^ (first >>> 3);
      const sigma1 = rotateRight(second, 17) ^ rotateRight(second, 19) ^ (second >>> 10);
      schedule[index] = (schedule[index - 16] + sigma0 + schedule[index - 7] + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index++) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choice + SHA256_CONSTANTS[index] + schedule[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  return Array.from(state, (value) => value.toString(16).padStart(8, "0")).join("");
}

export async function contentHash(bytes, subtleCrypto = globalThis.crypto?.subtle || null) {
  if (typeof subtleCrypto?.digest === "function") {
    try {
      const hash = await subtleCrypto.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
    } catch {
      // LAN/browser-desktop can expose crypto without a usable SubtleCrypto.
    }
  }
  return sha256Fallback(bytes);
}

function cacheBusted(url) {
  const value = new URL(url, location.origin);
  value.searchParams.set("cloudDocReload", String(Date.now()));
  return value.href;
}

export class SiyuanFileStore {
  constructor(asset, recoveryKey, { rawApi = false, backupStore = defaultBackupStore } = {}) {
    if (!asset) throw new Error("缺少附件路径");
    const url = new URL(asset, location.origin);
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      pathname = url.pathname;
    }
    const segments = pathname.split("/");
    if (url.origin !== location.origin
      || !pathname.startsWith("/assets/")
      || pathname.includes("\\")
      || pathname.includes("\0")
      || segments.some((segment) => segment === "." || segment === "..")) {
      throw new Error("仅允许保存思源 assets 目录中的附件");
    }
    this.asset = url.pathname;
    this.workspacePath = `/data${pathname}`;
    this.filename = pathname.split("/").pop() || "attachment";
    this.recoveryKey = recoveryKey;
    this.rawApi = Boolean(rawApi);
    this.backupStore = backupStore;
    this.baseHash = null;
    this.conflicted = false;
    this.leaseOwner = randomId();
    this.leasePath = null;
    this.leaseState = "idle";
    this.leaseHolder = null;
    this.leaseTimer = null;
    this.releaseBound = false;
  }

  canEdit() {
    return this.leaseState !== "denied" && this.leaseState !== "lost";
  }

  leaseDescription() {
    if (this.canEdit()) return "";
    const expiresAt = Number(this.leaseHolder?.expiresAt) || 0;
    const until = expiresAt > Date.now() ? `，锁将在 ${new Date(expiresAt).toLocaleTimeString()} 后自动释放` : "";
    return `该附件正在另一个页面中编辑${until}`;
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

  async tryMarkForSync(hash) {
    try {
      return await this.markForSync(hash);
    } catch (error) {
      // putFile already asks the SiYuan kernel to sync. The block attribute is
      // an additional revision marker and must not turn a completed write into
      // a false save failure.
      console.warn("[Cloud Document Suite] Cannot write the optional sync marker", error);
      return false;
    }
  }

  async fetchRemote() {
    if (this.rawApi) {
      const response = await fetch("/api/file/getFile", {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/octet-stream",
          "Range": "bytes=0-",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: JSON.stringify({ path: this.workspacePath })
      });
      if (!response.ok) {
        let missing = response.status === 404;
        if (response.status === 202) {
          try { missing = Number((await response.clone().json())?.code) === 404; } catch { /* Non-JSON error. */ }
        }
        if (missing) throw new MissingAssetError(undefined, Boolean(await this.backupStore.read(this.asset)));
        throw new Error(`读取原始附件失败：HTTP ${response.status}`);
      }
      return stripKnownTextResponseInjection(new Uint8Array(await response.arrayBuffer()));
    }
    const response = await fetch(cacheBusted(this.asset), {
      cache: "no-store",
      credentials: "include"
    });
    if (!response.ok) {
      if (response.status === 404) {
        throw new MissingAssetError(undefined, Boolean(await this.backupStore.read(this.asset)));
      }
      throw new Error(`读取附件失败：HTTP ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async loadRemote() {
    const bytes = await this.fetchRemote();
    this.baseHash = await contentHash(bytes);
    void this.backupStore.write(this.asset, bytes);
    return bytes;
  }

  async openRemote() {
    await this.acquireEditLease();
    return this.loadRemote();
  }

  async postFile(path, bytes, isDir = false) {
    const form = new FormData();
    form.append("path", path);
    form.append("isDir", isDir ? "true" : "false");
    if (!isDir) {
      const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
      form.append("file", new Blob([source]), path.split("/").pop() || "file");
    }
    const response = await fetch("/api/file/putFile", {
      method: "POST",
      credentials: "include",
      body: form
    });
    if (!response.ok) throw new Error(`写入思源失败：HTTP ${response.status}`);
    const result = await response.json();
    if (result.code !== 0) throw new Error(result.msg || `写入思源失败：${result.code}`);
  }

  async readWorkspaceJson(path) {
    const response = await fetch("/api/file/getFile", {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ path })
    });
    if (response.status === 202 || response.status === 404) return null;
    if (!response.ok) throw new Error(`读取编辑锁失败：HTTP ${response.status}`);
    try { return await response.json(); } catch { return null; }
  }

  async writeLease(lease) {
    await this.postFile(this.leasePath, utf8Encoder.encode(`${JSON.stringify(lease)}\n`));
  }

  async acquireEditLease({ ttl = LEASE_TTL_MS } = {}) {
    if (this.leaseState === "acquired") return { acquired: true, holder: null };
    if (!this.leasePath) {
      const key = await contentHash(utf8Encoder.encode(this.asset));
      this.leasePath = `${LEASE_DIRECTORY}/${key}.json`;
    }
    try {
      await this.postFile(LEASE_DIRECTORY, null, true);
      const existing = await this.readWorkspaceJson(this.leasePath);
      if (existing?.owner && existing.owner !== this.leaseOwner && Number(existing.expiresAt) > Date.now()) {
        this.leaseState = "denied";
        this.leaseHolder = existing;
        return { acquired: false, holder: existing };
      }
      const proposed = {
        schema: "siyuan-cloud-document-edit-lease-v1",
        owner: this.leaseOwner,
        asset: this.asset,
        expiresAt: Date.now() + ttl
      };
      await this.writeLease(proposed);
      await new Promise((resolve) => setTimeout(resolve, 80));
      const confirmed = await this.readWorkspaceJson(this.leasePath);
      if (confirmed?.owner !== this.leaseOwner) {
        this.leaseState = "denied";
        this.leaseHolder = confirmed;
        return { acquired: false, holder: confirmed };
      }
      this.leaseState = "acquired";
      this.leaseHolder = null;
      clearInterval(this.leaseTimer);
      this.leaseTimer = setInterval(() => void this.renewEditLease(), LEASE_RENEW_MS);
      if (!this.releaseBound && typeof globalThis.addEventListener === "function") {
        this.releaseBound = true;
        globalThis.addEventListener("pagehide", () => void this.releaseEditLease(), { once: true });
      }
      return { acquired: true, holder: null };
    } catch (error) {
      // A missing temp-file API must not make the editor unusable. Hash based
      // optimistic concurrency remains active as the cross-kernel fallback.
      console.warn("[Cloud Document Suite] Edit lease unavailable", error);
      this.leaseState = "unavailable";
      return { acquired: true, holder: null, unavailable: true };
    }
  }

  async renewEditLease() {
    if (this.leaseState !== "acquired") return false;
    try {
      const current = await this.readWorkspaceJson(this.leasePath);
      if (current?.owner !== this.leaseOwner) {
        this.leaseState = "lost";
        this.leaseHolder = current;
        clearInterval(this.leaseTimer);
        return false;
      }
      await this.writeLease({ ...current, expiresAt: Date.now() + LEASE_TTL_MS });
      return true;
    } catch {
      return false;
    }
  }

  async assertEditLease() {
    if (this.leaseState === "denied" || this.leaseState === "lost") {
      throw new EditLeaseError(this.leaseDescription());
    }
    if (this.leaseState !== "acquired") return true;
    const current = await this.readWorkspaceJson(this.leasePath);
    if (current?.owner !== this.leaseOwner || Number(current.expiresAt) <= Date.now()) {
      this.leaseState = "lost";
      this.leaseHolder = current;
      throw new EditLeaseError("编辑锁已失效，为防止覆盖其他页面，当前修改没有写入思源");
    }
    return true;
  }

  async releaseEditLease() {
    clearInterval(this.leaseTimer);
    if (this.leaseState !== "acquired" || !this.leasePath) return false;
    try {
      const current = await this.readWorkspaceJson(this.leasePath);
      if (current?.owner !== this.leaseOwner) return false;
      const response = await fetch("/api/file/removeFile", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: this.leasePath })
      });
      this.leaseState = "released";
      return response.ok;
    } catch {
      return false;
    }
  }

  async restoreBackup() {
    const bytes = await this.backupStore.read(this.asset);
    if (!bytes) throw new Error("当前浏览器没有可用的附件恢复副本");
    await this.assertEditLease();
    await this.postFile(this.workspacePath, bytes);
    const verified = await this.fetchRemote();
    if (await contentHash(verified) !== await contentHash(bytes)) {
      throw new Error("恢复附件后的内容校验失败");
    }
    this.baseHash = await contentHash(verified);
    return verified;
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

  clearRecovery(expectedSnapshot) {
    if (expectedSnapshot !== undefined
      && localStorage.getItem(this.recoveryKey) !== expectedSnapshot) {
      return false;
    }
    localStorage.removeItem(this.recoveryKey);
    return true;
  }

  async save(bytes, { force = false } = {}) {
    await this.assertEditLease();
    const desired = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    // Capture before the first await. A newer edit may replace this recovery
    // entry while the network write is in flight and must not be cleared by it.
    const recoverySnapshot = localStorage.getItem(this.recoveryKey);
    const desiredHash = await contentHash(desired);
    const current = await this.fetchRemote();
    const currentHash = await contentHash(current);

    if (currentHash === desiredHash) {
      const syncMarked = await this.tryMarkForSync(desiredHash);
      this.baseHash = desiredHash;
      this.conflicted = false;
      this.clearRecovery(recoverySnapshot);
      return { unchanged: true, hash: desiredHash, syncMarked };
    }
    if (!force && this.baseHash && currentHash !== this.baseHash) {
      this.conflicted = true;
      throw new SaveConflictError();
    }

    const form = new FormData();
    form.append("path", this.workspacePath);
    form.append("isDir", "false");
    form.append("file", new Blob([desired]), this.filename);
    const response = await fetch("/api/file/putFile", {
      method: "POST",
      credentials: "include",
      body: form
    });
    if (!response.ok) throw new Error(`写入思源失败：HTTP ${response.status}`);
    const result = await response.json();
    if (result.code !== 0) throw new Error(result.msg || `写入思源失败：${result.code}`);

    const verified = await this.fetchRemote();
    const verifiedHash = await contentHash(verified);
    if (verifiedHash !== desiredHash) {
      throw new Error("写入思源后的附件校验失败，本机恢复数据已保留");
    }

    const syncMarked = await this.tryMarkForSync(desiredHash);

    void this.backupStore.write(this.asset, verified);

    this.baseHash = desiredHash;
    this.conflicted = false;
    this.clearRecovery(recoverySnapshot);
    return { unchanged: false, hash: desiredHash, syncMarked };
  }
}
