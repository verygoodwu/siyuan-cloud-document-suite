export const SHEET_RECOVERY_SCHEMA = "siyuan-sheet-recovery-v2";
export const MAX_RENDER_ROWS = 500;
export const MAX_RENDER_COLS = 50;
const SUITE_STATE_PROPERTY = "SiyuanCloudSheetState";

function safeTitleFromAsset(asset) {
  const filename = String(asset || "").split("/").pop() || "工作簿.xlsx";
  return filename
    .replace(/-[0-9]{14}-[a-z0-9]+\.[^.]+$/i, "")
    .replace(/\.xlsx$/i, "") || "工作簿";
}

function sheetView(XLSX, name, worksheet, features = {}) {
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
    viewCols: Math.max(15, range.e.c + 1, ...data.map((row) => row.length)),
    freeze: features.freeze || { rows: 0, cols: 0 },
    filter: features.filter || null,
    charts: Array.isArray(features.charts) ? features.charts : []
  };
}

function readSuiteState(workbook) {
  try {
    const raw = workbook.Custprops?.[SUITE_STATE_PROPERTY];
    const source = String(raw || "");
    const decoded = source.startsWith("v1:") ? decodeURIComponent(source.slice(3)) : source;
    const parsed = decoded ? JSON.parse(decoded) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function syncSuiteState(model) {
  model.workbook.Custprops ||= {};
  const state = JSON.stringify(Object.fromEntries(
    model.sheets.map((sheet) => [sheet.name, {
      freeze: sheet.freeze || { rows: 0, cols: 0 },
      filter: sheet.filter || null,
      charts: Array.isArray(sheet.charts) ? sheet.charts : []
    }])
  ));
  model.workbook.Custprops[SUITE_STATE_PROPERTY] = `v1:${encodeURIComponent(state)}`;
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

function cloneCell(cell) {
  if (cell == null) return null;
  const copy = typeof globalThis.structuredClone === "function"
    ? globalThis.structuredClone(cell)
    : JSON.parse(JSON.stringify(cell));
  if (copy.t === "d" && typeof copy.v === "string") {
    const date = new Date(copy.v);
    if (!Number.isNaN(date.valueOf())) copy.v = date;
  }
  return copy;
}

function cellDisplayText(XLSX, cell) {
  if (!cell) return "";
  try {
    return String(XLSX.utils.format_cell(cell) ?? "");
  } catch {
    return String(cell.w ?? cell.v ?? "");
  }
}

function formulaFromInput(value) {
  const source = String(value ?? "").trim();
  if (source.startsWith("=")) return source.slice(1).trim();
  if (/\$?[A-Za-z]{1,3}\$?\d+\s*[+\-*/^]/.test(source)) return source;
  if (/^(?:SUM|AVERAGE|MIN|MAX|COUNT|ROUND|ABS|IF)\s*\(/i.test(source)) return source;
  return null;
}

function tokenizeFormula(formula) {
  const tokens = [];
  let index = 0;
  while (index < formula.length) {
    if (/\s/.test(formula[index])) {
      index++;
      continue;
    }
    const rest = formula.slice(index);
    const match = /^(\$?[A-Za-z]{1,3}\$?\d+|(?:\d+\.?\d*|\.\d+)(?:[eE][+\-]?\d+)?|[A-Za-z_][A-Za-z0-9_.]*|<=|>=|<>|[(),:+\-*/^=<>])/.exec(rest);
    if (!match) return null;
    tokens.push(match[1]);
    index += match[1].length;
  }
  return tokens;
}

function evaluateSimpleFormula(XLSX, worksheet, formula, evaluating) {
  const tokens = tokenizeFormula(formula);
  if (!tokens?.length) return { supported: false };
  let position = 0;
  const unsupported = () => {
    const error = new Error("unsupported");
    error.unsupported = true;
    throw error;
  };
  const scalar = (value) => {
    if (Array.isArray(value)) throw new Error("#VALUE!");
    return value;
  };
  const cellNumber = (reference, ignoreText = false) => {
    const address = reference.replace(/\$/g, "").toUpperCase();
    const cell = worksheet[address];
    if (!cell) return ignoreText ? null : 0;
    if (typeof cell.f === "string") {
      if (evaluating.has(address)) throw new Error("#CYCLE!");
      evaluating.add(address);
      const nested = evaluateSimpleFormula(XLSX, worksheet, cell.f, evaluating);
      evaluating.delete(address);
      if (!nested.supported) {
        const cached = Number(cell.v);
        if (Number.isFinite(cached)) return cached;
        throw new Error("#VALUE!");
      }
      if (nested.error) throw new Error(nested.error);
      return nested.value;
    }
    if (cell.v === "" || cell.v == null) return ignoreText ? null : 0;
    const number = Number(cell.v);
    if (!Number.isFinite(number)) {
      if (ignoreText) return null;
      throw new Error("#VALUE!");
    }
    return number;
  };
  const rangeNumbers = (start, end) => {
    const first = XLSX.utils.decode_cell(start.replace(/\$/g, "").toUpperCase());
    const last = XLSX.utils.decode_cell(end.replace(/\$/g, "").toUpperCase());
    const values = [];
    for (let row = Math.min(first.r, last.r); row <= Math.max(first.r, last.r); row++) {
      for (let col = Math.min(first.c, last.c); col <= Math.max(first.c, last.c); col++) {
        values.push(cellNumber(XLSX.utils.encode_cell({ r: row, c: col }), true));
      }
    }
    return values;
  };
  const callFunction = (name, args) => {
    const values = args.flat(Infinity).filter((value) => value != null).map(Number);
    switch (name.toUpperCase()) {
      case "SUM": return values.reduce((sum, value) => sum + value, 0);
      case "AVERAGE":
        if (!values.length) throw new Error("#DIV/0!");
        return values.reduce((sum, value) => sum + value, 0) / values.length;
      case "MIN": return values.length ? Math.min(...values) : 0;
      case "MAX": return values.length ? Math.max(...values) : 0;
      case "COUNT": return values.filter(Number.isFinite).length;
      case "ROUND": {
        const value = scalar(args[0]);
        const digits = Number(scalar(args[1] ?? 0));
        const factor = 10 ** digits;
        return Math.round((value + Number.EPSILON) * factor) / factor;
      }
      case "ABS": return Math.abs(scalar(args[0]));
      case "IF": return scalar(args[0]) ? scalar(args[1] ?? 0) : scalar(args[2] ?? 0);
      default: return unsupported();
    }
  };
  const primary = () => {
    const token = tokens[position++];
    if (token === "(") {
      const value = comparison();
      if (tokens[position++] !== ")") throw new Error("#VALUE!");
      return value;
    }
    if (/^\$?[A-Za-z]{1,3}\$?\d+$/.test(token || "")) {
      if (tokens[position] === ":") {
        position++;
        const end = tokens[position++];
        if (!/^\$?[A-Za-z]{1,3}\$?\d+$/.test(end || "")) throw new Error("#REF!");
        return rangeNumbers(token, end);
      }
      return cellNumber(token);
    }
    if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(token || "") && tokens[position] === "(") {
      position++;
      const args = [];
      if (tokens[position] !== ")") {
        do {
          const isRange = /^\$?[A-Za-z]{1,3}\$?\d+$/.test(tokens[position] || "") && tokens[position + 1] === ":";
          args.push(isRange ? primary() : comparison());
          if (tokens[position] !== ",") break;
          position++;
        } while (position < tokens.length);
      }
      if (tokens[position++] !== ")") throw new Error("#VALUE!");
      return callFunction(token, args);
    }
    const number = Number(token);
    if (!Number.isFinite(number)) throw new Error("#VALUE!");
    return number;
  };
  const unary = () => {
    if (tokens[position] === "+") {
      position++;
      return unary();
    }
    if (tokens[position] === "-") {
      position++;
      return -scalar(unary());
    }
    return primary();
  };
  const power = () => {
    let value = scalar(unary());
    if (tokens[position] === "^") {
      position++;
      value **= scalar(power());
    }
    return value;
  };
  const term = () => {
    let value = scalar(power());
    while (tokens[position] === "*" || tokens[position] === "/") {
      const operator = tokens[position++];
      const right = scalar(power());
      if (operator === "/" && right === 0) throw new Error("#DIV/0!");
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  };
  const expression = () => {
    let value = scalar(term());
    while (tokens[position] === "+" || tokens[position] === "-") {
      const operator = tokens[position++];
      const right = scalar(term());
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };
  const comparison = () => {
    const left = scalar(expression());
    const operator = tokens[position];
    if (!["=", "<>", "<", ">", "<=", ">="].includes(operator)) return left;
    position++;
    const right = scalar(expression());
    if (operator === "=") return Number(left === right);
    if (operator === "<>") return Number(left !== right);
    if (operator === "<") return Number(left < right);
    if (operator === ">") return Number(left > right);
    if (operator === "<=") return Number(left <= right);
    return Number(left >= right);
  };
  try {
    const value = scalar(comparison());
    if (position !== tokens.length || !Number.isFinite(value)) return { supported: false };
    return { supported: true, value };
  } catch (error) {
    if (error?.unsupported) return { supported: false };
    return { supported: true, error: error instanceof Error ? error.message : "#VALUE!" };
  }
}

export function recalculateWorkbookFormulas(XLSX, model) {
  for (const sheet of model.sheets) {
    const worksheet = worksheetFor(model, sheet.name);
    for (const [address, cell] of Object.entries(worksheet)) {
      if (!cell || typeof cell !== "object" || typeof cell.f !== "string") continue;
      const result = evaluateSimpleFormula(XLSX, worksheet, cell.f, new Set([address]));
      if (!result.supported) continue;
      delete cell.w;
      if (result.error) {
        cell.t = "s";
        cell.v = result.error;
      } else {
        cell.t = "n";
        cell.v = result.value;
      }
      const position = XLSX.utils.decode_cell(address);
      ensureDataCell(sheet, position.r, position.c, cellDisplayText(XLSX, cell));
    }
  }
}

export function cellInputText(XLSX, model, sheetName, row, col) {
  const worksheet = worksheetFor(model, sheetName);
  const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: col })];
  return typeof cell?.f === "string" ? `=${cell.f}` : cellDisplayText(XLSX, cell);
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
  const suiteState = readSuiteState(workbook);
  const model = {
    title: safeTitleFromAsset(asset),
    workbook,
    sheets: workbook.SheetNames.map((name) => sheetView(XLSX, name, workbook.Sheets[name], suiteState[name])),
    operations: []
  };
  recalculateWorkbookFormulas(XLSX, model);
  return model;
}

export function serializeWorkbookModel(XLSX, model) {
  syncSuiteState(model);
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

export function setCellText(XLSX, model, sheetName, row, col, value, shouldRecord = true, shouldRecalculate = true) {
  const sheet = model.sheets.find((item) => item.name === sheetName);
  if (!sheet) throw new Error(`找不到 Sheet：${sheetName}`);
  const worksheet = worksheetFor(model, sheetName);
  const address = XLSX.utils.encode_cell({ r: row, c: col });
  const existing = worksheet[address];
  const next = existing ? { ...existing } : {};
  for (const key of ["f", "F", "D", "w", "r", "h"]) delete next[key];
  const formula = formulaFromInput(value);
  if (formula != null) {
    next.f = formula;
    next.t = "s";
    next.v = "#暂不支持";
  } else {
    next.t = "s";
    next.v = String(value);
  }
  worksheet[address] = next;
  expandWorksheetRange(XLSX, worksheet, row, col);
  ensureDataCell(sheet, row, col, formula == null ? String(value) : "#暂不支持");
  if (shouldRecalculate) recalculateWorkbookFormulas(XLSX, model);
  record(model, { type: "setCell", sheet: sheetName, row, col, value: String(value) }, shouldRecord);
}

export function captureCellRange(XLSX, model, sheetName, startRow, startCol, rowCount, colCount) {
  const worksheet = worksheetFor(model, sheetName);
  return Array.from({ length: rowCount }, (_, rowOffset) =>
    Array.from({ length: colCount }, (_, colOffset) => {
      const address = XLSX.utils.encode_cell({
        r: startRow + rowOffset,
        c: startCol + colOffset
      });
      return cloneCell(worksheet[address]);
    })
  );
}

export function setCellRange(XLSX, model, sheetName, startRow, startCol, values, shouldRecord = true) {
  const normalized = values.map((row) => row.map((value) => String(value ?? "")));
  for (let rowOffset = 0; rowOffset < normalized.length; rowOffset++) {
    for (let colOffset = 0; colOffset < normalized[rowOffset].length; colOffset++) {
      setCellText(
        XLSX,
        model,
        sheetName,
        startRow + rowOffset,
        startCol + colOffset,
        normalized[rowOffset][colOffset],
        false,
        false
      );
    }
  }
  recalculateWorkbookFormulas(XLSX, model);
  record(model, {
    type: "setRange",
    sheet: sheetName,
    row: startRow,
    col: startCol,
    values: normalized
  }, shouldRecord);
}

export function restoreCellRange(XLSX, model, sheetName, startRow, startCol, cells, shouldRecord = true) {
  const sheet = model.sheets.find((item) => item.name === sheetName);
  if (!sheet) throw new Error(`找不到 Sheet：${sheetName}`);
  const worksheet = worksheetFor(model, sheetName);
  const snapshot = cells.map((row) => row.map((cell) => cloneCell(cell)));
  for (let rowOffset = 0; rowOffset < snapshot.length; rowOffset++) {
    for (let colOffset = 0; colOffset < snapshot[rowOffset].length; colOffset++) {
      const row = startRow + rowOffset;
      const col = startCol + colOffset;
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = snapshot[rowOffset][colOffset];
      if (cell == null) delete worksheet[address];
      else worksheet[address] = cloneCell(cell);
      ensureDataCell(sheet, row, col, cellDisplayText(XLSX, cell));
      if (cell != null) expandWorksheetRange(XLSX, worksheet, row, col);
    }
  }
  recalculateWorkbookFormulas(XLSX, model);
  record(model, {
    type: "restoreRange",
    sheet: sheetName,
    row: startRow,
    col: startCol,
    cells: snapshot
  }, shouldRecord);
}

export function parseClipboardTable(text) {
  const normalized = String(text ?? "").replace(/\r\n?/g, "\n");
  const rows = normalized.split("\n").map((row) => row.split("\t"));
  if (rows.length > 1 && rows.at(-1).every((value) => value === "")) rows.pop();
  const width = Math.max(1, ...rows.map((row) => row.length));
  return rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ""));
}

export function cellRangeToTsv(XLSX, model, sheetName, startRow, startCol, rowCount, colCount) {
  const worksheet = worksheetFor(model, sheetName);
  return Array.from({ length: rowCount }, (_, rowOffset) =>
    Array.from({ length: colCount }, (_, colOffset) => {
      const address = XLSX.utils.encode_cell({
        r: startRow + rowOffset,
        c: startCol + colOffset
      });
      return cellDisplayText(XLSX, worksheet[address]);
    }).join("\t")
  ).join("\n");
}

function normalizedRange(startRow, startCol, endRow, endCol) {
  return {
    s: { r: Math.min(startRow, endRow), c: Math.min(startCol, endCol) },
    e: { r: Math.max(startRow, endRow), c: Math.max(startCol, endCol) }
  };
}

function rangesOverlap(first, second) {
  return first.s.r <= second.e.r && first.e.r >= second.s.r &&
    first.s.c <= second.e.c && first.e.c >= second.s.c;
}

function refreshSheetRange(XLSX, model, sheetName, range) {
  const sheet = model.sheets.find((item) => item.name === sheetName);
  const worksheet = worksheetFor(model, sheetName);
  if (!sheet) return;
  for (let row = range.s.r; row <= range.e.r; row++) {
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: col })];
      ensureDataCell(sheet, row, col, cellDisplayText(XLSX, cell));
    }
  }
}

