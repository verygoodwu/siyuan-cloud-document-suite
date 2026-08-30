import { SaveConflictError, SiyuanFileStore } from "./siyuan-file-store.js?v=__PLUGIN_VERSION__";
import {
  MAX_RENDER_COLS,
  MAX_RENDER_ROWS,
  SHEET_RECOVERY_SCHEMA,
  addSheetChart,
  addWorksheet,
  applyCellFormatting,
  applyLegacyRecovery,
  applyRecoveryPayload,
  captureCellRange,
  captureSheetLayout,
  captureWorkbookState,
  cellInputText,
  cellPresentation,
  cellRangeToTsv,
  deleteColumns,
  deleteRows,
  deleteWorksheet,
  fillCellRange,
  insertColumns,
  insertRows,
  makeRecoveryPayload,
  mergeCellRange,
  parseClipboardTable,
  parseWorkbookModel,
  renameWorksheet,
  removeSheetChart,
  restoreCellRange,
  restoreSheetLayout,
  restoreSheetState,
  restoreWorkbookState,
  selectionStatistics,
  serializeWorkbookModel,
  setColumnWidth,
  setCellRange,
  setCellsText,
  setCellText,
  setRowHeight,
  setSheetFilter,
  setSheetFreeze,
  sheetDimensions,
  sortCellRange,
  unmergeCellAt,
  validateSerializedWorkbook
} from "./sheet-workbook.js?v=__PLUGIN_VERSION__";

