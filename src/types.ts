export interface KernelResponse<T> {
  code: number;
  msg: string;
  data: T;
}

export interface AssetUploadData {
  errFiles: string[];
  succMap: Record<string, string>;
}

export type CloudDocumentKind =
  | "document"
  | "mindmap"
  | "spreadsheet"
  | "whiteboard"
  | "text"
  | "pdf"
  | "xmind";

export interface UploadedAsset {
  originalName: string;
  assetPath: string;
  documentMarkdown?: string;
  documentKind?: CloudDocumentKind;
}

export interface DropTarget {
  id: string;
  position: "after-block" | "create-child-documents" | "create-root-documents";
}

export interface DocumentPathData {
  notebook: string;
  path: string;
}

export interface DocTreeMenuDetail {
  menu: { addItem(item: unknown): void };
  type: "doc" | "docs" | "notebook" | "notebooks" | "items";
  items: { id: string; path: string }[];
}
