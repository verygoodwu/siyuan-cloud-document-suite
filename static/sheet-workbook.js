export const SHEET_RECOVERY_SCHEMA = "siyuan-sheet-recovery-v2";
export const MAX_RENDER_ROWS = 500;
export const MAX_RENDER_COLS = 50;

function safeTitleFromAsset(asset) {
  const filename = String(asset || "").split("/").pop() || "工作簿.xlsx";
  return filename
    .replace(/-[0-9]{14}-[a-z0-9]+\.[^.]+$/i, "")
    .replace(/\.xlsx$/i, "") || "工作簿";
}

function sheetView(XLSX, name, worksheet) {
  const data = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: ""
  });
  const range = worksheet["!ref"]
    ? XLSX.utils.decode_range(worksheet["!ref"])
    : { e: { r: 0, c: 0 } };
  return {
    name,
    data,
    viewRows: Math.max(30, data.length, range.e.r + 1),
    viewCols: Math.max(15, range.e.c + 1, ...data.map((row) => row.length))
  };
}

function ensureDataCell(sheet, row, col, value) {
  while (sheet.data.length <= row) sheet.data.push([]);
  while (sheet.data[row].length <= col) sheet.data[row].push("");
  sheet.data[row][col] = value;
  sheet.viewRows = Math.max(sheet.viewRows, row + 1);
  sheet.viewCols = Math.max(sheet.viewCols, col + 1);
}

function expandWorksheetRange(XLSX, worksheet, row, col) {
  const range = worksheet["!ref"]
    ? XLSX.utils.decode_range(worksheet["!ref"])
    : { s: { r: row, c: col }, e: { r: row, c: col } };
  range.s.r = Math.min(range.s.r, row);
  range.s.c = Math.min(range.s.c, col);
  range.e.r = Math.max(range.e.r, row);
  range.e.c = Math.max(range.e.c, col);
  worksheet["!ref"] = XLSX.utils.encode_range(range);
}

function record(model, operation, enabled) {
  if (enabled) model.operations.push(operation);
}

function worksheetFor(model, name) {
  const worksheet = model.workbook.Sheets[name];
  if (!worksheet) throw new Error(`找不到 Sheet：${name}`);
  return worksheet;
}

export function parseWorkbookModel(XLSX, bytes, asset) {
  if (!/\.xlsx$/i.test(String(asset || "").split("?")[0])) {
    throw new Error("为防止格式损坏，当前仅允许编辑 .xlsx 工作簿");
  }
  const workbook = XLSX.read(bytes, {
    type: "array",
    cellDates: true,
    cellFormula: true,
    cellNF: true,
    cellStyles: true,
    sheetStubs: true,
    bookVBA: true
  });
  return {
    title: safeTitleFromAsset(asset),
    workbook,
    sheets: workbook.SheetNames.map((name) => sheetView(XLSX, name, workbook.Sheets[name])),
    operations: []
  };
}

export function serializeWorkbookModel(XLSX, model) {
  return new Uint8Array(XLSX.write(model.workbook, {
    bookType: "xlsx",
    type: "array",
    cellStyles: true,
    bookVBA: true,
    compression: true
  }));
}

export function sheetDimensions(sheet) {
  const rows = Math.min(MAX_RENDER_ROWS, Math.max(30, sheet.viewRows, sheet.data.length));
  const cols = Math.min(
    MAX_RENDER_COLS,
    Math.max(15, sheet.viewCols, ...sheet.data.map((row) => row.length))
  );
  return {
    rows,
    cols,
    truncatedRows: sheet.viewRows > MAX_RENDER_ROWS || sheet.data.length > MAX_RENDER_ROWS,
    truncatedCols: sheet.viewCols > MAX_RENDER_COLS || sheet.data.some((row) => row.length > MAX_RENDER_COLS)
  };
}

export function setCellText(XLSX, model, sheetName, row, col, value, shouldRecord = true) {
  const sheet = model.sheets.find((item) => item.name === sheetName);
  if (!sheet) throw new Error(`找不到 Sheet：${sheetName}`);
  const worksheet = worksheetFor(model, sheetName);
  const address = XLSX.utils.encode_cell({ r: row, c: col });
  const existing = worksheet[address];
  const next = existing ? { ...existing } : {};
  for (const key of ["f", "F", "D", "w", "r", "h"]) delete next[key];
  next.t = "s";
  next.v = String(value);
  worksheet[address] = next;
  expandWorksheetRange(XLSX, worksheet, row, col);
  ensureDataCell(sheet, row, col, String(value));
  record(model, { type: "setCell", sheet: sheetName, row, col, value: String(value) }, shouldRecord);
}

export function addWorksheet(XLSX, model, name, shouldRecord = true) {
  if (model.workbook.SheetNames.includes(name)) throw new Error(`Sheet 已存在：${name}`);
  const worksheet = XLSX.utils.aoa_to_sheet([[""]]);
  XLSX.utils.book_append_sheet(model.workbook, worksheet, name);
  model.sheets.push(sheetView(XLSX, name, worksheet));
  record(model, { type: "addSheet", name }, shouldRecord);
}

