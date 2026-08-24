import { SaveConflictError, SiyuanFileStore } from "./siyuan-file-store.js?v=__PLUGIN_VERSION__";
import {
  SHEET_RECOVERY_SCHEMA,
  addWorksheet,
  applyLegacyRecovery,
  applyRecoveryPayload,
  deleteWorksheet,
  makeRecoveryPayload,
  parseWorkbookModel,
  renameWorksheet,
  serializeWorkbookModel,
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
  let model;
  let active = 0;
  let saveTimer;
  let saveInFlight = false;
  let saveAgain = false;
  let sizeWarning = "";

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
        active = index;
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
        td.textContent = String(sheet.data[row]?.[col] ?? "");
        td.addEventListener("input", () => {
          setCellText(XLSX, model, sheet.name, row, col, td.textContent ?? "");
          scheduleSave();
        });
        tr.append(td);
      }
      body.append(tr);
    }
    grid.append(body);
  }

  function render() {
    renderTabs();
    renderGrid();
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
  document.querySelector("#rename").addEventListener("click", renameSheet);
  document.querySelector("#delete").addEventListener("click", () => {
    if (!confirm(`删除 ${model.sheets[active].name}？`)) return;
    try {
      deleteWorksheet(model, model.sheets[active].name);
      active = Math.max(0, active - 1);
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
    scheduleSave();
    render();
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