(() => {
  const asset = new URLSearchParams(location.search).get("asset");
  const assetFileName = (() => {
    try {
      return decodeURIComponent(String(asset || "").split("/").pop() || "工作簿.xlsx");
    } catch {
      return String(asset || "").split("/").pop() || "工作簿.xlsx";
    }
  })();
  const documentTitle = assetFileName.replace(/\.xlsx$/i, "") || "工作簿";
  const storageKey = `siyuan-sheet-editor:${asset}`;
  const store = new SiyuanFileStore(asset, storageKey);
  const app = document.querySelector("#app");
  const grid = document.querySelector("#grid");
  const tabs = document.querySelector("#tabs");
  const addSheetButton = document.querySelector("#add-sheet");
  const status = document.querySelector("#status");
  const undoButton = document.querySelector("#undo");
  const redoButton = document.querySelector("#redo");
  const findInput = document.querySelector("#find");
  const findCount = document.querySelector("#find-count");
  const nameBox = document.querySelector("#name-box");
  const formulaInput = document.querySelector("#formula");
  const chartsContainer = document.querySelector("#charts");
  const filterQuery = document.querySelector("#filter-query");
  const freezeMenu = document.querySelector("#freeze");
  const modeToggle = document.querySelector("#mode-toggle");
  const modeLabel = document.querySelector("#mode-label");
  const documentName = document.querySelector("#document-name");
  const searchPanel = document.querySelector("#search-panel");
  const replaceInput = document.querySelector("#replace");
  const findCase = document.querySelector("#find-case");
  const findSelection = document.querySelector("#find-selection");
  const findFormulas = document.querySelector("#find-formulas");
  const replaceOneButton = document.querySelector("#replace-one");
  const replaceAllButton = document.querySelector("#replace-all");
  const formulaHelp = document.querySelector("#formula-help");
  const formulaSuggestionMenu = document.querySelector("#formula-suggestion-menu");
  const selectionSummary = document.querySelector("#selection-summary");
  const structureContextMenu = document.querySelector("#structure-context-menu");
  const contextStructureInsert = document.querySelector("#context-structure-insert");
  const contextStructureDelete = document.querySelector("#context-structure-delete");
  const operationToast = document.querySelector("#operation-toast");
  const exportButton = document.querySelector("#export");
  let model;
  let active = 0;
  let editMode = false;
  let modeTransition = false;
  let saveTimer;
  let saveInFlight = false;
  let saveAgain = false;
  let lastSaveError = "";
  let sizeWarning = "";
  let selection = { anchorRow: 0, anchorCol: 0, row: 0, col: 0 };
  let selectionKind = "cells";
  let draggingSelection = false;
  let fillDrag = null;
  let editSession = null;
  let formulaSession = null;
  let headerDrag = null;
  let contextStructureAxis = null;
  let structureBusy = false;
  let operationToastTimer;
  let exportBusy = false;
  const readViewSnapshots = new Map();
  const undoStack = [];
  const redoStack = [];
  let searchMatches = [];
  let searchIndex = -1;
  let lastSearchQuery = "";
  let lastSearchOptions = "";
  let searchSelectionScope = null;
  let formulaSuggestionIndex = -1;
  const HISTORY_LIMIT = 100;

  const columnName = (index) => {
    let result = "";
    for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
      result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
    }
    return result;
  };

  const setStatus = (text) => {
    status.textContent = sizeWarning ? `${text} · ${sizeWarning}` : text;
  };

  function showOperationFeedback(text, kind = "success", duration = 2200) {
    clearTimeout(operationToastTimer);
    operationToast.textContent = text;
    operationToast.dataset.kind = kind;
    operationToast.hidden = false;
    if (duration > 0) {
      operationToastTimer = setTimeout(() => {
        operationToast.hidden = true;
      }, duration);
    }
  }

  function setStructureBusy(busy) {
    structureBusy = busy;
    app.setAttribute("aria-busy", String(busy));
    for (const button of [
      document.querySelector("#insert-row"),
      document.querySelector("#delete-row"),
      document.querySelector("#insert-col"),
      document.querySelector("#delete-col"),
      contextStructureInsert,
      contextStructureDelete
    ]) button.disabled = busy;
  }

  const currentSheet = () => model.sheets[active];

  const selectionBounds = () => ({
    startRow: Math.min(selection.anchorRow, selection.row),
    endRow: Math.max(selection.anchorRow, selection.row),
    startCol: Math.min(selection.anchorCol, selection.col),
    endCol: Math.max(selection.anchorCol, selection.col)
  });

  const cellLocator = (row, col) =>
    grid.querySelector(`td[data-row="${row}"][data-col="${col}"]`);

  function focusCurrentSelection() {
    const target = selectionKind === "rows"
      ? grid.querySelector(`th.row-head[data-row="${selection.row}"]`)
      : selectionKind === "cols"
        ? grid.querySelector(`thead th[data-col="${selection.col}"]`)
        : cellLocator(selection.row, selection.col);
    target?.focus({ preventScroll: true });
  }

  function captureReadView(sheet = currentSheet()) {
    if (!sheet || readViewSnapshots.has(sheet.name)) return;
    const { rows, cols } = sheetDimensions(sheet);
    readViewSnapshots.set(sheet.name, {
      sheet: sheet.name,
      row: 0,
      col: 0,
      rows,
      cols,
      cells: captureCellRange(XLSX, model, sheet.name, 0, 0, rows, cols),
      layout: captureSheetLayout(model, sheet.name)
    });
  }

  function restoreReadViews() {
    for (const snapshot of readViewSnapshots.values()) {
      restoreCellRange(XLSX, model, snapshot.sheet, snapshot.row, snapshot.col, snapshot.cells, false);
      restoreSheetLayout(model, snapshot.sheet, snapshot.layout, false);
    }
    readViewSnapshots.clear();
  }

  function withCanonicalReadView(callback) {
    if (editMode || readViewSnapshots.size === 0) return callback();
    const temporary = [];
    for (const snapshot of readViewSnapshots.values()) {
      temporary.push({
        ...snapshot,
        cells: captureCellRange(XLSX, model, snapshot.sheet, snapshot.row, snapshot.col, snapshot.rows, snapshot.cols),
        layout: captureSheetLayout(model, snapshot.sheet)
      });
      restoreCellRange(XLSX, model, snapshot.sheet, snapshot.row, snapshot.col, snapshot.cells, false);
      restoreSheetLayout(model, snapshot.sheet, snapshot.layout, false);
    }
    try {
      return callback();
    } finally {
      for (const snapshot of temporary) {
        restoreCellRange(XLSX, model, snapshot.sheet, snapshot.row, snapshot.col, snapshot.cells, false);
        restoreSheetLayout(model, snapshot.sheet, snapshot.layout, false);
      }
    }
  }

  function applyReadView(mutator, { renderAll = false } = {}) {
    captureReadView();
    mutator(currentSheet());
    if (renderAll) render();
    else renderGrid();
    setStatus("临时查看 · 不会修改原文件");
  }

  function selectionLabel() {
    const { startRow, endRow, startCol, endCol } = selectionBounds();
    if (selectionKind === "rows") return startRow === endRow ? String(startRow + 1) : `${startRow + 1}:${endRow + 1}`;
    if (selectionKind === "cols") return startCol === endCol ? columnName(startCol) : `${columnName(startCol)}:${columnName(endCol)}`;
    const start = `${columnName(startCol)}${startRow + 1}`;
    const end = `${columnName(endCol)}${endRow + 1}`;
    return start === end ? start : `${start}:${end}`;
  }

  function structureSelection(axis) {
    const bounds = selectionBounds();
    const wholeSelection = axis === "row" ? selectionKind === "rows" : selectionKind === "cols";
    const index = axis === "row"
      ? (wholeSelection ? bounds.startRow : selection.row)
      : (wholeSelection ? bounds.startCol : selection.col);
    const count = wholeSelection
      ? (axis === "row" ? bounds.endRow - bounds.startRow + 1 : bounds.endCol - bounds.startCol + 1)
      : 1;
    const end = index + count - 1;
    const range = axis === "row"
      ? (count === 1 ? String(index + 1) : `${index + 1}:${end + 1}`)
      : (count === 1 ? columnName(index) : `${columnName(index)}:${columnName(end)}`);
    return { index, count, range };
  }

  function updateStructureActionLabels() {
    const row = structureSelection("row");
    const col = structureSelection("col");
    document.querySelector("#insert-row").textContent = `＋ 在上方插入 ${row.count} 行`;
    document.querySelector("#delete-row").textContent = `－ 删除选中 ${row.count} 行`;
    document.querySelector("#insert-col").textContent = `＋ 在左侧插入 ${col.count} 列`;
    document.querySelector("#delete-col").textContent = `－ 删除选中 ${col.count} 列`;
    if (contextStructureAxis) {
      const target = structureSelection(contextStructureAxis);
      const noun = contextStructureAxis === "row" ? "行" : "列";
      contextStructureInsert.textContent = contextStructureAxis === "row"
        ? `＋ 在上方插入 ${target.count} ${noun}`
        : `＋ 在左侧插入 ${target.count} ${noun}`;
      contextStructureDelete.textContent = `－ 删除选中 ${target.count} ${noun}`;
    }
  }

  const compactNumber = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 });

  function updateSelectionSummary() {
    const { startRow, endRow, startCol, endCol } = selectionBounds();
    const stats = selectionStatistics(XLSX, model, currentSheet().name, startRow, startCol, endRow, endCol);
    if (!stats.nonEmptyCount) {
      selectionSummary.textContent = "";
      selectionSummary.title = "";
      return;
    }
    const parts = [`计数 ${stats.nonEmptyCount}`];
    if (stats.numericCount) {
      parts.push(`数字 ${stats.numericCount}`);
      parts.push(`求和 ${compactNumber.format(stats.sum)}`);
      parts.push(`平均 ${compactNumber.format(stats.average)}`);
    }
    selectionSummary.textContent = parts.join(" · ");
    selectionSummary.title = `${selectionLabel()} 的选区统计`;
  }

  function updateSelectionControls() {
    if (!model) return;
    nameBox.value = selectionLabel();
    const { startRow, endRow, startCol, endCol } = selectionBounds();
    if (document.activeElement !== formulaInput) {
      formulaInput.value = startRow === endRow && startCol === endCol
        ? cellInputText(XLSX, model, currentSheet().name, startRow, startCol)
        : "";
    }
    const presentation = cellPresentation(XLSX, model, currentSheet().name, startRow, startCol);
    for (const [id, activeState] of [["bold", presentation.bold], ["italic", presentation.italic], ["underline", presentation.underline]]) {
      const button = document.querySelector(`#${id}`);
      button.classList.toggle("active", activeState);
      button.setAttribute("aria-pressed", String(activeState));
    }
    document.querySelectorAll("[data-align]").forEach((button) => {
      button.setAttribute("aria-checked", String(button.dataset.align === presentation.horizontal));
    });
    const numberFormat = document.querySelector("#number-format");
    const formatValue = presentation.numberFormat === "General" ? "" : presentation.numberFormat || "";
    numberFormat.value = [...numberFormat.options].some((option) => option.value === formatValue) ? formatValue : "";
    if (presentation.textColor) document.querySelector("#text-color").value = presentation.textColor;
    if (presentation.fillColor) document.querySelector("#fill-color").value = presentation.fillColor;
    const freezeRowCount = selection.row + 1;
    const freezeColCount = selection.col + 1;
    const freezeRowLabel = freezeRowCount === 1 ? "冻结首行" : `冻结至${freezeRowCount}行`;
    const freezeColLabel = freezeColCount === 1 ? "冻结首列" : `冻结至${columnName(selection.col)}列`;
    document.querySelector("#freeze-row").textContent = freezeRowLabel;
    document.querySelector("#freeze-col").textContent = freezeColLabel;
    document.querySelector("#freeze-both").textContent = freezeRowCount === 1 && freezeColCount === 1
      ? "冻结首行及首列"
      : `冻结至${freezeRowCount}行${columnName(selection.col)}列`;
    const flow = presentation.textFlow || "cut";
    document.querySelectorAll("[data-text-flow]").forEach((button) => {
      button.setAttribute("aria-checked", String(button.dataset.textFlow === flow));
    });
    filterQuery.value = currentSheet().filter?.query || "";
    updateStructureActionLabels();
    updateSelectionSummary();
  }

  function updateHistoryButtons() {
    undoButton.disabled = undoStack.length === 0;
    redoButton.disabled = redoStack.length === 0;
  }

  function snapshotsEqual(first, second) {
    return JSON.stringify(first) === JSON.stringify(second);
  }

  function pushHistory(entry) {
    if (snapshotsEqual(entry.before, entry.after)
      && snapshotsEqual(entry.beforeLayout, entry.afterLayout)
      && snapshotsEqual(entry.beforeState, entry.afterState)
      && snapshotsEqual(entry.beforeWorkbookState, entry.afterWorkbookState)) return;
    undoStack.push(entry);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
    updateHistoryButtons();
  }

  function clearHistory() {
    undoStack.length = 0;
    redoStack.length = 0;
    editSession = null;
    updateHistoryButtons();
  }

  function finalizeEditSession() {
    if (!editSession) return;
    const session = editSession;
    editSession = null;
    if (!session.dirty) return;
    const sheetIndex = model.sheets.findIndex((sheet) => sheet.name === session.sheet);
    if (sheetIndex < 0) return;
    const after = captureCellRange(XLSX, model, session.sheet, session.row, session.col, 1, 1);
    pushHistory({ ...session, before: session.before, after });
  }

  function cancelEditSession() {
    if (!editSession) return false;
    const session = editSession;
    editSession = null;
    if (session.dirty) {
      if (Number.isInteger(session.operationIndex)) model.operations.splice(session.operationIndex);
      restoreCellRange(XLSX, model, session.sheet, session.row, session.col, session.before, false);
      scheduleSave();
      renderGrid();
      setSelection(session.row, session.col, { focus: true, scroll: true });
      refreshSearchAfterEdit();
      showOperationFeedback("已取消本次单元格编辑");
    }
    return true;
  }

  function placeCaretAtEnd(element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const caret = getSelection();
    caret?.removeAllRanges();
    caret?.addRange(range);
  }

  function activateCellEditing(cell) {
    if (!cell?.matches?.("td")) return;
    if (editSession) editSession.editing = true;
    cell.focus({ preventScroll: true });
    placeCaretAtEnd(cell);
  }

  function paintSelection() {
    grid.classList.remove("range-multi");
    grid.querySelectorAll(".fill-handle").forEach((handle) => handle.remove());
    grid.querySelectorAll(".fill-preview").forEach((cell) => cell.classList.remove("fill-preview"));
    grid.querySelectorAll("th.header-selected").forEach((header) => header.classList.remove("header-selected"));
    grid.querySelectorAll("td.range-selected,td.active-cell,td.selection-top,td.selection-right,td.selection-bottom,td.selection-left").forEach((cell) => {
      cell.classList.remove("range-selected", "active-cell", "selection-top", "selection-right", "selection-bottom", "selection-left");
    });
    const { startRow, endRow, startCol, endCol } = selectionBounds();
    if (startRow !== endRow || startCol !== endCol) grid.classList.add("range-multi");
    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        const cell = cellLocator(row, col);
        if (!cell) continue;
        cell.classList.add("range-selected");
        if (row === startRow) cell.classList.add("selection-top");
        if (row === endRow) cell.classList.add("selection-bottom");
        if (col === startCol) cell.classList.add("selection-left");
        if (col === endCol) cell.classList.add("selection-right");
      }
    }
    cellLocator(selection.row, selection.col)?.classList.add("active-cell");
    for (let row = startRow; row <= endRow; row++) grid.querySelector(`th.row-head[data-row="${row}"]`)?.classList.add("header-selected");
    for (let col = startCol; col <= endCol; col++) grid.querySelector(`thead th[data-col="${col}"]`)?.classList.add("header-selected");
    const handleCell = cellLocator(endRow, endCol);
    if (handleCell && selectionKind === "cells" && editMode) {
      const handle = document.createElement("span");
      handle.className = "fill-handle";
      handle.title = "拖动填充";
      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        draggingSelection = false;
        fillDrag = {
          source: { s: { r: startRow, c: startCol }, e: { r: endRow, c: endCol } },
          target: { s: { r: startRow, c: startCol }, e: { r: endRow, c: endCol } }
        };
      });
      handleCell.append(handle);
    }
    updateSelectionControls();
  }

  function mergeRangeAt(row, col) {
    const worksheet = model.workbook.Sheets[currentSheet().name];
    return (worksheet["!merges"] || []).find(
      (merge) => row >= merge.s.r && row <= merge.e.r && col >= merge.s.c && col <= merge.e.c
    ) || null;
  }

  function normalizedCellPosition(row, col) {
    const merge = mergeRangeAt(row, col);
    return merge ? { row: merge.s.r, col: merge.s.c } : { row, col };
  }

  function setSelection(row, col, { extend = false, focus = false, scroll = false } = {}) {
    const sheet = currentSheet();
    if (!sheet) return;
    const { rows, cols } = sheetDimensions(sheet);
    const clampedRow = Math.max(0, Math.min(rows - 1, row));
    const clampedCol = Math.max(0, Math.min(cols - 1, col));
    const normalized = normalizedCellPosition(clampedRow, clampedCol);
    const nextRow = normalized.row;
    const nextCol = normalized.col;
    if (!extend) {
      selectionKind = "cells";
      selection.anchorRow = nextRow;
      selection.anchorCol = nextCol;
    }
    selection.row = nextRow;
    selection.col = nextCol;
    paintSelection();
    const cell = cellLocator(nextRow, nextCol);
    if (focus) cell?.focus();
    if (scroll) cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function selectWholeRow(row, extend = false) {
    const { rows, cols } = sheetDimensions(currentSheet());
    const nextRow = Math.max(0, Math.min(rows - 1, row));
    if (!extend || selectionKind !== "rows") selection.anchorRow = nextRow;
    selectionKind = "rows";
    selection.anchorCol = 0;
    selection.row = nextRow;
    selection.col = cols - 1;
    paintSelection();
  }

  function selectWholeColumn(col, extend = false) {
    const { rows, cols } = sheetDimensions(currentSheet());
    const nextCol = Math.max(0, Math.min(cols - 1, col));
    if (!extend || selectionKind !== "cols") selection.anchorCol = nextCol;
    selectionKind = "cols";
    selection.anchorRow = 0;
    selection.row = rows - 1;
    selection.col = nextCol;
    paintSelection();
  }

  function selectAllCells() {
    const { rows, cols } = sheetDimensions(currentSheet());
    selectionKind = "cells";
    selection = { anchorRow: 0, anchorCol: 0, row: rows - 1, col: cols - 1 };
    paintSelection();
  }

  function closeStructureContextMenu() {
    structureContextMenu.hidden = true;
    contextStructureAxis = null;
  }

  function openStructureContextMenu(axis, clientX, clientY) {
    if (!editMode || structureBusy) return;
    contextStructureAxis = axis;
    updateStructureActionLabels();
    structureContextMenu.hidden = false;
    const width = structureContextMenu.offsetWidth;
    const height = structureContextMenu.offsetHeight;
    structureContextMenu.style.left = `${Math.max(8, Math.min(clientX, innerWidth - width - 8))}px`;
    structureContextMenu.style.top = `${Math.max(8, Math.min(clientY, innerHeight - height - 8))}px`;
    contextStructureInsert.focus({ preventScroll: true });
  }

  function updateSearchHighlights() {
    grid.querySelectorAll("td.search-match,td.search-current").forEach((cell) => {
      cell.classList.remove("search-match", "search-current");
    });
    searchMatches.forEach(({ row, col }, index) => {
      const cell = cellLocator(row, col);
      cell?.classList.add(index === searchIndex ? "search-current" : "search-match");
    });
    findCount.textContent = searchMatches.length
      ? `${searchIndex + 1}/${searchMatches.length}`
      : lastSearchQuery ? "0/0" : "";
  }

  function searchOptionsKey() {
    return `${findCase.checked}:${findSelection.checked}:${findFormulas.checked}`;
  }

  function normalizedSearchText(value) {
    return findCase.checked ? String(value) : String(value).toLocaleLowerCase();
  }

  function collectSearchMatches(query) {
    const normalized = normalizedSearchText(query.trim());
    lastSearchQuery = query;
    lastSearchOptions = searchOptionsKey();
    if (!normalized) {
      searchMatches = [];
      searchIndex = -1;
      updateSearchHighlights();
      return;
    }
    const sheet = currentSheet();
    const { rows, cols } = sheetDimensions(sheet);
    const bounds = findSelection.checked
      ? (searchSelectionScope || selectionBounds())
      : { startRow: 0, endRow: rows - 1, startCol: 0, endCol: cols - 1 };
    searchMatches = [];
    for (let row = bounds.startRow; row <= Math.min(rows - 1, bounds.endRow); row++) {
      for (let col = bounds.startCol; col <= Math.min(cols - 1, bounds.endCol); col++) {
        const input = cellInputText(XLSX, model, sheet.name, row, col);
        const isFormula = input.startsWith("=");
        const source = findFormulas.checked && isFormula
          ? input
          : String(sheet.data[row]?.[col] ?? "");
        if (normalizedSearchText(source).includes(normalized)) searchMatches.push({ row, col, source, isFormula });
      }
    }
    searchIndex = searchMatches.length ? 0 : -1;
    updateSearchHighlights();
  }

  function findMatch(direction = 1) {
    const query = findInput.value;
    if (query !== lastSearchQuery || searchOptionsKey() !== lastSearchOptions) collectSearchMatches(query);
    if (!searchMatches.length) return;
    searchIndex = (searchIndex + direction + searchMatches.length) % searchMatches.length;
    const match = searchMatches[searchIndex];
    setSelection(match.row, match.col, { focus: true, scroll: true });
    updateSearchHighlights();
  }

  function replacedText(source, query, replacement, replaceAll) {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return source.replace(new RegExp(escaped, `${findCase.checked ? "" : "i"}${replaceAll ? "g" : ""}`), () => replacement);
  }

  function replaceSearchMatches(replaceAll) {
    finalizeEditSession();
    const query = findInput.value;
    if (!query) return;
    if (query !== lastSearchQuery || searchOptionsKey() !== lastSearchOptions) collectSearchMatches(query);
    if (!searchMatches.length) {
      showOperationFeedback("没有可替换的匹配项", "warning");
      return;
    }
    const candidates = replaceAll ? searchMatches : [searchMatches[Math.max(0, searchIndex)]];
    const changes = [];
    let skippedFormulas = 0;
    for (const match of candidates) {
      if (match.isFormula && !findFormulas.checked) {
        skippedFormulas++;
        continue;
      }
      const next = replacedText(match.source, query, replaceInput.value, replaceAll);
      if (next !== match.source) changes.push({ row: match.row, col: match.col, value: next });
    }
    if (!changes.length) {
      showOperationFeedback(skippedFormulas ? "公式结果不会被直接替换；可启用“查找公式原文”" : "没有可替换的匹配项", "warning", 3600);
      return;
    }
    const rows = changes.map((change) => change.row);
    const cols = changes.map((change) => change.col);
    const startRow = Math.min(...rows);
    const endRow = Math.max(...rows);
    const startCol = Math.min(...cols);
    const endCol = Math.max(...cols);
    const sheet = currentSheet();
    const history = {
      sheet: sheet.name,
      row: startRow,
      col: startCol,
      rows: endRow - startRow + 1,
      cols: endCol - startCol + 1,
      before: captureCellRange(XLSX, model, sheet.name, startRow, startCol, endRow - startRow + 1, endCol - startCol + 1)
    };
    setCellsText(XLSX, model, sheet.name, changes);
    history.after = captureCellRange(XLSX, model, sheet.name, startRow, startCol, history.rows, history.cols);
    pushHistory(history);
    selectionKind = "cells";
    selection = { anchorRow: startRow, anchorCol: startCol, row: endRow, col: endCol };
    scheduleSave();
    renderGrid();
    collectSearchMatches(query);
    showOperationFeedback(`已替换 ${changes.length} 个单元格${skippedFormulas ? `，跳过 ${skippedFormulas} 个公式结果` : ""}`);
  }

  const FORMULA_HINTS = {
    SUM: "SUM(数值或区域…)：求和",
    AVERAGE: "AVERAGE(数值或区域…)：平均值",
    MIN: "MIN(数值或区域…)：最小值",
    MAX: "MAX(数值或区域…)：最大值",
    COUNT: "COUNT(数值或区域…)：数字数量",
    ROUND: "ROUND(数值, 位数)：四舍五入",
    ABS: "ABS(数值)：绝对值",
    IF: "IF(条件, 成立值, 不成立值)：条件判断"
  };

  function updateFormulaHelp(value = formulaInput.value) {
    const source = String(value || "").trim();
    if (!source.startsWith("=")) {
      formulaHelp.hidden = true;
      formulaHelp.textContent = "";
      hideFormulaSuggestions();
      return;
    }
    const functionName = /^=\s*([A-Za-z]+)/.exec(source)?.[1]?.toUpperCase();
    formulaHelp.textContent = FORMULA_HINTS[functionName]
      || "支持 + − × ÷、单元格引用及 SUM / AVERAGE / MIN / MAX / COUNT / ROUND / ABS / IF";
    formulaHelp.hidden = false;
    updateFormulaSuggestions(source);
  }

  function hideFormulaSuggestions() {
    formulaSuggestionMenu.hidden = true;
    formulaSuggestionMenu.replaceChildren();
    formulaSuggestionIndex = -1;
  }

  function positionFormulaSuggestions() {
    const rect = formulaInput.getBoundingClientRect();
    const width = Math.min(Math.max(240, rect.width), Math.max(160, innerWidth - 16));
    const left = Math.max(8, Math.min(rect.left, innerWidth - width - 8));
    formulaSuggestionMenu.style.left = `${left}px`;
    formulaSuggestionMenu.style.top = `${rect.bottom + (formulaHelp.hidden ? 4 : 24)}px`;
    formulaSuggestionMenu.style.width = `${width}px`;
  }

  function formulaSuggestionButtons() {
    return [...formulaSuggestionMenu.querySelectorAll("button")];
  }

  function setFormulaSuggestionIndex(index) {
    const buttons = formulaSuggestionButtons();
    if (!buttons.length) return;
    formulaSuggestionIndex = (index + buttons.length) % buttons.length;
    buttons.forEach((button, buttonIndex) => {
      const active = buttonIndex === formulaSuggestionIndex;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    buttons[formulaSuggestionIndex].scrollIntoView({ block: "nearest" });
  }

  function applyFormulaSuggestion(name) {
    const value = `=${name}()`;
    formulaInput.value = value;
    hideFormulaSuggestions();
    updateFormulaHelp(value);
    formulaInput.focus({ preventScroll: true });
    formulaInput.setSelectionRange(value.length - 1, value.length - 1);
  }

  function updateFormulaSuggestions(source = formulaInput.value) {
    if (document.activeElement !== formulaInput) {
      hideFormulaSuggestions();
      return;
    }
    const match = /^=\s*([A-Za-z]*)$/.exec(String(source).trim());
    if (!match) {
      hideFormulaSuggestions();
      return;
    }
    const prefix = match[1].toUpperCase();
    const names = Object.keys(FORMULA_HINTS).filter((name) => name.startsWith(prefix));
    if (!names.length) {
      hideFormulaSuggestions();
      return;
    }
    formulaSuggestionMenu.replaceChildren();
    names.forEach((name, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.role = "option";
      button.dataset.formula = name;
      const title = document.createElement("strong");
      title.textContent = name;
      const detail = document.createElement("small");
      detail.textContent = FORMULA_HINTS[name].split("：")[1] || FORMULA_HINTS[name];
      button.append(title, detail);
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("click", () => applyFormulaSuggestion(name));
      button.addEventListener("pointerenter", () => setFormulaSuggestionIndex(index));
      formulaSuggestionMenu.append(button);
    });
    formulaSuggestionMenu.hidden = false;
    positionFormulaSuggestions();
    setFormulaSuggestionIndex(0);
  }

  function formulaErrorHint(value) {
    return {
      "#REF!": "引用的单元格已被删除或无效",
      "#DIV/0!": "除数不能为零",
      "#VALUE!": "公式中的值类型不正确",
      "#CYCLE!": "公式出现循环引用",
      "#暂不支持": "当前轻量公式引擎暂不支持此公式"
    }[String(value)] || "";
  }

  function refreshSearchAfterEdit() {
    if (!findInput.value.trim()) return;
    const previous = searchMatches[searchIndex];
    collectSearchMatches(findInput.value);
    if (previous) {
      const nextIndex = searchMatches.findIndex(
        (match) => match.row === previous.row && match.col === previous.col
      );
      if (nextIndex >= 0) searchIndex = nextIndex;
    }
    updateSearchHighlights();
  }

  function applyHistory(entry, snapshot, layout, state, workbookState, selectionState) {
    const sheetIndex = model.sheets.findIndex((sheet) => sheet.name === entry.sheet);
    if (sheetIndex < 0) return false;
    active = sheetIndex;
    if (workbookState) restoreWorkbookState(XLSX, model, workbookState);
    else if (state) restoreSheetState(XLSX, model, entry.sheet, state);
    else {
      if (snapshot) restoreCellRange(XLSX, model, entry.sheet, entry.row, entry.col, snapshot);
      if (layout) restoreSheetLayout(model, entry.sheet, layout);
    }
    if (selectionState) {
      selectionKind = selectionState.kind;
      selection = { ...selectionState.selection };
    }
    scheduleSave();
    render();
    if (selectionState) focusCurrentSelection();
    else setSelection(entry.row, entry.col, { focus: true, scroll: true });
    refreshSearchAfterEdit();
    return true;
  }

  function undo() {
    document.activeElement?.blur?.();
    finalizeEditSession();
    const entry = undoStack.pop();
    if (!entry) return;
    if (applyHistory(entry, entry.before, entry.beforeLayout, entry.beforeState, entry.beforeWorkbookState, entry.beforeSelection)) redoStack.push(entry);
    updateHistoryButtons();
  }

  function redo() {
    document.activeElement?.blur?.();
    finalizeEditSession();
    const entry = redoStack.pop();
    if (!entry) return;
    if (applyHistory(entry, entry.after, entry.afterLayout, entry.afterState, entry.afterWorkbookState, entry.afterSelection)) undoStack.push(entry);
    updateHistoryButtons();
  }

  const scheduleSave = () => {
    clearTimeout(saveTimer);
    try {
      store.cacheRecovery(makeRecoveryPayload(model));
      setStatus("正在写入思源…");
    } catch (error) {
      console.error(error);
      setStatus("本机恢复缓存失败：数据过大");
    }
    saveTimer = setTimeout(() => void persist(false), 700);
  };

  const uniqueName = (base) => {
    let name = base;
    let index = 2;
    while (model.sheets.some((sheet) => sheet.name.toLowerCase() === name.toLowerCase())) {
      name = `${base}${index++}`;
    }
    return name;
  };

  function renderTabs() {
    tabs.querySelectorAll(".tab").forEach((element) => element.remove());
    model.sheets.forEach((sheet, index) => {
      const button = document.createElement("button");
      button.className = `tab${index === active ? " active" : ""}`;
      button.textContent = sheet.name;
      button.addEventListener("click", () => {
        finalizeEditSession();
        active = index;
        selectionKind = "cells";
        selection = { anchorRow: 0, anchorCol: 0, row: 0, col: 0 };
        collectSearchMatches(findInput.value);
        render();
      });
      button.addEventListener("dblclick", () => {
        if (editMode) renameSheet();
      });
      tabs.insertBefore(button, addSheetButton);
    });
  }

  function styleGridCell(td, presentation) {
    td.style.fontWeight = presentation.bold ? "700" : "";
    td.style.fontStyle = presentation.italic ? "italic" : "";
    td.style.textDecoration = presentation.underline ? "underline" : "";
    td.style.color = presentation.textColor || "";
    td.style.backgroundColor = presentation.fillColor || "";
    td.style.textAlign = presentation.horizontal || "";
    td.style.verticalAlign = presentation.vertical || "";
    td.classList.toggle("text-flow-wrap", presentation.textFlow === "wrap");
    td.classList.toggle("text-flow-overflow", presentation.textFlow === "overflow");
  }

  function columnPixelWidth(worksheet, col) {
    const layout = worksheet["!cols"]?.[col];
    if (Number.isFinite(layout?.wpx)) return Math.max(40, Math.min(600, Math.round(layout.wpx)));
    if (Number.isFinite(layout?.wch)) return Math.max(40, Math.min(600, Math.round(layout.wch * 7 + 5)));
    return 110;
  }

  function rowPixelHeight(worksheet, row) {
    const layout = worksheet["!rows"]?.[row];
    if (Number.isFinite(layout?.hpx)) return Math.max(20, Math.min(240, Math.round(layout.hpx)));
    if (Number.isFinite(layout?.hpt)) return Math.max(20, Math.min(240, Math.round(layout.hpt * 96 / 72)));
    return 28;
  }

  function finishResize(axis, index, value, beforeLayout) {
    const sheet = currentSheet();
    if (axis === "col") setColumnWidth(model, sheet.name, index, value);
    else setRowHeight(model, sheet.name, index, value);
    const afterLayout = captureSheetLayout(model, sheet.name);
    pushHistory({
      sheet: sheet.name,
      row: axis === "row" ? index : selection.row,
      col: axis === "col" ? index : selection.col,
      beforeLayout,
      afterLayout
    });
    scheduleSave();
    renderGrid();
  }

  function startResize(axis, index, initialValue, event) {
    if (!editMode || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    finalizeEditSession();
    const beforeLayout = captureSheetLayout(model, currentSheet().name);
    const start = axis === "col" ? event.clientX : event.clientY;
    const guide = document.createElement("div");
    guide.className = `resize-guide ${axis === "col" ? "vertical" : "horizontal"}`;
    if (axis === "col") guide.style.left = `${event.clientX}px`;
    else guide.style.top = `${event.clientY}px`;
    document.body.append(guide);
    document.body.classList.add(axis === "col" ? "resizing-col" : "resizing-row");
    let latest = initialValue;
    let moved = false;
    const move = (moveEvent) => {
      const current = axis === "col" ? moveEvent.clientX : moveEvent.clientY;
      moved ||= Math.abs(current - start) >= 2;
      latest = initialValue + current - start;
      if (axis === "col") {
        latest = Math.max(40, Math.min(600, latest));
        guide.style.left = `${moveEvent.clientX}px`;
      } else {
        latest = Math.max(20, Math.min(240, latest));
        guide.style.top = `${moveEvent.clientY}px`;
      }
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      guide.remove();
      document.body.classList.remove("resizing-col", "resizing-row");
      if (moved && Math.round(latest) !== Math.round(initialValue)) {
        finishResize(axis, index, latest, beforeLayout);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
    window.addEventListener("pointercancel", end, { once: true });
  }

  function appendResizeHandle(target, axis, index, initialValue) {
    if (!editMode) return;
    const handle = document.createElement("span");
    handle.className = axis === "col" ? "col-resizer" : "row-resizer";
    handle.title = axis === "col" ? "拖动调整列宽，双击自动适应内容" : "拖动调整行高，双击恢复默认高度";
    handle.addEventListener("pointerdown", (event) => startResize(axis, index, initialValue, event));
    handle.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (axis === "row") {
        if (Math.round(initialValue) !== 28) {
          finishResize(axis, index, 28, captureSheetLayout(model, currentSheet().name));
        }
        return;
      }
      const sheet = currentSheet();
      const longest = Math.max(columnName(index).length, ...sheet.data.map((row) => String(row?.[index] ?? "").length));
      const autoWidth = Math.max(56, Math.min(360, longest * 8 + 22));
      if (Math.round(autoWidth) !== Math.round(initialValue)) {
        finishResize(axis, index, autoWidth, captureSheetLayout(model, currentSheet().name));
      }
    });
    target.append(handle);
  }

  function previewFillTo(row, col) {
    if (!fillDrag) return;
    const source = fillDrag.source;
    const rowDistance = row < source.s.r ? source.s.r - row : row > source.e.r ? row - source.e.r : 0;
    const colDistance = col < source.s.c ? source.s.c - col : col > source.e.c ? col - source.e.c : 0;
    if (rowDistance >= colDistance) {
      fillDrag.target = { s: { r: Math.min(row, source.s.r), c: source.s.c }, e: { r: Math.max(row, source.e.r), c: source.e.c } };
    } else {
      fillDrag.target = { s: { r: source.s.r, c: Math.min(col, source.s.c) }, e: { r: source.e.r, c: Math.max(col, source.e.c) } };
    }
    grid.querySelectorAll(".fill-preview").forEach((cell) => cell.classList.remove("fill-preview"));
    for (let targetRow = fillDrag.target.s.r; targetRow <= fillDrag.target.e.r; targetRow++) {
      for (let targetCol = fillDrag.target.s.c; targetCol <= fillDrag.target.e.c; targetCol++) {
        cellLocator(targetRow, targetCol)?.classList.add("fill-preview");
      }
    }
  }

  function renderGrid() {
    grid.replaceChildren();
    const sheet = model.sheets[active];
    const worksheet = model.workbook.Sheets[sheet.name];
    const { rows, cols, truncatedRows, truncatedCols } = sheetDimensions(sheet);
    const freeze = sheet.freeze || { rows: 0, cols: 0 };
    const columnWidths = Array.from({ length: cols }, (_, col) => columnPixelWidth(worksheet, col));
    const rowHeights = Array.from({ length: rows }, (_, row) => rowPixelHeight(worksheet, row));
    const columnOffsets = columnWidths.map((_, col) => 46 + columnWidths.slice(0, col).reduce((sum, width) => sum + width, 0));
    const rowOffsets = rowHeights.map((_, row) => 28 + rowHeights.slice(0, row).reduce((sum, height) => sum + height, 0));
    grid.style.width = `${46 + columnWidths.reduce((sum, width) => sum + width, 0)}px`;
    const colgroup = document.createElement("colgroup");
    const rowHeaderCol = document.createElement("col");
    rowHeaderCol.style.width = "46px";
    colgroup.append(rowHeaderCol);
    for (const width of columnWidths) {
      const colElement = document.createElement("col");
      colElement.style.width = `${width}px`;
      colgroup.append(colElement);
    }
    grid.append(colgroup);
    const mergeStarts = new Map();
    const mergeCovered = new Set();
    for (const merge of worksheet["!merges"] || []) {
      mergeStarts.set(`${merge.s.r}:${merge.s.c}`, merge);
      for (let row = merge.s.r; row <= merge.e.r; row++) {
        for (let col = merge.s.c; col <= merge.e.c; col++) {
          if (row !== merge.s.r || col !== merge.s.c) mergeCovered.add(`${row}:${col}`);
        }
      }
    }
    sizeWarning = truncatedRows || truncatedCols
      ? `为保证性能仅显示前 ${rows} 行 × ${cols} 列，未显示区域仍会原样保留`
      : "";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    const corner = document.createElement("th");
    corner.className = "row-head corner";
    corner.title = "选择全部单元格";
    corner.addEventListener("pointerdown", (event) => {
      if (event.button === 0) selectAllCells();
    });
    headRow.append(corner);
    for (let col = 0; col < cols; col++) {
      const th = document.createElement("th");
      th.textContent = columnName(col);
      th.dataset.col = String(col);
      th.tabIndex = 0;
      th.setAttribute("aria-label", `选择 ${columnName(col)} 列`);
      th.style.width = `${columnWidths[col]}px`;
      th.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        closeStructureContextMenu();
        selectWholeColumn(col, event.shiftKey);
        th.focus({ preventScroll: true });
        headerDrag = { axis: "col" };
      });
      th.addEventListener("pointerenter", (event) => {
        if (headerDrag?.axis === "col" && (event.buttons & 1)) selectWholeColumn(col, true);
      });
      th.addEventListener("contextmenu", (event) => {
        if (!editMode) return;
        event.preventDefault();
        const bounds = selectionBounds();
        if (selectionKind !== "cols" || col < bounds.startCol || col > bounds.endCol) selectWholeColumn(col);
        openStructureContextMenu("col", event.clientX, event.clientY);
      });
      if (col < freeze.cols) {
        th.style.left = `${columnOffsets[col]}px`;
        th.style.zIndex = "5";
      }
      appendResizeHandle(th, "col", col, columnWidths[col]);
      headRow.append(th);
    }
    head.append(headRow);
    grid.append(head);

    const body = document.createElement("tbody");
    for (let row = 0; row < rows; row++) {
      const tr = document.createElement("tr");
      tr.style.height = `${rowHeights[row]}px`;
      if (worksheet["!rows"]?.[row]?.hidden) tr.hidden = true;
      const rowHead = document.createElement("th");
      rowHead.className = "row-head";
      rowHead.dataset.row = String(row);
      rowHead.textContent = String(row + 1);
      rowHead.tabIndex = 0;
      rowHead.setAttribute("aria-label", `选择第 ${row + 1} 行`);
      rowHead.style.height = `${rowHeights[row]}px`;
      rowHead.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        closeStructureContextMenu();
        selectWholeRow(row, event.shiftKey);
        rowHead.focus({ preventScroll: true });
        headerDrag = { axis: "row" };
      });
      rowHead.addEventListener("pointerenter", (event) => {
        if (headerDrag?.axis === "row" && (event.buttons & 1)) selectWholeRow(row, true);
      });
      rowHead.addEventListener("contextmenu", (event) => {
        if (!editMode) return;
        event.preventDefault();
        const bounds = selectionBounds();
        if (selectionKind !== "rows" || row < bounds.startRow || row > bounds.endRow) selectWholeRow(row);
        openStructureContextMenu("row", event.clientX, event.clientY);
      });
      if (row < freeze.rows) {
        rowHead.style.top = `${rowOffsets[row]}px`;
        rowHead.style.zIndex = "4";
      }
      appendResizeHandle(rowHead, "row", row, rowHeights[row]);
      tr.append(rowHead);
      for (let col = 0; col < cols; col++) {
        if (mergeCovered.has(`${row}:${col}`)) continue;
        const td = document.createElement("td");
        td.contentEditable = "plaintext-only";
        td.tabIndex = 0;
        td.dataset.row = String(row);
        td.dataset.col = String(col);
        td.style.height = `${rowHeights[row]}px`;
        td.textContent = String(sheet.data[row]?.[col] ?? "");
        const errorHint = formulaErrorHint(td.textContent);
        if (errorHint) td.title = errorHint;
        const address = XLSX.utils.encode_cell({ r: row, c: col });
        const merge = mergeStarts.get(`${row}:${col}`);
        if (merge) {
          td.rowSpan = Math.min(rows - row, merge.e.r - merge.s.r + 1);
          td.colSpan = Math.min(cols - col, merge.e.c - merge.s.c + 1);
        }
        if (typeof worksheet[address]?.f === "string") td.dataset.formula = "true";
        styleGridCell(td, cellPresentation(XLSX, model, sheet.name, row, col));
        if (row < freeze.rows) {
          td.style.position = "sticky";
          td.style.top = `${rowOffsets[row]}px`;
          td.style.zIndex = col < freeze.cols ? "6" : "3";
          if (!td.style.backgroundColor) td.style.backgroundColor = "var(--cell-bg)";
        }
        if (col < freeze.cols) {
          td.style.position = "sticky";
          td.style.left = `${columnOffsets[col]}px`;
          td.style.zIndex = row < freeze.rows ? "6" : "2";
          if (!td.style.backgroundColor) td.style.backgroundColor = "var(--cell-bg)";
        }
        td.addEventListener("pointerdown", (event) => {
          if (event.button !== 0 || fillDrag) return;
          draggingSelection = true;
          setSelection(row, col, { extend: event.shiftKey, focus: true });
        });
        td.addEventListener("pointerenter", (event) => {
          if (fillDrag && (event.buttons & 1)) {
            previewFillTo(row, col);
            return;
          }
          if (!draggingSelection || !(event.buttons & 1)) return;
          setSelection(row, col, { extend: true });
        });
        td.addEventListener("focus", () => {
          if (selection.row !== row || selection.col !== col) setSelection(row, col);
          if (!editSession || editSession.sheet !== sheet.name || editSession.row !== row || editSession.col !== col) {
            finalizeEditSession();
            editSession = {
              sheet: sheet.name,
              row,
              col,
              before: captureCellRange(XLSX, model, sheet.name, row, col, 1, 1),
              operationIndex: model.operations.length,
              dirty: false,
              editing: false
            };
          }
          const inputText = cellInputText(XLSX, model, sheet.name, row, col);
          if (inputText !== td.textContent) td.textContent = inputText;
          formulaInput.value = inputText;
          updateFormulaHelp(inputText);
        });
        td.addEventListener("dblclick", () => activateCellEditing(td));
        td.addEventListener("beforeinput", (event) => {
          if (editSession?.editing) return;
          if (event.inputType !== "insertText" && event.inputType !== "insertCompositionText") return;
          td.textContent = "";
          if (editSession) editSession.editing = true;
        });
        td.addEventListener("input", () => {
          const inputValue = td.textContent ?? "";
          setCellText(XLSX, model, sheet.name, row, col, inputValue, false);
          if (editSession) {
            const recoveryOperation = { type: "setCell", sheet: sheet.name, row, col, value: inputValue };
            if (editSession.dirty) model.operations[editSession.operationIndex] = recoveryOperation;
            else model.operations.splice(editSession.operationIndex, 0, recoveryOperation);
            editSession.dirty = true;
            editSession.editing = true;
          }
          formulaInput.value = td.textContent ?? "";
          updateFormulaHelp(formulaInput.value);
          const editedCell = worksheet[address];
          if (typeof editedCell?.f === "string") td.dataset.formula = "true";
          else delete td.dataset.formula;
          grid.querySelectorAll('td[data-formula="true"]').forEach((other) => {
            if (other === td) return;
            const otherRow = Number(other.dataset.row);
            const otherCol = Number(other.dataset.col);
            other.textContent = String(sheet.data[otherRow]?.[otherCol] ?? "");
          });
          scheduleSave();
          refreshSearchAfterEdit();
          updateSelectionSummary();
        });
        td.addEventListener("blur", () => {
          finalizeEditSession();
          td.textContent = String(sheet.data[row]?.[col] ?? "");
          updateSelectionControls();
        });
        tr.append(td);
      }
      body.append(tr);
    }
    grid.append(body);
    paintSelection();
    updateSearchHighlights();
  }

  const svgElement = (name, attributes = {}) => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  };

  function chartSeries(chart) {
    let range;
    try {
      range = XLSX.utils.decode_range(chart.range);
    } catch {
      return { labels: [], values: [] };
    }
    const sheet = currentSheet();
    const rows = [];
    for (let row = range.s.r; row <= range.e.r; row++) {
      rows.push(Array.from({ length: range.e.c - range.s.c + 1 }, (_, offset) => sheet.data[row]?.[range.s.c + offset] ?? ""));
    }
    if (rows.length > 1 && !Number.isFinite(Number(rows[0][Math.min(1, rows[0].length - 1)]))) rows.shift();
    const visibleRows = rows.slice(0, 50);
    const labels = visibleRows.map((row, index) => String(row.length > 1 ? row[0] : index + 1));
    const values = visibleRows.map((row) => Number(row.length > 1 ? row[1] : row[0])).map((value) => Number.isFinite(value) ? value : 0);
    return { labels, values };
  }

  function drawChart(svg, type, labels, values) {
    const width = 300;
    const height = 170;
    const colors = ["#3478f6", "#12b76a", "#f79009", "#7f56d9", "#06aed4", "#e84c88"];
    if (!values.length) return false;
    if (type === "pie") {
      const positive = values.map((value) => Math.max(0, value));
      const total = positive.reduce((sum, value) => sum + value, 0);
      if (!total) return false;
      let angle = -Math.PI / 2;
      positive.forEach((value, index) => {
        if (!value) return;
        const next = angle + value / total * Math.PI * 2;
        const x1 = 90 + Math.cos(angle) * 62;
        const y1 = 82 + Math.sin(angle) * 62;
        const x2 = 90 + Math.cos(next) * 62;
        const y2 = 82 + Math.sin(next) * 62;
        const large = next - angle > Math.PI ? 1 : 0;
        svg.append(svgElement("path", {
          d: `M 90 82 L ${x1} ${y1} A 62 62 0 ${large} 1 ${x2} ${y2} Z`,
          fill: colors[index % colors.length]
        }));
        const legend = svgElement("text", { x: 170, y: 25 + index * 22, fill: "#475467", "font-size": 11 });
        legend.textContent = `${labels[index]}  ${value}`;
        svg.append(legend);
        svg.append(svgElement("rect", { x: 154, y: 16 + index * 22, width: 10, height: 10, rx: 2, fill: colors[index % colors.length] }));
        angle = next;
      });
      return true;
    }
    const max = Math.max(...values.map((value) => Math.abs(value)), 1);
    if (type === "line") {
      const points = values.map((value, index) => {
        const x = 22 + index * (width - 44) / Math.max(1, values.length - 1);
        const y = height - 28 - value / max * (height - 52);
        return { x, y };
      });
      svg.append(svgElement("polyline", { points: points.map(({ x, y }) => `${x},${y}`).join(" "), fill: "none", stroke: "#3478f6", "stroke-width": 3, "stroke-linejoin": "round" }));
      points.forEach(({ x, y }, index) => {
        svg.append(svgElement("circle", { cx: x, cy: y, r: 4, fill: "#3478f6" }));
        const label = svgElement("text", { x, y: height - 8, fill: "#667085", "font-size": 10, "text-anchor": "middle" });
        label.textContent = labels[index].slice(0, 8);
        svg.append(label);
      });
      return true;
    }
    const gap = 8;
    const barWidth = Math.max(8, (width - 30 - gap * values.length) / values.length);
    values.forEach((value, index) => {
      const barHeight = Math.abs(value) / max * (height - 48);
      const x = 18 + index * (barWidth + gap);
      const y = height - 26 - barHeight;
      svg.append(svgElement("rect", { x, y, width: barWidth, height: barHeight, rx: 3, fill: colors[index % colors.length] }));
      const label = svgElement("text", { x: x + barWidth / 2, y: height - 8, fill: "#667085", "font-size": 10, "text-anchor": "middle" });
      label.textContent = labels[index].slice(0, 8);
      svg.append(label);
    });
    return true;
  }

  function renderCharts() {
    chartsContainer.replaceChildren();
    for (const chart of currentSheet().charts || []) {
      const card = document.createElement("section");
      card.className = "chart-card";
      const head = document.createElement("div");
      head.className = "chart-head";
      const title = document.createElement("span");
      title.textContent = `${chart.type === "line" ? "折线图" : chart.type === "pie" ? "饼图" : "柱状图"} · ${chart.range}`;
      const close = document.createElement("button");
      close.textContent = "×";
      close.title = "删除图表";
      close.hidden = !editMode;
      close.addEventListener("click", () => {
        if (!editMode) return;
        const sheet = currentSheet();
        const beforeLayout = captureSheetLayout(model, sheet.name);
        removeSheetChart(model, sheet.name, chart.id);
        const afterLayout = captureSheetLayout(model, sheet.name);
        pushHistory({ sheet: sheet.name, row: selection.row, col: selection.col, before: null, after: null, beforeLayout, afterLayout });
        scheduleSave();
        renderCharts();
      });
      head.append(title, close);
      card.append(head);
      const svg = svgElement("svg", { viewBox: "0 0 300 170", role: "img", "aria-label": title.textContent });
      const { labels, values } = chartSeries(chart);
      if (drawChart(svg, chart.type, labels, values)) card.append(svg);
      else {
        const empty = document.createElement("div");
        empty.className = "chart-empty";
        empty.textContent = "选区中没有可绘制的数值";
        card.append(empty);
      }
      chartsContainer.append(card);
    }
  }

  function render() {
    app.classList.toggle("edit-mode", editMode);
    modeToggle.textContent = editMode ? "返回简约" : "进入编辑";
    modeToggle.disabled = modeTransition;
    modeLabel.textContent = editMode ? "编辑" : "简约";
    documentName.textContent = documentTitle;
    document.title = documentTitle;
    renderTabs();
    renderGrid();
    renderCharts();
    updateHistoryButtons();
    setStatus(editMode ? "编辑模式 · 完整编辑工具已展开" : "简约模式 · 可直接编辑单元格并自动写入思源");
  }

  function validSheetName(value) {
    return value && !/[\\/:?*\[\]\x00-\x1f]/.test(value);
  }

  function renameSheet() {
    const sheet = model.sheets[active];
    const next = prompt("Sheet 名称", sheet.name)?.trim().slice(0, 31);
    if (!next || next === sheet.name) return;
    if (!validSheetName(next)) {
      alert("Sheet 名称不能包含 \\ / : ? * [ ] 等字符");
      return;
    }
    try {
      renameWorksheet(model, sheet.name, next);
      clearHistory();
      scheduleSave();
      renderTabs();
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  }

  async function exportWorkbook() {
    if (exportBusy) return;
    exportBusy = true;
    exportButton.disabled = true;
    finalizeEditSession();
    showOperationFeedback("正在生成并校验 .xlsx…", "working", 0);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    try {
      const bytes = withCanonicalReadView(() => serializeWorkbookModel(XLSX, model));
      const verified = withCanonicalReadView(() => validateSerializedWorkbook(XLSX, model, bytes));
      const url = URL.createObjectURL(new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      }));
      const link = document.createElement("a");
      link.href = url;
      link.download = assetFileName.toLowerCase().endsWith(".xlsx") ? assetFileName : `${documentTitle}.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const message = `已校验并导出 .xlsx（${verified.sheetCount} 个 Sheet、${verified.formulaCount} 个公式）`;
      setStatus(message);
      showOperationFeedback(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`导出失败：${message}`);
      showOperationFeedback(`导出失败：${message}`, "warning", 4800);
    } finally {
      exportBusy = false;
      exportButton.disabled = false;
    }
  }

  async function persist(force) {
    if (saveInFlight) {
      saveAgain = true;
      return;
    }
    saveInFlight = true;
    lastSaveError = "";
    let overwriteConflict = false;
    const operationCount = model.operations.length;
    try {
      setStatus(force ? "正在覆盖写入思源…" : "正在写入思源…");
      const bytes = withCanonicalReadView(() => serializeWorkbookModel(XLSX, model));
      const saved = await store.save(bytes, { force });
      model.operations.splice(0, operationCount);
      const savedAt = new Date().toLocaleTimeString();
      setStatus(saved.unchanged
        ? `内容已保存 ${savedAt}`
        : `已写入思源附件 ${savedAt}`);
    } catch (error) {
      console.error(error);
      if (error instanceof SaveConflictError) {
        lastSaveError = "思源附件已有新版本，本机修改已保留";
        setStatus(`保存冲突：${lastSaveError}`);
        overwriteConflict = confirm("思源附件已在其他页面或设备发生变化。确定用当前页面内容覆盖远端版本吗？");
      } else {
        lastSaveError = error instanceof Error ? error.message : String(error);
        setStatus(`保存失败（本机修改已保留）：${lastSaveError}`);
      }
    } finally {
      saveInFlight = false;
      if (overwriteConflict) {
        saveAgain = false;
        void persist(true);
      } else if (saveAgain) {
        saveAgain = false;
        void persist(false);
      }
    }
  }

  async function setEditMode(next) {
    if (!model || modeTransition || next === editMode) return;
    modeTransition = true;
    modeToggle.disabled = true;
    try {
      if (next) {
        restoreReadViews();
        editMode = true;
        render();
        cellLocator(selection.row, selection.col)?.focus();
        return;
      }
      document.activeElement?.blur?.();
      finalizeEditSession();
      clearTimeout(saveTimer);
      setStatus("正在完成编辑并保存…");
      await persist(false);
      while (saveInFlight || saveAgain) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (lastSaveError) {
        const message = `无法结束编辑：${lastSaveError}`;
        setStatus(message);
        showOperationFeedback(message, "warning", 4800);
        return;
      }
      editMode = false;
      readViewSnapshots.clear();
      render();
    } finally {
      modeTransition = false;
      modeToggle.disabled = false;
    }
  }

  function selectedRangeSnapshot() {
    const { startRow, endRow, startCol, endCol } = selectionBounds();
    return {
      sheet: currentSheet().name,
      row: startRow,
      col: startCol,
      rows: endRow - startRow + 1,
      cols: endCol - startCol + 1,
      before: captureCellRange(
        XLSX,
        model,
        currentSheet().name,
        startRow,
        startCol,
        endRow - startRow + 1,
        endCol - startCol + 1
      )
    };
  }

  function finishRangeMutation(range, { beforeLayout, renderAll = false } = {}) {
    const after = captureCellRange(XLSX, model, range.sheet, range.row, range.col, range.rows, range.cols);
    const afterLayout = beforeLayout ? captureSheetLayout(model, range.sheet) : undefined;
    pushHistory({ ...range, after, beforeLayout, afterLayout });
    scheduleSave();
    if (renderAll) render();
    else renderGrid();
    selectionKind = "cells";
    selection = {
      anchorRow: range.row,
      anchorCol: range.col,
      row: range.row + range.rows - 1,
      col: range.col + range.cols - 1
    };
    paintSelection();
    refreshSearchAfterEdit();
  }

  function mutateSelectedRange(mutator, { withLayout = false, renderAll = false } = {}) {
    finalizeEditSession();
    const range = selectedRangeSnapshot();
    const beforeLayout = withLayout ? captureSheetLayout(model, range.sheet) : undefined;
    try {
      mutator(range);
      finishRangeMutation(range, { beforeLayout, renderAll });
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  }

  function mutateSheetLayout(mutator, { renderAll = false } = {}) {
    finalizeEditSession();
    const sheet = currentSheet();
    const beforeLayout = captureSheetLayout(model, sheet.name);
    try {
      mutator(sheet);
      const afterLayout = captureSheetLayout(model, sheet.name);
      pushHistory({ sheet: sheet.name, row: selection.row, col: selection.col, before: null, after: null, beforeLayout, afterLayout });
      scheduleSave();
      if (renderAll) render();
      else renderGrid();
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  }

  function commitFormulaBar() {
    updateFormulaHelp("");
    if (!formulaSession || !model) return;
    const session = formulaSession;
    formulaSession = null;
    const next = formulaInput.value;
    const previous = cellInputText(XLSX, model, session.sheet, session.row, session.col);
    if (next === previous) return;
    const before = captureCellRange(XLSX, model, session.sheet, session.row, session.col, 1, 1);
    setCellText(XLSX, model, session.sheet, session.row, session.col, next);
    const after = captureCellRange(XLSX, model, session.sheet, session.row, session.col, 1, 1);
    pushHistory({ sheet: session.sheet, row: session.row, col: session.col, rows: 1, cols: 1, before, after });
    scheduleSave();
    renderGrid();
    setSelection(session.row, session.col, { focus: true, scroll: true });
    refreshSearchAfterEdit();
  }

  function applyFormat(format) {
    mutateSelectedRange((range) => {
      applyCellFormatting(
        XLSX,
        model,
        range.sheet,
        range.row,
        range.col,
        range.row + range.rows - 1,
        range.col + range.cols - 1,
        format
      );
    });
  }

  function setTextFlow(mode) {
    if (!["overflow", "cut", "wrap"].includes(mode)) return;
    applyFormat({ textFlow: mode });
    document.querySelector("#text-flow").open = false;
  }

  function toggleMerge() {
    mutateSelectedRange((range) => {
      const removed = unmergeCellAt(XLSX, model, range.sheet, selection.row, selection.col);
      if (!removed) {
        if (range.rows === 1 && range.cols === 1) throw new Error("请先选择至少两个单元格");
        mergeCellRange(
          XLSX,
          model,
          range.sheet,
          range.row,
          range.col,
          range.row + range.rows - 1,
          range.col + range.cols - 1
        );
      }
    }, { withLayout: true });
  }

  function sortSelection(direction) {
    finalizeEditSession();
    const sheet = currentSheet();
    const worksheet = model.workbook.Sheets[sheet.name];
    let bounds = selectionBounds();
    const used = XLSX.utils.decode_range(worksheet["!ref"] || "A1:A1");
    if (selectionKind === "cells" && bounds.startRow === bounds.endRow && bounds.startCol === bounds.endCol) {
      bounds = {
        startRow: used.s.r,
        endRow: Math.min(sheet.viewRows - 1, used.e.r),
        startCol: used.s.c,
        endCol: Math.min(sheet.viewCols - 1, used.e.c)
      };
    } else if (selectionKind === "cols") {
      bounds.startRow = used.s.r;
      bounds.endRow = Math.min(sheet.viewRows - 1, used.e.r);
    } else if (selectionKind === "rows") {
      bounds.startCol = used.s.c;
      bounds.endCol = Math.min(sheet.viewCols - 1, used.e.c);
    }
    if (bounds.endRow <= bounds.startRow) {
      alert("排序区域至少需要一行表头和一行数据");
      return;
    }
    const sortRange = {
      s: { r: bounds.startRow, c: bounds.startCol },
      e: { r: bounds.endRow, c: bounds.endCol }
    };
    const range = {
      sheet: sheet.name,
      row: bounds.startRow,
      col: bounds.startCol,
      rows: bounds.endRow - bounds.startRow + 1,
      cols: bounds.endCol - bounds.startCol + 1,
      before: captureCellRange(XLSX, model, sheet.name, bounds.startRow, bounds.startCol, bounds.endRow - bounds.startRow + 1, bounds.endCol - bounds.startCol + 1)
    };
    try {
      sortCellRange(XLSX, model, sheet.name, sortRange, Math.max(bounds.startCol, Math.min(bounds.endCol, selection.col)), direction, 1);
      finishRangeMutation(range);
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  }

  function createChart() {
    const bounds = selectionBounds();
    const sheet = currentSheet();
    const used = XLSX.utils.decode_range(model.workbook.Sheets[sheet.name]["!ref"] || "A1:A1");
    if (selectionKind === "cols") {
      bounds.startRow = used.s.r;
      bounds.endRow = Math.min(sheet.viewRows - 1, used.e.r);
    } else if (selectionKind === "rows") {
      bounds.startCol = used.s.c;
      bounds.endCol = Math.min(sheet.viewCols - 1, used.e.c);
    }
    const { startRow, endRow, startCol, endCol } = bounds;
    if (startRow === endRow && startCol === endCol) {
      alert("请先选择要绘图的数据区域");
      return;
    }
    mutateSheetLayout((sheet) => {
      addSheetChart(model, sheet.name, {
        type: document.querySelector("#chart-type").value,
        range: XLSX.utils.encode_range({ s: { r: startRow, c: startCol }, e: { r: endRow, c: endCol } })
      });
    }, { renderAll: true });
  }

  function clearSelectedCells() {
    finalizeEditSession();
    const range = selectedRangeSnapshot();
    const values = Array.from({ length: range.rows }, () => Array(range.cols).fill(""));
    setCellRange(XLSX, model, range.sheet, range.row, range.col, values);
    const after = captureCellRange(XLSX, model, range.sheet, range.row, range.col, range.rows, range.cols);
    pushHistory({ ...range, after });
    scheduleSave();
    renderGrid();
    setSelection(range.row, range.col, { focus: true });
    refreshSearchAfterEdit();
  }

  async function pasteTable(text) {
    finalizeEditSession();
    let values = parseClipboardTable(text);
    const startRow = selection.row;
    const startCol = selection.col;
    const availableRows = MAX_RENDER_ROWS - startRow;
    const availableCols = MAX_RENDER_COLS - startCol;
    const originalRows = values.length;
    const originalCols = Math.max(0, ...values.map((row) => row.length));
    values = values.slice(0, availableRows).map((row) => row.slice(0, availableCols));
    if (!values.length || !values[0]?.length) return;
    const truncatedRows = Math.max(0, originalRows - values.length);
    const truncatedCols = Math.max(0, originalCols - Math.max(0, ...values.map((row) => row.length)));
    showOperationFeedback(`正在粘贴 ${values.length} 行 × ${Math.max(0, ...values.map((row) => row.length))} 列…`, "working", 0);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const sheet = currentSheet();
    const rowCount = values.length;
    const colCount = values[0].length;
    const before = captureCellRange(XLSX, model, sheet.name, startRow, startCol, rowCount, colCount);
    setCellRange(XLSX, model, sheet.name, startRow, startCol, values);
    const after = captureCellRange(XLSX, model, sheet.name, startRow, startCol, rowCount, colCount);
    pushHistory({ sheet: sheet.name, row: startRow, col: startCol, rows: rowCount, cols: colCount, before, after });
    selection = {
      anchorRow: startRow,
      anchorCol: startCol,
      row: startRow + rowCount - 1,
      col: startCol + colCount - 1
    };
    scheduleSave();
    renderGrid();
    setSelection(selection.row, selection.col, { extend: true, focus: true, scroll: true });
    refreshSearchAfterEdit();
    const writtenCells = rowCount * colCount;
    if (truncatedRows || truncatedCols) {
      showOperationFeedback(`已写入 ${writtenCells} 个单元格；受轻量编辑上限影响，省略 ${truncatedRows} 行、${truncatedCols} 列`, "warning", 4200);
    } else {
      showOperationFeedback(`已粘贴 ${rowCount} 行 × ${colCount} 列（${writtenCells} 个单元格）`);
    }
  }

  function moveSelection(rowDelta, colDelta, extend = false) {
    finalizeEditSession();
    const currentMerge = mergeRangeAt(selection.row, selection.col);
    const targetRow = currentMerge && rowDelta > 0 ? currentMerge.e.r + rowDelta : selection.row + rowDelta;
    const targetCol = currentMerge && colDelta > 0 ? currentMerge.e.c + colDelta : selection.col + colDelta;
    setSelection(targetRow, targetCol, {
      extend,
      focus: true,
      scroll: true
    });
  }

  function moveSelectionTo(row, col, extend = false) {
    finalizeEditSession();
    setSelection(row, col, { extend, focus: true, scroll: true });
  }

  function usedRangeEnd() {
    const sheet = currentSheet();
    const worksheet = model.workbook.Sheets[sheet.name];
    let range;
    try {
      range = XLSX.utils.decode_range(worksheet["!ref"] || "A1:A1");
    } catch {
      range = { e: { r: 0, c: 0 } };
    }
    const dimensions = sheetDimensions(sheet);
    return {
      row: Math.max(0, Math.min(dimensions.rows - 1, range.e.r)),
      col: Math.max(0, Math.min(dimensions.cols - 1, range.e.c))
    };
  }

  function cellHasContent(row, col) {
    return String(currentSheet().data[row]?.[col] ?? "") !== "";
  }

  function jumpToDataEdge(row, col, rowDelta, colDelta) {
    const dimensions = sheetDimensions(currentSheet());
    const lastRow = dimensions.rows - 1;
    const lastCol = dimensions.cols - 1;
    const startHasContent = cellHasContent(row, col);
    let nextRow = row;
    let nextCol = col;
    const canMove = () => {
      const candidateRow = nextRow + rowDelta;
      const candidateCol = nextCol + colDelta;
      return candidateRow >= 0 && candidateRow <= lastRow && candidateCol >= 0 && candidateCol <= lastCol;
    };
    while (canMove()) {
      const candidateRow = nextRow + rowDelta;
      const candidateCol = nextCol + colDelta;
      const candidateHasContent = cellHasContent(candidateRow, candidateCol);
      if (startHasContent && !candidateHasContent) break;
      nextRow = candidateRow;
      nextCol = candidateCol;
      if (!startHasContent && candidateHasContent) break;
    }
    return { row: nextRow, col: nextCol };
  }

  function handleGridKeydown(event) {
    const modifier = event.ctrlKey || event.metaKey;
    const targetCell = event.target instanceof HTMLElement ? event.target.closest("td") : null;
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
      return;
    }
    if (modifier && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if (event.key === "Escape" && editSession) {
      event.preventDefault();
      cancelEditSession();
      return;
    }
    if (event.key === "F2" && targetCell) {
      event.preventDefault();
      activateCellEditing(targetCell);
      return;
    }
    const directTextInput = targetCell
      && selectionKind === "cells"
      && !modifier
      && !event.altKey
      && !event.isComposing
      && event.key.length === 1
      && !editSession?.editing;
    if (directTextInput) {
      event.preventDefault();
      targetCell.textContent = event.key;
      targetCell.dispatchEvent(new InputEvent("input", {
        bubbles: false,
        inputType: "insertText",
        data: event.key
      }));
      placeCaretAtEnd(targetCell);
      return;
    }
    if (editMode && event.key === "Delete") {
      event.preventDefault();
      clearSelectedCells();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      moveSelection(event.shiftKey ? -1 : 1, 0);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      moveSelection(0, event.shiftKey ? -1 : 1);
      return;
    }
    if ((event.key === "Home" || event.key === "End") && !editSession?.editing) {
      event.preventDefault();
      const usedEnd = usedRangeEnd();
      if (event.key === "Home") {
        moveSelectionTo(modifier ? 0 : selection.row, 0, event.shiftKey);
      } else {
        moveSelectionTo(modifier ? usedEnd.row : selection.row, usedEnd.col, event.shiftKey);
      }
      return;
    }
    const arrows = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1]
    };
    const movement = arrows[event.key];
    if (movement && !editSession?.editing && (!editSession?.dirty || modifier)) {
      event.preventDefault();
      if (modifier) {
        const target = jumpToDataEdge(selection.row, selection.col, movement[0], movement[1]);
        moveSelectionTo(target.row, target.col, event.shiftKey);
      } else {
        moveSelection(movement[0], movement[1], event.shiftKey);
      }
    }
  }

  async function mutateStructure(axis, mode) {
    if (structureBusy) return;
    finalizeEditSession();
    const sheet = model.sheets[active];
    const dimensions = sheetDimensions(sheet);
    const truncated = axis === "row" ? dimensions.truncatedRows : dimensions.truncatedCols;
    if (truncated) {
      const message = `该工作表已超过当前可视${axis === "row" ? "行" : "列"}数限制；为避免误改未显示内容，本次操作未执行`;
      setStatus(message);
      showOperationFeedback(message, "warning", 3600);
      return;
    }
    const { index, count, range } = structureSelection(axis);
    const visibleCount = axis === "row" ? dimensions.rows : dimensions.cols;
    const limit = axis === "row" ? MAX_RENDER_ROWS : MAX_RENDER_COLS;
    if (mode === "insert" && visibleCount + count > limit) {
      const message = `插入后将超过 ${limit} ${axis === "row" ? "行" : "列"}的轻量编辑限制，本次操作未执行`;
      setStatus(message);
      showOperationFeedback(message, "warning", 3600);
      return;
    }
    const noun = axis === "row" ? "行" : "列";
    if (mode === "delete" && count > 1 && !confirm(`确定删除选中的 ${count} ${noun}（${range}）吗？该操作可以撤销。`)) {
      showOperationFeedback(`已取消删除 ${count} ${noun}`);
      return;
    }
    const beforeSelection = { kind: selectionKind, selection: { ...selection } };
    const verb = mode === "insert" ? "插入" : "删除";
    setStructureBusy(true);
    document.querySelector("#structure-menu").open = false;
    closeStructureContextMenu();
    showOperationFeedback(`正在${verb} ${count} ${noun}…`, "working", 0);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    let beforeWorkbookState;
    const wrapper = document.querySelector(".grid-wrap");
    const previousScroll = { top: wrapper.scrollTop, left: wrapper.scrollLeft };
    try {
      beforeWorkbookState = captureWorkbookState(model, sheet.name);
      if (axis === "row" && mode === "insert") insertRows(XLSX, model, sheet.name, index, count);
      else if (axis === "row") deleteRows(XLSX, model, sheet.name, index, count);
      else if (mode === "insert") insertColumns(XLSX, model, sheet.name, index, count);
      else deleteColumns(XLSX, model, sheet.name, index, count);
      const afterWorkbookState = captureWorkbookState(model, sheet.name);
      const nextDimensions = sheetDimensions(currentSheet());
      const selectedCount = mode === "insert" ? count : 1;
      if (axis === "row") {
        const row = Math.min(index, nextDimensions.rows - 1);
        selectionKind = "rows";
        selection = {
          anchorRow: row,
          row: Math.min(nextDimensions.rows - 1, row + selectedCount - 1),
          anchorCol: 0,
          col: nextDimensions.cols - 1
        };
      } else {
        const col = Math.min(index, nextDimensions.cols - 1);
        selectionKind = "cols";
        selection = {
          anchorRow: 0,
          row: nextDimensions.rows - 1,
          anchorCol: col,
          col: Math.min(nextDimensions.cols - 1, col + selectedCount - 1)
        };
      }
      const afterSelection = { kind: selectionKind, selection: { ...selection } };
      pushHistory({
        sheet: sheet.name,
        row: axis === "row" ? index : selection.row,
        col: axis === "col" ? index : selection.col,
        beforeWorkbookState,
        afterWorkbookState,
        beforeSelection,
        afterSelection
      });
      scheduleSave();
      renderGrid();
      wrapper.scrollTop = previousScroll.top;
      wrapper.scrollLeft = previousScroll.left;
      focusCurrentSelection();
      refreshSearchAfterEdit();
      showOperationFeedback(`已${verb} ${count} ${noun}（${range}）`);
    } catch (error) {
      if (beforeWorkbookState) restoreWorkbookState(XLSX, model, beforeWorkbookState, false);
      const message = `${verb}失败：${error instanceof Error ? error.message : String(error)}`;
      console.error(error);
      setStatus(message);
      showOperationFeedback(message, "warning", 4200);
      renderGrid();
    } finally {
      setStructureBusy(false);
    }
  }

  async function load() {
    const remoteModel = parseWorkbookModel(XLSX, await store.loadRemote(), asset);
    const recovery = store.readRecovery();
    if (!recovery) return { value: remoteModel, state: "remote" };
    const payload = recovery.payload;
    if (payload?.schema === SHEET_RECOVERY_SCHEMA) {
      applyRecoveryPayload(XLSX, remoteModel, payload);
      if (recovery.baseHash === store.baseHash) {
        return { value: remoteModel, state: "recovery" };
      }
      store.conflicted = true;
      return { value: remoteModel, state: "conflict" };
    }
    const acceptLegacy = confirm(
      "检测到旧版本保存的表格恢复数据。旧缓存仅包含文本，恢复可能丢失公式和格式。是否仍要恢复？"
    );
    if (!acceptLegacy) return { value: remoteModel, state: "legacy-kept" };
    applyLegacyRecovery(XLSX, remoteModel, payload);
    return {
      value: remoteModel,
      state: recovery.baseHash === store.baseHash ? "legacy-recovery" : "conflict"
    };
  }

  document.querySelector("#insert-row").addEventListener("click", () => void mutateStructure("row", "insert"));
  document.querySelector("#delete-row").addEventListener("click", () => void mutateStructure("row", "delete"));
  document.querySelector("#insert-col").addEventListener("click", () => void mutateStructure("col", "insert"));
  document.querySelector("#delete-col").addEventListener("click", () => void mutateStructure("col", "delete"));
  contextStructureInsert.addEventListener("click", () => {
    const axis = contextStructureAxis;
    if (axis) void mutateStructure(axis, "insert");
  });
  contextStructureDelete.addEventListener("click", () => {
    const axis = contextStructureAxis;
    if (axis) void mutateStructure(axis, "delete");
  });
  formulaInput.addEventListener("focus", () => {
    finalizeEditSession();
    formulaSession = { sheet: currentSheet().name, row: selection.row, col: selection.col };
    updateFormulaHelp();
  });
  formulaInput.addEventListener("input", () => updateFormulaHelp());
  formulaInput.addEventListener("keydown", (event) => {
    if (!formulaSuggestionMenu.hidden && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setFormulaSuggestionIndex(formulaSuggestionIndex + (event.key === "ArrowDown" ? 1 : -1));
    } else if (!formulaSuggestionMenu.hidden && (event.key === "Enter" || event.key === "Tab")) {
      event.preventDefault();
      const button = formulaSuggestionButtons()[Math.max(0, formulaSuggestionIndex)];
      if (button?.dataset.formula) applyFormulaSuggestion(button.dataset.formula);
    } else if (event.key === "Enter") {
      event.preventDefault();
      commitFormulaBar();
    } else if (event.key === "Escape") {
      event.preventDefault();
      formulaSession = null;
      updateSelectionControls();
      updateFormulaHelp("");
      cellLocator(selection.row, selection.col)?.focus();
    }
  });
  formulaInput.addEventListener("blur", () => {
    hideFormulaSuggestions();
    commitFormulaBar();
  });
  for (const [id, property] of [["bold", "bold"], ["italic", "italic"], ["underline", "underline"]]) {
    document.querySelector(`#${id}`).addEventListener("click", () => {
      const { startRow, startCol } = selectionBounds();
      const current = cellPresentation(XLSX, model, currentSheet().name, startRow, startCol)[property];
      applyFormat({ [property]: !current });
    });
  }
  document.querySelector("#text-color").addEventListener("change", (event) => applyFormat({ textColor: event.target.value }));
  document.querySelector("#fill-color").addEventListener("change", (event) => applyFormat({ fillColor: event.target.value }));
  document.querySelectorAll("[data-align]").forEach((button) => {
    button.addEventListener("click", () => {
      applyFormat({ horizontal: button.dataset.align });
      document.querySelector("#align-menu").open = false;
    });
  });
  document.querySelector("#number-format").addEventListener("change", (event) => applyFormat({ numberFormat: event.target.value }));
  document.querySelector("#merge").addEventListener("click", toggleMerge);
  const applyFreeze = (rows, cols) => {
    mutateSheetLayout((sheet) => setSheetFreeze(model, sheet.name, rows, cols));
    freezeMenu.open = false;
  };
  document.querySelector("#freeze-clear").addEventListener("click", () => applyFreeze(0, 0));
  document.querySelector("#freeze-row").addEventListener("click", () => applyFreeze(selection.row + 1, 0));
  document.querySelector("#freeze-col").addEventListener("click", () => applyFreeze(0, selection.col + 1));
  document.querySelector("#freeze-both").addEventListener("click", () => applyFreeze(selection.row + 1, selection.col + 1));
  document.querySelectorAll("[data-text-flow]").forEach((button) => {
    button.addEventListener("click", () => setTextFlow(button.dataset.textFlow));
  });
  document.querySelector("#sort-asc").addEventListener("click", (event) => {
    sortSelection("asc");
    event.currentTarget.closest("details").open = false;
  });
  document.querySelector("#sort-desc").addEventListener("click", (event) => {
    sortSelection("desc");
    event.currentTarget.closest("details").open = false;
  });
  document.querySelector("#filter-apply").addEventListener("click", (event) => {
    const query = filterQuery.value;
    mutateSheetLayout((sheet) => setSheetFilter(XLSX, model, sheet.name, selection.col, query));
    event.currentTarget.closest("details").open = false;
  });
  document.querySelector("#filter-clear").addEventListener("click", (event) => {
    mutateSheetLayout((sheet) => setSheetFilter(XLSX, model, sheet.name, selection.col, ""));
    event.currentTarget.closest("details").open = false;
  });
  filterQuery.addEventListener("keydown", (event) => {
    if (event.key === "Enter") document.querySelector("#filter-apply").click();
  });
  document.querySelector("#chart-create").addEventListener("click", createChart);
  undoButton.addEventListener("click", undo);
  redoButton.addEventListener("click", redo);
  document.querySelector("#rename").addEventListener("click", renameSheet);
  document.querySelector("#delete").addEventListener("click", () => {
    if (!confirm(`删除 ${model.sheets[active].name}？`)) return;
    try {
      deleteWorksheet(model, model.sheets[active].name);
      active = Math.max(0, active - 1);
      selectionKind = "cells";
      selection = { anchorRow: 0, anchorCol: 0, row: 0, col: 0 };
      clearHistory();
      scheduleSave();
      render();
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  });
  exportButton.addEventListener("click", () => void exportWorkbook());
  addSheetButton.addEventListener("click", () => {
    if (!editMode) return;
    const name = uniqueName("Sheet");
    addWorksheet(XLSX, model, name);
    active = model.sheets.length - 1;
    selectionKind = "cells";
    selection = { anchorRow: 0, anchorCol: 0, row: 0, col: 0 };
    clearHistory();
    scheduleSave();
    render();
  });
  grid.addEventListener("keydown", handleGridKeydown);
  grid.addEventListener("copy", (event) => {
    const { startRow, endRow, startCol, endCol } = selectionBounds();
    const text = cellRangeToTsv(
      XLSX,
      model,
      currentSheet().name,
      startRow,
      startCol,
      endRow - startRow + 1,
      endCol - startCol + 1
    );
    event.clipboardData?.setData("text/plain", text);
    event.preventDefault();
  });
  grid.addEventListener("paste", (event) => {
    const text = event.clipboardData?.getData("text/plain");
    if (text == null) return;
    event.preventDefault();
    void pasteTable(text);
  });
  window.addEventListener("pointerup", () => {
    draggingSelection = false;
    headerDrag = null;
    if (!fillDrag) return;
    const { source, target } = fillDrag;
    fillDrag = null;
    if (snapshotsEqual(source, target)) {
      paintSelection();
      return;
    }
    finalizeEditSession();
    const sheet = currentSheet();
    const range = {
      sheet: sheet.name,
      row: target.s.r,
      col: target.s.c,
      rows: target.e.r - target.s.r + 1,
      cols: target.e.c - target.s.c + 1,
      before: captureCellRange(XLSX, model, sheet.name, target.s.r, target.s.c, target.e.r - target.s.r + 1, target.e.c - target.s.c + 1)
    };
    try {
      fillCellRange(XLSX, model, sheet.name, source, target);
      finishRangeMutation(range);
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
      renderGrid();
    }
  });
  window.addEventListener("pointercancel", () => {
    draggingSelection = false;
    headerDrag = null;
  });
  findInput.addEventListener("input", () => {
    collectSearchMatches(findInput.value);
    if (searchMatches.length) {
      const match = searchMatches[0];
      setSelection(match.row, match.col, { focus: false, scroll: true });
      updateSearchHighlights();
    }
  });
  replaceInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      replaceSearchMatches(event.ctrlKey || event.metaKey);
    }
  });
  findInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      findMatch(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      findInput.value = "";
      collectSearchMatches("");
      closeSearchPanel();
    }
  });
  function openSearchPanel() {
    if (findSelection.checked) searchSelectionScope = { ...selectionBounds() };
    searchPanel.hidden = false;
    document.querySelector("#search-toggle").classList.add("active");
    requestAnimationFrame(() => {
      findInput.focus({ preventScroll: true });
      findInput.select();
    });
  }

  function closeSearchPanel() {
    searchPanel.hidden = true;
    searchSelectionScope = null;
    document.querySelector("#search-toggle").classList.remove("active");
    cellLocator(selection.row, selection.col)?.focus();
  }

  document.querySelector("#find-prev").addEventListener("click", () => findMatch(-1));
  document.querySelector("#find-next").addEventListener("click", () => findMatch(1));
  replaceOneButton.addEventListener("click", () => replaceSearchMatches(false));
  replaceAllButton.addEventListener("click", () => replaceSearchMatches(true));
  findSelection.addEventListener("change", () => {
    searchSelectionScope = findSelection.checked ? { ...selectionBounds() } : null;
    collectSearchMatches(findInput.value);
  });
  for (const option of [findCase, findFormulas]) {
    option.addEventListener("change", () => collectSearchMatches(findInput.value));
  }
  modeToggle.addEventListener("click", () => void setEditMode(!editMode));
  document.querySelector("#search-toggle").addEventListener("click", () => {
    if (searchPanel.hidden) openSearchPanel();
    else closeSearchPanel();
  });
  document.querySelector("#search-close").addEventListener("click", closeSearchPanel);
  document.querySelectorAll(".tool-menu").forEach((details) => {
    details.addEventListener("toggle", () => {
      if (!details.open) return;
      document.querySelectorAll(".tool-menu[open]").forEach((other) => {
        if (other !== details) other.open = false;
      });
      const summary = details.querySelector("summary");
      const menu = details.querySelector(".menu-pop");
      const rect = summary.getBoundingClientRect();
      menu.style.top = `${rect.bottom + 4}px`;
      menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - menu.offsetWidth - 8))}px`;
      if (details.contains(filterQuery)) {
        requestAnimationFrame(() => {
          filterQuery.focus({ preventScroll: true });
          filterQuery.select();
        });
      }
    });
  });
  document.addEventListener("pointerdown", (event) => {
    if (!structureContextMenu.contains(event.target)) closeStructureContextMenu();
    document.querySelectorAll(".tool-menu[open]").forEach((details) => {
      if (!details.contains(event.target)) details.open = false;
    });
  });
  document.querySelector(".grid-wrap").addEventListener("scroll", closeStructureContextMenu, { passive: true });
  window.addEventListener("resize", closeStructureContextMenu);
  window.addEventListener("resize", () => {
    if (!formulaSuggestionMenu.hidden) positionFormulaSuggestions();
  });
  document.addEventListener("keydown", (event) => {
    const modifier = event.ctrlKey || event.metaKey;
    const structureShortcut = modifier && grid.contains(document.activeElement)
      && (selectionKind === "rows" || selectionKind === "cols");
    if (editMode && structureShortcut && (event.key === "+" || (event.key === "=" && event.shiftKey))) {
      event.preventDefault();
      void mutateStructure(selectionKind === "rows" ? "row" : "col", "insert");
      return;
    }
    if (editMode && structureShortcut && event.key === "-") {
      event.preventDefault();
      void mutateStructure(selectionKind === "rows" ? "row" : "col", "delete");
      return;
    }
    if (event.key === "Escape" && !structureContextMenu.hidden) {
      event.preventDefault();
      closeStructureContextMenu();
      focusCurrentSelection();
      return;
    }
    if (modifier && event.key.toLowerCase() === "f") {
      event.preventDefault();
      openSearchPanel();
    }
  });

  load().then(({ value, state }) => {
    model = value;
    if (!model.sheets.length) addWorksheet(XLSX, model, "Sheet1", false);
    render();
    requestAnimationFrame(() => {
      const wrapper = document.querySelector(".grid-wrap");
      wrapper.scrollTop = 0;
      wrapper.scrollLeft = 0;
    });
    if (state === "conflict") {
      setStatus("检测到跨设备保存冲突：当前显示合并后的本机修改，尚未覆盖思源");
      if (confirm("检测到本机恢复内容与思源附件冲突。确定用当前表格覆盖思源中的版本吗？")) {
        void persist(true);
      }
    } else if (state === "legacy-kept") {
      setStatus("已读取思源附件；旧版本机缓存仍保留");
    } else if (state === "legacy-recovery" || state === "recovery") {
      setStatus("检测到未写入的本机修改，正在恢复到思源…");
      scheduleSave();
    } else {
      setStatus("简约模式 · 可直接编辑单元格并自动写入思源");
    }
  }).catch((error) => {
    console.error(error);
    setStatus(error instanceof Error ? error.message : String(error));
  });
})();
