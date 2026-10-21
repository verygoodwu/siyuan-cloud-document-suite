import type { DropTarget } from "./types";

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