export function captureSheetLayout(model, sheetName) {
  const sheet = model.sheets.find((item) => item.name === sheetName);
  const worksheet = worksheetFor(model, sheetName);
  if (!sheet) throw new Error(`找不到 Sheet：${sheetName}`);
  return {
    merges: (worksheet["!merges"] || []).map((range) => structuredClone(range)),
    rows: (worksheet["!rows"] || []).map((row) => row ? { ...row } : null),
    freeze: structuredClone(sheet.freeze || { rows: 0, cols: 0 }),
    filter: sheet.filter ? structuredClone(sheet.filter) : null,
    charts: structuredClone(sheet.charts || [])
  };
}

export function restoreSheetLayout(model, sheetName, layout, shouldRecord = true) {
  const sheet = model.sheets.find((item) => item.name === sheetName);
  const worksheet = worksheetFor(model, sheetName);
  if (!sheet) throw new Error(`找不到 Sheet：${sheetName}`);
  worksheet["!merges"] = (layout?.merges || []).map((range) => structuredClone(range));
  worksheet["!rows"] = (layout?.rows || []).map((row) => row ? { ...row } : undefined);
  sheet.freeze = structuredClone(layout?.freeze || { rows: 0, cols: 0 });
  sheet.filter = layout?.filter ? structuredClone(layout.filter) : null;
  sheet.charts = structuredClone(layout?.charts || []);
  record(model, { type: "restoreLayout", sheet: sheetName, layout: structuredClone(layout) }, shouldRecord);
}

