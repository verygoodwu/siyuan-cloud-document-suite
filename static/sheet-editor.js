import { SaveConflictError, SiyuanFileStore } from "./siyuan-file-store.js?v=__PLUGIN_VERSION__";
import {
  MAX_RENDER_COLS,
  MAX_RENDER_ROWS,
  SHEET_RECOVERY_SCHEMA,
  addWorksheet,
  applyLegacyRecovery,
  applyRecoveryPayload,
  captureCellRange,
  cellInputText,
  cellRangeToTsv,
  deleteWorksheet,
  makeRecoveryPayload,
  parseClipboardTable,
  parseWorkbookModel,
  renameWorksheet,
  restoreCellRange,
  serializeWorkbookModel,
  setCellRange,
  setCellText,
  sheetDimensions
} from "./sheet-workbook.js?v=__PLUGIN_VERSION__";

(() => {
  const asset = new URLSearchParams(location.search).get("asset");
  const storageKey = `siyuan-sheet-editor:${asset}`;
  const store = new SiyuanFileStore(asset, storageKey);
  const grid = document.querySelector("#grid");
  const tabs = document.querySelector("#tabs");
  const addSheetButton = document.querySelector("#add-sheet");
  const status = document.querySelector("#status");
  const undoButton = document.querySelector("#undo");
  const redoButton = document.querySelector("#redo");
  const findInput = document.querySelector("#find");
  const findCount = document.querySelector("#find-count");
  let model;
  let active = 0;
  let saveTimer;
  let saveInFlight = false;
  let saveAgain = false;
  let sizeWarning = "";
  let selection = { anchorRow: 0, anchorCol: 0, row: 0, col: 0 };
  let draggingSelection = false;
  let editSession = null;
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

  function updateHistoryButtons() {
    undoButton.disabled = undoStack.length === 0;
    redoButton.disabled = redoStack.length === 0;
  }

  function snapshotsEqual(first, second) {
    return JSON.stringify(first) === JSON.stringify(second);
  }

  function pushHistory(entry) {
    if (snapshotsEqual(entry.before, entry.after)) return;
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
  }

  function setSelection(row, col, { extend = false, focus = false, scroll = false } = {}) {
    const sheet = currentSheet();
    if (!sheet) return;
    const { rows, cols } = sheetDimensions(sheet);
    const nextRow = Math.max(0, Math.min(rows - 1, row));
    const nextCol = Math.max(0, Math.min(cols - 1, col));
    if (!extend) {
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

  function applyHistory(entry, snapshot) {
    const sheetIndex = model.sheets.findIndex((sheet) => sheet.name === entry.sheet);
    if (sheetIndex < 0) return false;
    active = sheetIndex;
    restoreCellRange(XLSX, model, entry.sheet, entry.row, entry.col, snapshot);
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
    if (applyHistory(entry, entry.before)) redoStack.push(entry);
    updateHistoryButtons();
  }

  function redo() {
    document.activeElement?.blur?.();
    finalizeEditSession();
    const entry = redoStack.pop();
    if (!entry) return;
    if (applyHistory(entry, entry.after)) undoStack.push(entry);
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
        selection = { anchorRow: 0, anchorCol: 0, row: 0, col: 0 };
        collectSearchMatches(findInput.value);
        render();
      });
      button.addEventListener("dblclick", () => renameSheet());
      tabs.insertBefore(button, addSheetButton);
    });
  }

  function renderGrid() {
    grid.replaceChildren();
    const sheet = model.sheets[active];
    const { rows, cols, truncatedRows, truncatedCols } = sheetDimensions(sheet);
    sizeWarning = truncatedRows || truncatedCols
      ? `为保证性能仅显示前 ${rows} 行 × ${cols} 列，未显示区域仍会原样保留`
      : "";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    const corner = document.createElement("th");
    corner.className = "row-head corner";
    headRow.append(corner);
    for (let col = 0; col < cols; col++) {
      const th = document.createElement("th");
      th.textContent = columnName(col);
      headRow.append(th);
    }
    head.append(headRow);
    grid.append(head);

    const body = document.createElement("tbody");
    for (let row = 0; row < rows; row++) {
      const tr = document.createElement("tr");
      const rowHead = document.createElement("th");
      rowHead.className = "row-head";
      rowHead.textContent = String(row + 1);
      tr.append(rowHead);
      for (let col = 0; col < cols; col++) {
        const td = document.createElement("td");
        td.contentEditable = "plaintext-only";
        td.dataset.row = String(row);
        td.dataset.col = String(col);
        td.textContent = String(sheet.data[row]?.[col] ?? "");
        const address = XLSX.utils.encode_cell({ r: row, c: col });
        if (typeof model.workbook.Sheets[sheet.name]?.[address]?.f === "string") td.dataset.formula = "true";
        td.addEventListener("pointerdown", (event) => {
          if (event.button !== 0) return;
          draggingSelection = true;
          setSelection(row, col, { extend: event.shiftKey, focus: true });
        });
        td.addEventListener("pointerenter", (event) => {
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
        });
        td.addEventListener("input", () => {
          setCellText(XLSX, model, sheet.name, row, col, td.textContent ?? "");
          if (editSession) editSession.dirty = true;
          const editedCell = model.workbook.Sheets[sheet.name]?.[address];
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
        });
        tr.append(td);
      }
      body.append(tr);
    }
    grid.append(body);
    paintSelection();
    updateSearchHighlights();
  }

  function render() {
    renderTabs();
    renderGrid();
    updateHistoryButtons();
    setStatus("可编辑 · 修改将自动写入思源");
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
    XLSX.writeFile(model.workbook, `${model.title || "工作簿"}.xlsx`, {
      bookType: "xlsx",
      cellStyles: true,
      bookVBA: true,
      compression: true
    });
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
      const saved = await store.save(serializeWorkbookModel(XLSX, model), { force });
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
    if (event.key === "Delete") {
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
  undoButton.addEventListener("click", undo);
  redoButton.addEventListener("click", redo);
  document.querySelector("#rename").addEventListener("click", renameSheet);
  document.querySelector("#delete").addEventListener("click", () => {
    if (!confirm(`删除 ${model.sheets[active].name}？`)) return;
    try {
      deleteWorksheet(model, model.sheets[active].name);
      active = Math.max(0, active - 1);
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
    const name = uniqueName("Sheet");
    addWorksheet(XLSX, model, name);
    active = model.sheets.length - 1;
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
      cellLocator(selection.row, selection.col)?.focus();
    }
  });
  document.querySelector("#find-prev").addEventListener("click", () => findMatch(-1));
  document.querySelector("#find-next").addEventListener("click", () => findMatch(1));
  document.addEventListener("keydown", (event) => {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === "f") {
      event.preventDefault();
      findInput.focus();
      findInput.select();
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
      setStatus("可编辑 · 修改将自动写入思源");
    }
  }).catch((error) => {
    console.error(error);
    setStatus(error instanceof Error ? error.message : String(error));
  });
})();
