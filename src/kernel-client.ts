import type { AssetUploadData, KernelResponse, UploadedAsset } from "./types";

export class KernelClient {
  private async cacheAssetBackup(assetPath: string, bytes: Uint8Array): Promise<void> {
    if (bytes.byteLength > 20 * 1024 * 1024 || typeof indexedDB?.open !== "function") return;
    try {
      const database = await new Promise<IDBDatabase | null>((resolve) => {
        const request = indexedDB.open("siyuan-cloud-document-suite-recovery-v1", 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("asset-backups")) {
            request.result.createObjectStore("asset-backups", { keyPath: "asset" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      });
      if (!database) return;
      await new Promise<void>((resolve) => {
        const transaction = database.transaction("asset-backups", "readwrite");
        transaction.objectStore("asset-backups").put({
          asset: new URL(`/${assetPath.replace(/^\/+/, "")}`, location.origin).pathname,
          bytes: bytes.slice().buffer,
          updatedAt: Date.now()
        });
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => { database.close(); resolve(); };
        transaction.onabort = () => { database.close(); resolve(); };
      });
    } catch {
      // Recovery caching is best-effort and must not block normal creation.
    }
  }

  async postJson<T>(endpoint: string, body: unknown): Promise<T> {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`${endpoint} failed with HTTP ${response.status}`);
    const result = (await response.json()) as KernelResponse<T>;
    if (result.code !== 0) throw new Error(result.msg || `${endpoint} was rejected by the kernel`);
    return result.data;
  }

  async uploadAsset(file: File): Promise<UploadedAsset> {
    const expected = new Uint8Array(await file.arrayBuffer());
    const form = new FormData();
    form.append("assetsDirPath", "/assets/");
    form.append("file[]", file, file.name);
    const response = await fetch("/api/asset/upload", { method: "POST", body: form });
    if (!response.ok) throw new Error(`Upload request failed with HTTP ${response.status}`);
    const result = (await response.json()) as KernelResponse<AssetUploadData>;
    const assetPath = result.data?.succMap?.[file.name];
    if (result.code !== 0 || !assetPath) throw new Error(result.msg || "The kernel did not return an asset path");
    await this.verifyAsset(assetPath, expected);
    void this.cacheAssetBackup(assetPath, expected);
    return { originalName: file.name, assetPath };
  }

  async readAsset(assetPath: string): Promise<Uint8Array> {
    const normalized = assetPath.replace(/^\/+/, "");
    const response = await fetch("/api/file/getFile", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "Accept": "application/octet-stream" },
      body: JSON.stringify({ path: `/data/${normalized}` })
    });
    if (!response.ok) throw new Error(`Asset verification failed with HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async verifyAsset(assetPath: string, expected?: Uint8Array): Promise<void> {
    const actual = await this.readAsset(assetPath);
    if (!expected) return;
    if (actual.byteLength !== expected.byteLength || actual.some((value, index) => value !== expected[index])) {
      throw new Error("The uploaded asset did not pass byte-for-byte verification");
    }
  }
}