function cssColor(color) {
  const rgb = String(color?.rgb || "").replace(/^FF/i, "");
  return /^[0-9a-f]{6}$/i.test(rgb) ? `#${rgb}` : "";
}

export function cellPresentation(XLSX, model, sheetName, row, col) {
  const worksheet = worksheetFor(model, sheetName);
  const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: col })];
  const style = cell?.s || {};
  return {
    text: cellDisplayText(XLSX, cell),
    bold: Boolean(style.font?.bold),
    italic: Boolean(style.font?.italic),
    underline: Boolean(style.font?.underline),
    textColor: cssColor(style.font?.color),
    fillColor: cssColor(style.fill?.fgColor),
    horizontal: style.alignment?.horizontal || "",
    vertical: style.alignment?.vertical || "",
    textFlow: style.alignment?.cloudTextFlow || (style.alignment?.wrapText ? "wrap" : "cut"),
    numberFormat: cell?.z || ""
  };
}

export function applyCellFormatting(XLSX, model, sheetName, startRow, startCol, endRow, endCol, format, shouldRecord = true) {
  const sheet = model.sheets.find((item) => item.name === sheetName);
  const worksheet = worksheetFor(model, sheetName);
  if (!sheet) throw new Error(`找不到 Sheet：${sheetName}`);
  const range = normalizedRange(startRow, startCol, endRow, endCol);
  for (let row = range.s.r; row <= range.e.r; row++) {
    for (let col = range.s.c; col <= range.e.c; col++) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = worksheet[address] ? cloneCell(worksheet[address]) : { t: "s", v: "" };
      const style = structuredClone(cell.s || {});
      if (["bold", "italic", "underline", "textColor"].some((key) => key in format)) {
        style.font = { ...(style.font || {}) };
        for (const key of ["bold", "italic", "underline"]) {
          if (key in format) style.font[key] = Boolean(format[key]);
        }
        if ("textColor" in format) {
          if (format.textColor) style.font.color = { rgb: `FF${String(format.textColor).replace("#", "").toUpperCase()}` };
          else delete style.font.color;
        }
      }
      if ("fillColor" in format) {
        if (format.fillColor) {
          style.fill = {
            patternType: "solid",
            fgColor: { rgb: `FF${String(format.fillColor).replace("#", "").toUpperCase()}` },
            bgColor: { indexed: 64 }
          };
        } else delete style.fill;
      }
      if ("horizontal" in format || "vertical" in format || "textFlow" in format) {
        style.alignment = { ...(style.alignment || {}) };
        if ("horizontal" in format) {
          if (format.horizontal) style.alignment.horizontal = format.horizontal;
          else delete style.alignment.horizontal;
        }
        if ("vertical" in format) {
          if (format.vertical) style.alignment.vertical = format.vertical;
          else delete style.alignment.vertical;
        }
        if ("textFlow" in format) {
          const textFlow = ["overflow", "cut", "wrap"].includes(format.textFlow) ? format.textFlow : "cut";
          style.alignment.cloudTextFlow = textFlow;
          if (textFlow === "wrap") style.alignment.wrapText = true;
          else delete style.alignment.wrapText;
        }
      }
      if ("numberFormat" in format) {
        if (format.numberFormat) cell.z = format.numberFormat;
        else delete cell.z;
        delete cell.w;
      }
      cell.s = style;
      worksheet[address] = cell;
      expandWorksheetRange(XLSX, worksheet, row, col);
    }
  }
  recalculateWorkbookFormulas(XLSX, model);
  refreshSheetRange(XLSX, model, sheetName, range);
  record(model, { type: "formatRange", sheet: sheetName, range, format: structuredClone(format) }, shouldRecord);
}

