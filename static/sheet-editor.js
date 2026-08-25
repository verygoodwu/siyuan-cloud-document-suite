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
  cellInputText,
  cellPresentation,
  cellRangeToTsv,
  deleteWorksheet,
  fillCellRange,
  makeRecoveryPayload,
  mergeCellRange,
  parseClipboardTable,
  parseWorkbookModel,
  renameWorksheet,
  removeSheetChart,
  restoreCellRange,
  restoreSheetLayout,
  serializeWorkbookModel,
  setCellRange,
  setCellText,
  setSheetFilter,
  setSheetFreeze,
  sheetDimensions,
  sortCellRange,
  unmergeCellAt
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
  let model;
  let active = 0;
  let editMode = false;
  let modeTransition = false;
  let saveTimer;
  let saveInFlight = false;
  let saveAgain = false;
  let sizeWarning = "";
  let selection = { anchorRow: 0, anchorCol: 0, row: 0, col: 0 };
  let selectionKind = "cells";
  let draggingSelection = false;
  let fillDrag = null;
  let editSession = null;
  let formulaSession = null;
  const readViewSnapshots = new Map();
  const undoStack = [];
  const redoStack = [];
  let searchMatches = [];
  let searchIndex = -1;
  let lastSearchQuery = "";
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

  const currentSheet = () => model.sheets[active];

  const selectionBounds = () => ({
    startRow: Math.min(selection.anchorRow, selection.row),
    endRow: Math.max(selection.anchorRow, selection.row),
    startCol: Math.min(selection.anchorCol, selection.col),
    endCol: Math.max(selection.anchorCol, selection.col)
  });

  const cellLocator = (row, col) =>
    grid.querySelector(`td[data-row="${row}"][data-col="${col}"]`);

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
  }

  function updateHistoryButtons() {
    undoButton.disabled = undoStack.length === 0;
    redoButton.disabled = redoStack.length === 0;
  }

  function snapshotsEqual(first, second) {
    return JSON.stringify(first) === JSON.stringify(second);
  }

  function pushHistory(entry) {
    if (snapshotsEqual(entry.before, entry.after) && snapshotsEqual(entry.beforeLayout, entry.afterLayout)) return;
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

  function setSelection(row, col, { extend = false, focus = false, scroll = false } = {}) {
    const sheet = currentSheet();
    if (!sheet) return;
    const { rows, cols } = sheetDimensions(sheet);
    const nextRow = Math.max(0, Math.min(rows - 1, row));
    const nextCol = Math.max(0, Math.min(cols - 1, col));
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

  function collectSearchMatches(query) {
    const normalized = query.trim().toLocaleLowerCase();
    lastSearchQuery = query;
    if (!normalized) {
      searchMatches = [];
      searchIndex = -1;
      updateSearchHighlights();
      return;
    }
    const sheet = currentSheet();
    const { rows, cols } = sheetDimensions(sheet);
    searchMatches = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const value = String(sheet.data[row]?.[col] ?? "").toLocaleLowerCase();
        if (value.includes(normalized)) searchMatches.push({ row, col });
      }
    }
    searchIndex = searchMatches.length ? 0 : -1;
    updateSearchHighlights();
  }

  function findMatch(direction = 1) {
    const query = findInput.value;
    if (query !== lastSearchQuery) collectSearchMatches(query);
    if (!searchMatches.length) return;
    searchIndex = (searchIndex + direction + searchMatches.length) % searchMatches.length;
    const match = searchMatches[searchIndex];
    setSelection(match.row, match.col, { focus: true, scroll: true });
    updateSearchHighlights();
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

  function applyHistory(entry, snapshot, layout) {
    const sheetIndex = model.sheets.findIndex((sheet) => sheet.name === entry.sheet);
    if (sheetIndex < 0) return false;
    active = sheetIndex;
    if (snapshot) restoreCellRange(XLSX, model, entry.sheet, entry.row, entry.col, snapshot);
    if (layout) restoreSheetLayout(model, entry.sheet, layout);
    scheduleSave();
    render();
    setSelection(entry.row, entry.col, { focus: true, scroll: true });
    refreshSearchAfterEdit();
    return true;
  }

  function undo() {
    document.activeElement?.blur?.();
    finalizeEditSession();
    const entry = undoStack.pop();
    if (!entry) return;
    if (applyHistory(entry, entry.before, entry.beforeLayout)) redoStack.push(entry);
    updateHistoryButtons();
  }

  function redo() {
    document.activeElement?.blur?.();
    finalizeEditSession();
    const entry = redoStack.pop();
    if (!entry) return;
    if (applyHistory(entry, entry.after, entry.afterLayout)) undoStack.push(entry);
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
      th.addEventListener("pointerdown", (event) => {
        if (event.button === 0) selectWholeColumn(col, event.shiftKey);
      });
      if (col < freeze.cols) {
        th.style.left = `${46 + col * 110}px`;
        th.style.zIndex = "5";
      }
      headRow.append(th);
    }
    head.append(headRow);
    grid.append(head);

    const body = document.createElement("tbody");
    for (let row = 0; row < rows; row++) {
      const tr = document.createElement("tr");
      if (worksheet["!rows"]?.[row]?.hidden) tr.hidden = true;
      const rowHead = document.createElement("th");
      rowHead.className = "row-head";
      rowHead.dataset.row = String(row);
      rowHead.textContent = String(row + 1);
      rowHead.addEventListener("pointerdown", (event) => {
        if (event.button === 0) selectWholeRow(row, event.shiftKey);
      });
      if (row < freeze.rows) {
        rowHead.style.top = `${28 + row * 28}px`;
        rowHead.style.zIndex = "4";
      }
      tr.append(rowHead);
      for (let col = 0; col < cols; col++) {
        if (mergeCovered.has(`${row}:${col}`)) continue;
        const td = document.createElement("td");
        td.contentEditable = "plaintext-only";
        td.tabIndex = 0;
        td.dataset.row = String(row);
        td.dataset.col = String(col);
        td.textContent = String(sheet.data[row]?.[col] ?? "");
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
          td.style.top = `${28 + row * 28}px`;
          td.style.zIndex = col < freeze.cols ? "6" : "3";
          if (!td.style.backgroundColor) td.style.backgroundColor = "var(--cell-bg)";
        }
        if (col < freeze.cols) {
          td.style.position = "sticky";
          td.style.left = `${46 + col * 110}px`;
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
              dirty: false
            };
          }
          const inputText = cellInputText(XLSX, model, sheet.name, row, col);
          if (inputText !== td.textContent) td.textContent = inputText;
          formulaInput.value = inputText;
        });
        td.addEventListener("input", () => {
          setCellText(XLSX, model, sheet.name, row, col, td.textContent ?? "");
          if (editSession) editSession.dirty = true;
          formulaInput.value = td.textContent ?? "";
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

  function exportWorkbook() {
    finalizeEditSession();
    const bytes = withCanonicalReadView(() => serializeWorkbookModel(XLSX, model));
    const url = URL.createObjectURL(new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }));
    const link = document.createElement("a");
    link.href = url;
    link.download = assetFileName.toLowerCase().endsWith(".xlsx") ? assetFileName : `${documentTitle}.xlsx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("已导出 .xlsx");
  }

  async function persist(force) {
    if (saveInFlight) {
      saveAgain = true;
      return;
    }
    saveInFlight = true;
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
        setStatus("保存冲突：思源附件已有新版本，本机修改已保留");
        overwriteConflict = confirm("思源附件已在其他页面或设备发生变化。确定用当前页面内容覆盖远端版本吗？");
      } else {
        setStatus(`保存失败（本机修改已保留）：${error instanceof Error ? error.message : String(error)}`);
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

  function pasteTable(text) {
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
    if (values.length < originalRows || values[0].length < originalCols) {
      alert(`粘贴内容超过 ${MAX_RENDER_ROWS} 行 × ${MAX_RENDER_COLS} 列限制，超出部分未写入`);
    }
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
  }

  function moveSelection(rowDelta, colDelta, extend = false) {
    finalizeEditSession();
    setSelection(selection.row + rowDelta, selection.col + colDelta, {
      extend,
      focus: true,
      scroll: true
    });
  }

  function handleGridKeydown(event) {
    const modifier = event.ctrlKey || event.metaKey;
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
    const arrows = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1]
    };
    const movement = arrows[event.key];
    if (movement && (!editSession?.dirty || modifier)) {
      event.preventDefault();
      moveSelection(movement[0], movement[1], event.shiftKey);
    }
  }

  function focusNewCell({ row, col }) {
    requestAnimationFrame(() => {
      const wrapper = document.querySelector(".grid-wrap");
      if (row != null) wrapper.scrollTop = wrapper.scrollHeight;
      if (col != null) wrapper.scrollLeft = wrapper.scrollWidth;
      const cell = grid.querySelector(
        `tbody tr:nth-child(${(row ?? 0) + 1}) td:nth-child(${(col ?? 0) + 2})`
      );
      cell?.focus();
    });
  }

  function addRow() {
    const sheet = model.sheets[active];
    const { rows, truncatedRows } = sheetDimensions(sheet);
    if (truncatedRows) {
      alert("该工作表已超过当前可视行数限制，超出区域会保留但请使用 Excel 编辑");
      return;
    }
    sheet.viewRows = rows + 1;
    scheduleSave();
    renderGrid();
    focusNewCell({ row: rows, col: 0 });
  }

  function addColumn() {
    const sheet = model.sheets[active];
    const { cols, truncatedCols } = sheetDimensions(sheet);
    if (truncatedCols) {
      alert("该工作表已超过当前可视列数限制，超出区域会保留但请使用 Excel 编辑");
      return;
    }
    sheet.viewCols = cols + 1;
    scheduleSave();
    renderGrid();
    focusNewCell({ row: 0, col: cols });
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

  document.querySelector("#add-row").addEventListener("click", addRow);
  document.querySelector("#add-col").addEventListener("click", addColumn);
  formulaInput.addEventListener("focus", () => {
    finalizeEditSession();
    formulaSession = { sheet: currentSheet().name, row: selection.row, col: selection.col };
  });
  formulaInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitFormulaBar();
    } else if (event.key === "Escape") {
      event.preventDefault();
      formulaSession = null;
      updateSelectionControls();
      cellLocator(selection.row, selection.col)?.focus();
    }
  });
  formulaInput.addEventListener("blur", commitFormulaBar);
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
  document.querySelector("#export").addEventListener("click", exportWorkbook);
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
    pasteTable(text);
  });
  window.addEventListener("pointerup", () => {
    draggingSelection = false;
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
  findInput.addEventListener("input", () => {
    collectSearchMatches(findInput.value);
    if (searchMatches.length) {
      const match = searchMatches[0];
      setSelection(match.row, match.col, { focus: false, scroll: true });
      updateSearchHighlights();
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
    searchPanel.hidden = false;
    document.querySelector("#search-toggle").classList.add("active");
    requestAnimationFrame(() => {
      findInput.focus({ preventScroll: true });
      findInput.select();
    });
  }

  function closeSearchPanel() {
    searchPanel.hidden = true;
    document.querySelector("#search-toggle").classList.remove("active");
    cellLocator(selection.row, selection.col)?.focus();
  }

  document.querySelector("#find-prev").addEventListener("click", () => findMatch(-1));
  document.querySelector("#find-next").addEventListener("click", () => findMatch(1));
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
    document.querySelectorAll(".tool-menu[open]").forEach((details) => {
      if (!details.contains(event.target)) details.open = false;
    });
  });
  document.addEventListener("keydown", (event) => {
    const modifier = event.ctrlKey || event.metaKey;
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
