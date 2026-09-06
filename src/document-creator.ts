import { KernelClient } from "./kernel-client";
import type { CloudDocumentKind, DocumentPathData, DropTarget, UploadedAsset } from "./types";

export const CLOUD_DOCUMENT_KIND_ATTR = "custom-cloud-document-kind";
export const CLOUD_DOCUMENT_ASSET_ATTR = "custom-cloud-document-asset";
export const CLOUD_DOCUMENT_NAME_ATTR = "custom-cloud-document-name";
export const CLOUD_DOCUMENT_STATE_ATTR = "custom-cloud-document-state";

export function buildAttachmentMarkdown(assets: UploadedAsset[]): string {
  return assets
    .map(({ originalName, assetPath }) => {
      const label = originalName.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
      const destination = assetPath.replace(/</g, "%3C").replace(/>/g, "%3E");
      return `[${label}](<${destination}>)`;
    })
    .join("  \n");
}

export class DocumentCreator {
  constructor(private readonly api: KernelClient) {}

  async resolveNotebookId(type: "doc" | "notebook", targetId: string): Promise<string> {
    if (type === "notebook") return targetId;
    const pathData = await this.api.postJson<DocumentPathData>("/api/filetree/getPathByID", { id: targetId });
    return pathData.notebook;
  }

  async insertAttachmentBlock(target: DropTarget, assets: UploadedAsset[]): Promise<void> {
    await this.api.postJson<unknown>("/api/block/insertBlock", {
      dataType: "markdown",
      data: buildAttachmentMarkdown(assets),
      previousID: target.id
    });
  }

  async createChildDocuments(parentDocumentId: string, assets: UploadedAsset[]): Promise<void> {
    const [pathData, parentHPath] = await Promise.all([
      this.api.postJson<DocumentPathData>("/api/filetree/getPathByID", { id: parentDocumentId }),
      this.api.postJson<string>("/api/filetree/getHPathByID", { id: parentDocumentId })
    ]);
    for (const asset of assets) {
      const childPath = await this.findAvailableChildPath(pathData.notebook, parentHPath, asset.originalName);
      await this.createVerifiedDocument(pathData.notebook, childPath, asset);
    }
  }

  async createRootDocuments(notebook: string, assets: UploadedAsset[]): Promise<void> {
    for (const asset of assets) {
      const path = await this.findAvailableChildPath(notebook, "/", asset.originalName);
      await this.createVerifiedDocument(notebook, path, asset);
    }
  }

  private async createVerifiedDocument(notebook: string, path: string, asset: UploadedAsset): Promise<string> {
    // Phase 1: the upload has already been byte-verified by KernelClient. The
    // document remains explicitly initializing until its reference is checked.
    const documentId = await this.api.postJson<string>("/api/filetree/createDocWithMd", {
      notebook,
      path,
      markdown: asset.documentMarkdown?.trim() ? asset.documentMarkdown : buildAttachmentMarkdown([asset])
    });
    if (!asset.documentKind) return documentId;
    await this.tagDocument(documentId, asset.documentKind, asset.assetPath, asset.originalName, "initializing", true);
    if (asset.assetPath) await this.api.verifyAsset(asset.assetPath);
    // Phase 2: only a document whose backing asset still exists becomes ready.
    await this.tagDocument(documentId, asset.documentKind, asset.assetPath, asset.originalName, "ready", true);
    return documentId;
  }

  async tagDocument(
    documentId: string,
    kind?: CloudDocumentKind,
    assetPath?: string,
    originalName?: string,
    state?: "initializing" | "ready",
    strict = false
  ): Promise<void> {
    if (!kind) return;
    const attrs: Record<string, string> = { [CLOUD_DOCUMENT_KIND_ATTR]: kind };
    if (assetPath) attrs[CLOUD_DOCUMENT_ASSET_ATTR] = assetPath;
    if (originalName) attrs[CLOUD_DOCUMENT_NAME_ATTR] = originalName;
    if (state) attrs[CLOUD_DOCUMENT_STATE_ATTR] = state;
    try {
      await this.api.postJson<unknown>("/api/attr/setBlockAttrs", { id: documentId, attrs });
    } catch (error) {
      if (strict) throw error;
      // The document is already safely created. A missing optional marker must
      // not turn a successful import into a duplicate on retry.
      console.warn("[Cloud Document Suite] Cannot tag created document", error);
    }
  }

  async findAvailableChildPath(notebook: string, parentHPath: string, fileName: string): Promise<string> {
    const dotIndex = fileName.lastIndexOf(".");
    const stem = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
    const extension = dotIndex > 0 ? fileName.slice(dotIndex) : "";
    const parent = parentHPath === "/" ? "" : parentHPath.replace(/\/$/, "");
    for (let index = 1; index <= 100; index += 1) {
      const title = index === 1 ? fileName : `${stem} (${index})${extension}`;
      const path = `${parent}/${title}`;
      const ids = await this.api.postJson<string[]>("/api/filetree/getIDsByHPath", { notebook, path });
      if (!ids || ids.length === 0) return path;
    }
    throw new Error("Unable to find an unused child document name");
  }
}