export function mergeCellRange(XLSX, model, sheetName, startRow, startCol, endRow, endCol, shouldRecord = true) {
  const worksheet = worksheetFor(model, sheetName);
  const range = normalizedRange(startRow, startCol, endRow, endCol);
  if (range.s.r === range.e.r && range.s.c === range.e.c) return false;
  const merges = worksheet["!merges"] ||= [];
  if (merges.some((existing) => rangesOverlap(existing, range))) throw new Error("选区与已有合并单元格重叠");
  merges.push(structuredClone(range));
  for (let row = range.s.r; row <= range.e.r; row++) {
    for (let col = range.s.c; col <= range.e.c; col++) {
      if (row === range.s.r && col === range.s.c) continue;
      delete worksheet[XLSX.utils.encode_cell({ r: row, c: col })];
    }
  }
  refreshSheetRange(XLSX, model, sheetName, range);
  record(model, { type: "mergeRange", sheet: sheetName, range: structuredClone(range) }, shouldRecord);
  return true;
}

export function unmergeCellAt(XLSX, model, sheetName, row, col, shouldRecord = true) {
  const worksheet = worksheetFor(model, sheetName);
  const merges = worksheet["!merges"] || [];
  const index = merges.findIndex((range) => row >= range.s.r && row <= range.e.r && col >= range.s.c && col <= range.e.c);
  if (index < 0) return null;
  const [range] = merges.splice(index, 1);
  refreshSheetRange(XLSX, model, sheetName, range);
  record(model, { type: "unmergeRange", sheet: sheetName, range: structuredClone(range) }, shouldRecord);
  return structuredClone(range);
}

