import type { DropTarget } from "./types";

export function findCloudDocsTreeDropTarget(element: Element): DropTarget | null {
  const row = element.closest<HTMLElement>(
    '.cdh-nav-root .cdh-tree-row[data-menu="doc"], .cdh-nav-root .cdh-side-item[data-menu="box"]'
  );
  if (!row) return null;
  if (row.dataset.menu === "box") {
    const id = row.dataset.box;
    return id ? { id, position: "create-root-documents" } : null;
  }
  const id = row.dataset.id;
  return id ? { id, position: "create-child-documents" } : null;
}

export function findEditorDropTarget(pointedElement: Element): DropTarget | null {
  const editor = pointedElement.closest(".protyle-wysiwyg");
  if (!editor) return null;
  // These areas have their own upload/readonly behavior in SiYuan. In
  // particular, a database asset-cell drop must not insert a document block.
  if (pointedElement.closest('[data-readonly="true"], [inert], [data-type="NodeAttributeView"], [data-type="NodeBlockQueryEmbed"], .av__body, .protyle-db-attr, .protyle-attr')) return null;
  if (pointedElement.closest("[contenteditable]")?.getAttribute("contenteditable") === "false") return null;
  const block = pointedElement.closest<HTMLElement>("[data-node-id]");
  if (!block || block === editor || !editor.contains(block)) return null;
  return block.dataset.nodeId ? { id: block.dataset.nodeId, position: "after-block" } : null;
}
