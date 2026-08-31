import type { AssetUploadData, KernelResponse, UploadedAsset } from "./types";

export class KernelClient {
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
    const form = new FormData();
    form.append("assetsDirPath", "/assets/");
    form.append("file[]", file, file.name);
    const response = await fetch("/api/asset/upload", { method: "POST", body: form });
    if (!response.ok) throw new Error(`Upload request failed with HTTP ${response.status}`);
    const result = (await response.json()) as KernelResponse<AssetUploadData>;
    const assetPath = result.data?.succMap?.[file.name];
    if (result.code !== 0 || !assetPath) throw new Error(result.msg || "The kernel did not return an asset path");
    return { originalName: file.name, assetPath };
  }
}