function shiftFormulaReferences(XLSX, formula, rowDelta, colDelta) {
  return String(formula).replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/gi, (_, colFixed, letters, rowFixed, digits) => {
    const decoded = XLSX.utils.decode_cell(`${letters}${digits}`);
    const row = rowFixed ? decoded.r : Math.max(0, decoded.r + rowDelta);
    const col = colFixed ? decoded.c : Math.max(0, decoded.c + colDelta);
    const encoded = XLSX.utils.encode_cell({ r: row, c: col });
    const match = /^([A-Z]+)(\d+)$/.exec(encoded);
    return `${colFixed}${match[1]}${rowFixed}${match[2]}`;
  });
}

export function fillCellRange(XLSX, model, sheetName, source, target, shouldRecord = true) {
  const worksheet = worksheetFor(model, sheetName);
  const src = normalizedRange(source.s.r, source.s.c, source.e.r, source.e.c);
  const dst = normalizedRange(target.s.r, target.s.c, target.e.r, target.e.c);
  const sourceRows = src.e.r - src.s.r + 1;
  const sourceCols = src.e.c - src.s.c + 1;
  const sourceCells = captureCellRange(XLSX, model, sheetName, src.s.r, src.s.c, sourceRows, sourceCols);
  const verticalSeries = sourceCols === 1 && sourceRows >= 2;
  const horizontalSeries = sourceRows === 1 && sourceCols >= 2;
  const firstNumber = Number(sourceCells[0]?.[0]?.v);
  const secondNumber = verticalSeries ? Number(sourceCells[1]?.[0]?.v) : Number(sourceCells[0]?.[1]?.v);
  const hasSeries = (verticalSeries || horizontalSeries) && Number.isFinite(firstNumber) && Number.isFinite(secondNumber);
  const step = secondNumber - firstNumber;
  for (let row = dst.s.r; row <= dst.e.r; row++) {
    for (let col = dst.s.c; col <= dst.e.c; col++) {
      if (row >= src.s.r && row <= src.e.r && col >= src.s.c && col <= src.e.c) continue;
      const sourceRow = src.s.r + ((row - src.s.r) % sourceRows + sourceRows) % sourceRows;
      const sourceCol = src.s.c + ((col - src.s.c) % sourceCols + sourceCols) % sourceCols;
      const template = cloneCell(sourceCells[sourceRow - src.s.r]?.[sourceCol - src.s.c]);
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      if (hasSeries && ((verticalSeries && col === src.s.c) || (horizontalSeries && row === src.s.r))) {
        const index = verticalSeries ? row - src.s.r : col - src.s.c;
        const cell = template || { t: "n", v: 0 };
        delete cell.f;
        delete cell.w;
        cell.t = "n";
        cell.v = firstNumber + step * index;
        worksheet[address] = cell;
      } else if (template) {
        if (typeof template.f === "string") {
          template.f = shiftFormulaReferences(XLSX, template.f, row - sourceRow, col - sourceCol);
          delete template.w;
        }
        worksheet[address] = template;
      } else delete worksheet[address];
      expandWorksheetRange(XLSX, worksheet, row, col);
    }
  }
  recalculateWorkbookFormulas(XLSX, model);
  refreshSheetRange(XLSX, model, sheetName, dst);
  record(model, { type: "fillRange", sheet: sheetName, source: src, target: dst }, shouldRecord);
}