function replaceSheetReferences(model, oldName, newName) {
  const quotedOld = `'${oldName.replace(/'/g, "''")}'!`;
  const quotedNew = `'${newName.replace(/'/g, "''")}'!`;
  const plainSafe = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(oldName);
  const plainPattern = plainSafe
    ? new RegExp(`(^|[^A-Za-z0-9_.'])${oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}!`, "g")
    : null;
  const plainReplacement = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(newName)
    ? newName
    : `'${newName.replace(/'/g, "''")}'`;
  const update = (formula) => {
    let next = String(formula).split(quotedOld).join(quotedNew);
    if (plainPattern) next = next.replace(plainPattern, `$1${plainReplacement}!`);
    return next;
  };
  for (const worksheet of Object.values(model.workbook.Sheets)) {
    for (const cell of Object.values(worksheet)) {
      if (cell && typeof cell === "object" && typeof cell.f === "string") {
        cell.f = update(cell.f);
      }
    }
  }
  for (const name of model.workbook.Workbook?.Names || []) {
    if (typeof name.Ref === "string") name.Ref = update(name.Ref);
  }
}

export function renameWorksheet(model, oldName, newName, shouldRecord = true) {
  if (oldName === newName) return;
  if (model.workbook.SheetNames.some((name) => name.toLowerCase() === newName.toLowerCase())) {
    throw new Error(`Sheet 已存在：${newName}`);
  }
  const index = model.workbook.SheetNames.indexOf(oldName);
  if (index < 0) throw new Error(`找不到 Sheet：${oldName}`);
  const worksheet = worksheetFor(model, oldName);
  model.workbook.SheetNames[index] = newName;
  delete model.workbook.Sheets[oldName];
  model.workbook.Sheets[newName] = worksheet;
  const sheet = model.sheets.find((item) => item.name === oldName);
  if (sheet) sheet.name = newName;
  if (model.workbook.Workbook?.Sheets?.[index]) {
    model.workbook.Workbook.Sheets[index].name = newName;
  }
  replaceSheetReferences(model, oldName, newName);
  record(model, { type: "renameSheet", oldName, newName }, shouldRecord);
}

export function deleteWorksheet(model, name, shouldRecord = true) {
  if (model.workbook.SheetNames.length <= 1) throw new Error("至少保留一个 Sheet");
  const index = model.workbook.SheetNames.indexOf(name);
  if (index < 0) throw new Error(`找不到 Sheet：${name}`);
  model.workbook.SheetNames.splice(index, 1);
  delete model.workbook.Sheets[name];
  model.sheets.splice(model.sheets.findIndex((item) => item.name === name), 1);
  if (model.workbook.Workbook?.Sheets) model.workbook.Workbook.Sheets.splice(index, 1);
  record(model, { type: "deleteSheet", name }, shouldRecord);
}

export function makeRecoveryPayload(model) {
  return {
    schema: SHEET_RECOVERY_SCHEMA,
    operations: model.operations,
    views: Object.fromEntries(model.sheets.map((sheet) => [sheet.name, {
      rows: sheet.viewRows,
      cols: sheet.viewCols
    }]))
  };
}

export function applyRecoveryPayload(XLSX, model, payload) {
  if (payload?.schema !== SHEET_RECOVERY_SCHEMA || !Array.isArray(payload.operations)) {
    throw new Error("无法识别表格恢复数据");
  }
  for (const operation of payload.operations) {
    if (operation?.type === "setCell") {
      setCellText(XLSX, model, operation.sheet, operation.row, operation.col, operation.value, false);
    } else if (operation?.type === "addSheet") {
      addWorksheet(XLSX, model, operation.name, false);
    } else if (operation?.type === "renameSheet") {
      renameWorksheet(model, operation.oldName, operation.newName, false);
    } else if (operation?.type === "deleteSheet") {
      deleteWorksheet(model, operation.name, false);
    }
  }
  for (const sheet of model.sheets) {
    const view = payload.views?.[sheet.name];
    if (view) {
      sheet.viewRows = Math.max(sheet.viewRows, Number(view.rows) || 0);
      sheet.viewCols = Math.max(sheet.viewCols, Number(view.cols) || 0);
    }
  }
  model.operations = payload.operations.map((operation) => ({ ...operation }));
  return model;
}

export function applyLegacyRecovery(XLSX, model, payload) {
  if (!Array.isArray(payload?.sheets)) throw new Error("旧版表格恢复数据无效");
  const workbook = XLSX.utils.book_new();
  for (const sheet of payload.sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.data || [[""]]), sheet.name);
  }
  model.workbook = workbook;
  model.sheets = workbook.SheetNames.map((name) => sheetView(XLSX, name, workbook.Sheets[name]));
  model.operations = [];
  return model;
}
