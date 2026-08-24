import { SaveConflictError, SiyuanFileStore } from "./siyuan-file-store.js";

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

  const columnName = (index) => {
    let result = "";
    for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
    return result;
  };
  const setStatus = (text) => { status.textContent = text; };
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    try {
      store.cacheRecovery(model);
      setStatus("正在写入思源…");
    } catch (error) {
      console.error(error);
      setStatus("本机恢复缓存失败：数据过大");
    }
    saveTimer = setTimeout(() => void persist(false), 700);
  };
  const uniqueName = (base) => {
    let name = base, index = 2;
    while (model.sheets.some((sheet) => sheet.name === name)) name = `${base}${index++}`;
    return name;
  };
  const dimensions = (sheet) => ({
    rows: Math.min(500, Math.max(30, sheet.data.length)),
    cols: Math.min(50, Math.max(15, ...sheet.data.map((row) => row.length)))
  });
  function renderTabs() {
    tabs.querySelectorAll(".tab").forEach((element) => element.remove());
    model.sheets.forEach((sheet, index) => {
      const button = document.createElement("button"); button.className = `tab${index === active ? " active" : ""}`; button.textContent = sheet.name;
      button.addEventListener("click", () => { active = index; render(); });
      button.addEventListener("dblclick", () => renameSheet());
      tabs.insertBefore(button, addSheetButton);
    });
  }
  function renderGrid() {
    grid.replaceChildren();
    const sheet = model.sheets[active], { rows, cols } = dimensions(sheet);
    const head = document.createElement("thead"), headRow = document.createElement("tr"), corner = document.createElement("th"); corner.className = "row-head corner"; headRow.append(corner);
    for (let col = 0; col < cols; col++) { const th = document.createElement("th"); th.textContent = columnName(col); headRow.append(th); }
    head.append(headRow); grid.append(head);
    const body = document.createElement("tbody");
    for (let row = 0; row < rows; row++) {
      const tr = document.createElement("tr"), rowHead = document.createElement("th"); rowHead.className = "row-head"; rowHead.textContent = String(row + 1); tr.append(rowHead);
      for (let col = 0; col < cols; col++) {
        const td = document.createElement("td"); td.contentEditable = "plaintext-only"; td.textContent = String(sheet.data[row]?.[col] ?? "");
        td.addEventListener("input", () => { while (sheet.data.length <= row) sheet.data.push([]); sheet.data[row][col] = td.textContent ?? ""; scheduleSave(); });
        tr.append(td);
      }
      body.append(tr);
    }
    grid.append(body);
  }
  function render() { renderTabs(); renderGrid(); }
  function renameSheet() {
    const sheet = model.sheets[active]; const next = prompt("Sheet 名称", sheet.name)?.trim().slice(0, 31);
    if (!next || model.sheets.some((item, index) => index !== active && item.name === next)) return;
    sheet.name = next; scheduleSave(); renderTabs();
  }
  function createWorkbook() {
    const workbook = XLSX.utils.book_new();
    model.sheets.forEach((sheet) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.data), sheet.name));
    return workbook;
  }
  function serializeWorkbook() {
    return new Uint8Array(XLSX.write(createWorkbook(), { bookType: "xlsx", type: "array" }));
  }
  function exportWorkbook() {
    const workbook = createWorkbook();
    XLSX.writeFile(workbook, `${model.title || "工作簿"}.xlsx`); setStatus("已导出 .xlsx");
  }
  async function persist(force) {
    if (saveInFlight) {
      saveAgain = true;
      return;
    }
    saveInFlight = true;
    try {
      setStatus(force ? "正在覆盖写入思源…" : "正在写入思源…");
      await store.save(serializeWorkbook(), { force });
      setStatus(`已写入思源 ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      console.error(error);
      if (error instanceof SaveConflictError) {
        setStatus("保存冲突：思源附件已有新版本，本机修改已保留");
      } else {
        setStatus(`保存失败（本机修改已保留）：${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      saveInFlight = false;
      if (saveAgain) {
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
      const cell = grid.querySelector(`tbody tr:nth-child(${(row ?? 0) + 1}) td:nth-child(${(col ?? 0) + 2})`);
      cell?.focus();
    });
  }
  function addRow() {
    const sheet = model.sheets[active];
    const { rows } = dimensions(sheet);
    while (sheet.data.length < rows) sheet.data.push([]);
    sheet.data.push([]);
    scheduleSave(); renderGrid(); focusNewCell({ row: rows, col: 0 });
  }
  function addColumn() {
    const sheet = model.sheets[active];
    const { rows, cols } = dimensions(sheet);
    while (sheet.data.length < rows) sheet.data.push([]);
    sheet.data.forEach((row) => { while (row.length <= cols) row.push(""); });
    scheduleSave(); renderGrid(); focusNewCell({ row: 0, col: cols });
  }
  function parseWorkbook(bytes) {
    const workbook = XLSX.read(bytes, { type: "array", cellDates: true });
    return { title: decodeURIComponent(asset.split("/").pop() || "工作簿").replace(/-[0-9]{14}-[a-z0-9]+\.[^.]+$/i, ""), sheets: workbook.SheetNames.map((name) => ({ name, data: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: false, defval: "" }) })) };
  }
  async function load() {
    const remoteModel = parseWorkbook(await store.loadRemote());
    const recovery = store.readRecovery();
    if (!recovery) return { value: remoteModel, state: "remote" };
    if (recovery.legacy) {
      if (confirm("检测到旧版本保存在本机的 Excel 修改。是否立即写入思源附件并参与同步？")) {
        return { value: recovery.payload, state: "legacy-recovery" };
      }
      return { value: remoteModel, state: "legacy-kept" };
    }
    if (recovery.baseHash === store.baseHash) {
      return { value: recovery.payload, state: "recovery" };
    }
    store.conflicted = true;
    return { value: recovery.payload, state: "conflict" };
  }
  document.querySelector("#add-row").addEventListener("click", addRow);
  document.querySelector("#add-col").addEventListener("click", addColumn);
  document.querySelector("#rename").addEventListener("click", renameSheet);
  document.querySelector("#delete").addEventListener("click", () => { if (model.sheets.length === 1) return alert("至少保留一个 Sheet"); if (confirm(`删除 ${model.sheets[active].name}？`)) { model.sheets.splice(active, 1); active = Math.max(0, active - 1); scheduleSave(); render(); } });
  document.querySelector("#save").addEventListener("click", () => {
    if (store.conflicted) {
      if (confirm("思源附件已在其他页面或设备发生变化。确定用当前页面内容覆盖远端版本吗？")) void persist(true);
    } else {
      void persist(false);
    }
  });
  document.querySelector("#export").addEventListener("click", exportWorkbook);
  addSheetButton.addEventListener("click", () => { model.sheets.push({ name: uniqueName("Sheet"), data: [[""]] }); active = model.sheets.length - 1; scheduleSave(); render(); });
  load().then(({ value, state }) => {
    model = value;
    if (!model.sheets.length) model.sheets = [{ name: "Sheet1", data: [[""]] }];
    render();
    if (state === "conflict") {
      setStatus("检测到跨设备保存冲突：当前显示本机恢复内容，尚未覆盖思源");
    } else if (state === "legacy-kept") {
      setStatus("已读取思源附件；旧版本机缓存仍保留");
    } else if (state === "legacy-recovery" || state === "recovery") {
      setStatus("检测到未写入的本机修改，正在恢复到思源…");
      scheduleSave();
    } else {
      setStatus("可编辑 · 修改将自动写入思源");
    }
  }).catch((error) => { console.error(error); setStatus(error.message || String(error)); });
})();