export function sortCellRange(XLSX, model, sheetName, rangeInput, keyCol, direction = "asc", headerRows = 1, shouldRecord = true) {
  const worksheet = worksheetFor(model, sheetName);
  const range = normalizedRange(rangeInput.s.r, rangeInput.s.c, rangeInput.e.r, rangeInput.e.c);
  if ((worksheet["!merges"] || []).some((merge) => rangesOverlap(merge, range))) {
    throw new Error("包含合并单元格的区域暂不支持排序");
  }
  const firstDataRow = Math.min(range.e.r + 1, range.s.r + Math.max(0, headerRows));
  const rows = [];
  for (let row = firstDataRow; row <= range.e.r; row++) {
    rows.push({
      sourceRow: row,
      cells: captureCellRange(XLSX, model, sheetName, row, range.s.c, 1, range.e.c - range.s.c + 1)[0]
    });
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  rows.sort((first, second) => {
    const a = cellDisplayText(XLSX, first.cells[keyCol - range.s.c]);
    const b = cellDisplayText(XLSX, second.cells[keyCol - range.s.c]);
    const result = collator.compare(a, b);
    return direction === "desc" ? -result : result;
  });
  rows.forEach((entry, index) => {
    const targetRow = firstDataRow + index;
    entry.cells.forEach((sourceCell, colOffset) => {
      const address = XLSX.utils.encode_cell({ r: targetRow, c: range.s.c + colOffset });
      const cell = cloneCell(sourceCell);
      if (cell && typeof cell.f === "string") {
        cell.f = shiftFormulaReferences(XLSX, cell.f, targetRow - entry.sourceRow, 0);
        delete cell.w;
      }
      if (cell) worksheet[address] = cell;
      else delete worksheet[address];
    });
  });
  recalculateWorkbookFormulas(XLSX, model);
  refreshSheetRange(XLSX, model, sheetName, range);
  record(model, { type: "sortRange", sheet: sheetName, range, keyCol, direction, headerRows }, shouldRecord);
}

export function setSheetFreeze(model, sheetName, rows, cols, shouldRecord = true) {
  const sheet = model.sheets.find((item) => item.name === sheetName);
  if (!sheet) throw new Error(`找不到 Sheet：${sheetName}`);
  sheet.freeze = { rows: Math.max(0, Number(rows) || 0), cols: Math.max(0, Number(cols) || 0) };
  record(model, { type: "setFreeze", sheet: sheetName, freeze: { ...sheet.freeze } }, shouldRecord);
}

export function setSheetFilter(XLSX, model, sheetName, col, query, shouldRecord = true) {
  const sheet = model.sheets.find((item) => item.name === sheetName);
  const worksheet = worksheetFor(model, sheetName);
  if (!sheet) throw new Error(`找不到 Sheet：${sheetName}`);
  const normalized = String(query || "").trim().toLocaleLowerCase();
  worksheet["!rows"] ||= [];
  for (let row = 1; row < sheet.viewRows; row++) {
    worksheet["!rows"][row] ||= {};
    const value = String(sheet.data[row]?.[col] ?? "").toLocaleLowerCase();
    worksheet["!rows"][row].hidden = Boolean(normalized && !value.includes(normalized));
  }
  sheet.filter = normalized ? { col, query: String(query).trim() } : null;
  record(model, { type: "setFilter", sheet: sheetName, col, query: String(query || "") }, shouldRecord);
}

export function addSheetChart(model, sheetName, chart, shouldRecord = true) {
  const sheet = model.sheets.find((item) => item.name === sheetName);
  if (!sheet) throw new Error(`找不到 Sheet：${sheetName}`);
  const next = { id: chart.id || `chart-${Date.now()}`, type: chart.type || "bar", ...structuredClone(chart) };
  sheet.charts ||= [];
  sheet.charts.push(next);
  record(model, { type: "addChart", sheet: sheetName, chart: structuredClone(next) }, shouldRecord);
  return next;
}

export function removeSheetChart(model, sheetName, chartId, shouldRecord = true) {
  const sheet = model.sheets.find((item) => item.name === sheetName);
  if (!sheet) throw new Error(`找不到 Sheet：${sheetName}`);
  const index = (sheet.charts || []).findIndex((chart) => chart.id === chartId);
  if (index < 0) return null;
  const [removed] = sheet.charts.splice(index, 1);
  record(model, { type: "removeChart", sheet: sheetName, chartId }, shouldRecord);
  return removed;
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
    } else if (operation?.type === "setRange") {
      setCellRange(XLSX, model, operation.sheet, operation.row, operation.col, operation.values, false);
    } else if (operation?.type === "restoreRange") {
      restoreCellRange(XLSX, model, operation.sheet, operation.row, operation.col, operation.cells, false);
    } else if (operation?.type === "formatRange") {
      applyCellFormatting(XLSX, model, operation.sheet, operation.range.s.r, operation.range.s.c, operation.range.e.r, operation.range.e.c, operation.format, false);
    } else if (operation?.type === "mergeRange") {
      mergeCellRange(XLSX, model, operation.sheet, operation.range.s.r, operation.range.s.c, operation.range.e.r, operation.range.e.c, false);
    } else if (operation?.type === "unmergeRange") {
      unmergeCellAt(XLSX, model, operation.sheet, operation.range.s.r, operation.range.s.c, false);
    } else if (operation?.type === "fillRange") {
      fillCellRange(XLSX, model, operation.sheet, operation.source, operation.target, false);
    } else if (operation?.type === "sortRange") {
      sortCellRange(XLSX, model, operation.sheet, operation.range, operation.keyCol, operation.direction, operation.headerRows, false);
    } else if (operation?.type === "setFreeze") {
      setSheetFreeze(model, operation.sheet, operation.freeze.rows, operation.freeze.cols, false);
    } else if (operation?.type === "setFilter") {
      setSheetFilter(XLSX, model, operation.sheet, operation.col, operation.query, false);
    } else if (operation?.type === "addChart") {
      addSheetChart(model, operation.sheet, operation.chart, false);
    } else if (operation?.type === "removeChart") {
      removeSheetChart(model, operation.sheet, operation.chartId, false);
    } else if (operation?.type === "restoreLayout") {
      restoreSheetLayout(model, operation.sheet, operation.layout, false);
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
