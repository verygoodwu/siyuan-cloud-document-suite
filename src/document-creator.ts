import { KernelClient } from "./kernel-client";
import type { DocumentPathData, DropTarget, UploadedAsset } from "./types";

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
      await this.api.postJson<string>("/api/filetree/createDocWithMd", {
        notebook: pathData.notebook,
        path: childPath,
        markdown: asset.documentMarkdown?.trim() ? asset.documentMarkdown : buildAttachmentMarkdown([asset])
      });
    }
  }

  async createRootDocuments(notebook: string, assets: UploadedAsset[]): Promise<void> {
    for (const asset of assets) {
      const path = await this.findAvailableChildPath(notebook, "/", asset.originalName);
      await this.api.postJson<string>("/api/filetree/createDocWithMd", {
        notebook,
        path,
        markdown: asset.documentMarkdown?.trim() ? asset.documentMarkdown : buildAttachmentMarkdown([asset])
      });
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
