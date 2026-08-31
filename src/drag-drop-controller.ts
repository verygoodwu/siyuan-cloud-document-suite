import type { DropTarget } from "./types";

interface DragDropHooks {
  isFileDrag(event: DragEvent): boolean;
  isSupportedPoint(event: DragEvent): boolean;
  findDropTarget(event: DragEvent): DropTarget | null;
  findTreeDropTarget(event: DragEvent): DropTarget | null;
  describeDrop(event: DragEvent, target: DropTarget | null, files?: File[]): Record<string, unknown>;
  importFiles(files: File[], target: DropTarget): Promise<void>;
  showOverlay(): void;
  removeOverlay(): void;
  showToast(message: string, error?: boolean): void;
  recordDebug(stage: string, details?: Record<string, unknown>): Promise<void>;
}

export class DragDropController {
  private dragDepth = 0;
  private readonly boundTrees = new Set<HTMLElement>();

  constructor(private readonly hooks: DragDropHooks) {}

  start(): void {
    window.addEventListener("dragenter", this.onDragEnter, true);
    window.addEventListener("dragleave", this.onDragLeave, true);
    window.addEventListener("dragover", this.onDragOver, true);
    window.addEventListener("drop", this.onDrop, true);
  }

  stop(): void {
    window.removeEventListener("dragenter", this.onDragEnter, true);
    window.removeEventListener("dragleave", this.onDragLeave, true);
    window.removeEventListener("dragover", this.onDragOver, true);
    window.removeEventListener("drop", this.onDrop, true);
    for (const tree of this.boundTrees) this.unbindTree(tree);
    this.boundTrees.clear();
    this.dragDepth = 0;
    this.hooks.removeOverlay();
  }

  bindTrees(): number {
    for (const tree of this.boundTrees) {
      if (tree.isConnected) continue;
      this.unbindTree(tree);
      this.boundTrees.delete(tree);
    }
    let added = 0;
    for (const tree of document.querySelectorAll<HTMLElement>(".sy__file")) {
      if (this.boundTrees.has(tree)) continue;
      tree.addEventListener("dragenter", this.onTreeDragEnter, true);
      tree.addEventListener("dragover", this.onTreeDragOver, true);
      tree.addEventListener("drop", this.onTreeDrop, true);
      this.boundTrees.add(tree);
      added += 1;
    }
    return added;
  }

  get treeCount(): number { return this.boundTrees.size; }

  private unbindTree(tree: HTMLElement): void {
    tree.removeEventListener("dragenter", this.onTreeDragEnter, true);
    tree.removeEventListener("dragover", this.onTreeDragOver, true);
    tree.removeEventListener("drop", this.onTreeDrop, true);
  }

  private readonly onTreeDragEnter = (event: DragEvent): void => {
    if (!this.hooks.isFileDrag(event)) return;
    const target = this.hooks.findTreeDropTarget(event);
    void this.hooks.recordDebug("tree-dragenter", this.hooks.describeDrop(event, target));
    if (!target) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.dragDepth = 1; this.hooks.showOverlay();
  };

  private readonly onTreeDragOver = (event: DragEvent): void => {
    if (!this.hooks.isFileDrag(event) || !this.hooks.findTreeDropTarget(event)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };

  private readonly onTreeDrop = (event: DragEvent): void => {
    if (!this.hooks.isFileDrag(event)) return;
    const target = this.hooks.findTreeDropTarget(event);
    const files = Array.from(event.dataTransfer?.files ?? []);
    void this.hooks.recordDebug("tree-drop", this.hooks.describeDrop(event, target, files));
    event.preventDefault(); event.stopImmediatePropagation();
    this.dragDepth = 0; this.hooks.removeOverlay();
    if (!target) return this.hooks.showToast("没有识别到目标文档，请将鼠标放在文档名称上", true);
    if (!files.length) return this.hooks.showToast("已收到拖放事件，但没有读取到文件", true);
    void this.hooks.importFiles(files, target);
  };

  private readonly onDragEnter = (event: DragEvent): void => {
    if (!this.hooks.isFileDrag(event) || !this.hooks.isSupportedPoint(event)) return;
    this.dragDepth += 1; this.hooks.showOverlay();
  };

  private readonly onDragLeave = (event: DragEvent): void => {
    if (!this.hooks.isFileDrag(event)) return;
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.hooks.removeOverlay();
  };

  private readonly onDragOver = (event: DragEvent): void => {
    if (!this.hooks.isFileDrag(event) || !this.hooks.isSupportedPoint(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };

  private readonly onDrop = (event: DragEvent): void => {
    this.dragDepth = 0; this.hooks.removeOverlay();
    if (!this.hooks.isFileDrag(event) || !this.hooks.isSupportedPoint(event)) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!files.length) return;
    const target = this.hooks.findDropTarget(event);
    if (!target) return this.hooks.showToast("请把文件放到内容块或文档树中的文档上", true);
    event.preventDefault(); event.stopImmediatePropagation();
    void this.hooks.importFiles(files, target);
  };
}
