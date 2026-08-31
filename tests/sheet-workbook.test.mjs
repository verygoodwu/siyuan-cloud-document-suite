import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

import {
  analyzeWorkbookCapabilities,
  applyRecoveryPayload,
  captureCellRange,
  captureSheetState,
  captureWorkbookState,
  cellInputText,
  cellRangeToTsv,
  deleteColumns,
  deleteRows,
  deleteWorksheet,
  insertColumns,
  insertRows,
  makeRecoveryPayload,
  parseClipboardTable,
  parseWorkbookModel,
  renameWorksheet,
  restoreSheetLayout,
  restoreCellRange,
  restoreWorkbookState,
  selectionStatistics,
  serializeWorkbookModel,
  setColumnWidth,
  setCellRange,
  setCellsText,
  setCellText,
  setRowHeight,
  validateSerializedWorkbook
} from "../static/sheet-workbook.js";

test("workbook capability analysis reports lightweight boundaries", () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 501 }, () => Array(51).fill("x")));
  XLSX.utils.book_append_sheet(workbook, sheet, "大表");
  const result = analyzeWorkbookCapabilities(XLSX, workbook);
  assert.equal(result.safeToEdit, false);
  assert.equal(result.maxRows, 501);
  assert.equal(result.maxCols, 51);
  assert.ok(result.warnings.some((warning) => warning.includes("行数")));
  assert.ok(result.warnings.some((warning) => warning.includes("列数")));
});

function fixtureBytes() {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    [1, 2, { t: "n", f: "A1+B1", v: 3 }],
    ["merged", ""]
  ]);
  worksheet["!merges"] = [XLSX.utils.decode_range("A2:B2")];
  worksheet["!cols"] = [{ wch: 24 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(workbook, worksheet, "Calc");
  return new Uint8Array(XLSX.write(workbook, {
    type: "array",
    bookType: "xlsx",
    cellStyles: true
  }));
}

test("editing one cell preserves untouched formulas, merges, and column metadata", () => {
  const model = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/完成度50%.xlsx");
  assert.equal(model.title, "完成度50%");
  setCellText(XLSX, model, "Calc", 0, 0, "10");

  const reopened = XLSX.read(serializeWorkbookModel(XLSX, model), {
    type: "array",
    cellFormula: true,
    cellStyles: true
  });
  const sheet = reopened.Sheets.Calc;
  assert.equal(sheet.A1.v, 10);
  assert.equal(sheet.C1.f, "A1+B1");
  assert.equal(sheet["!merges"].length, 1);
  assert.equal(sheet["!cols"][0].wch, 24);
});

test("serialized workbooks pass formula, merge, and view-state round-trip validation", () => {
  const model = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/validated-export.xlsx");
  model.sheets[0].freeze = { rows: 1, cols: 1 };
  model.sheets[0].filter = { col: 0, query: "merged" };
  model.sheets[0].charts = [{ id: "chart-1", type: "bar", range: "A1:C2" }];
  const bytes = serializeWorkbookModel(XLSX, model);

  assert.deepEqual(validateSerializedWorkbook(XLSX, model, bytes), {
    sheetCount: 1,
    formulaCount: 1,
    mergeCount: 1
  });
});

test("export validation rejects unreadable or structurally incomplete bytes", () => {
  const model = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/invalid-export.xlsx");
  assert.throws(
    () => validateSerializedWorkbook(XLSX, model, new Uint8Array([1, 2, 3, 4])),
    /导出/
  );
});

test("operation recovery reapplies edits without rebuilding the workbook", () => {
  const first = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/recovery.xlsx");
  setCellText(XLSX, first, "Calc", 0, 1, "20");
  const recovery = makeRecoveryPayload(first);

  const restored = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/recovery.xlsx");
  applyRecoveryPayload(XLSX, restored, recovery);
  const reopened = XLSX.read(serializeWorkbookModel(XLSX, restored), {
    type: "array",
    cellFormula: true
  });
  assert.equal(reopened.Sheets.Calc.B1.v, 20);
  assert.equal(reopened.Sheets.Calc.C1.f, "A1+B1");
});

test("simple formulas calculate, refresh dependencies, and remain editable", () => {
  const model = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/formula.xlsx");
  setCellText(XLSX, model, "Calc", 2, 2, "A1+B1");
  assert.equal(model.workbook.Sheets.Calc.C3.f, "A1+B1");
  assert.equal(model.workbook.Sheets.Calc.C3.v, 3);
  assert.equal(model.sheets[0].data[2][2], "3");
  assert.equal(cellInputText(XLSX, model, "Calc", 2, 2), "=A1+B1");

  setCellText(XLSX, model, "Calc", 0, 0, "5");
  assert.equal(model.workbook.Sheets.Calc.C3.v, 7);
  assert.equal(model.sheets[0].data[2][2], "7");

  setCellText(XLSX, model, "Calc", 3, 2, "=(A1+B1)*2");
  assert.equal(model.workbook.Sheets.Calc.C4.f, "(A1+B1)*2");
  assert.equal(model.workbook.Sheets.Calc.C4.v, 14);

  setCellText(XLSX, model, "Calc", 4, 2, "SUM(A1:B1)");
  setCellText(XLSX, model, "Calc", 5, 2, "=AVERAGE(A1:B1)");
  setCellText(XLSX, model, "Calc", 6, 2, "=MIN(A1:B1)+MAX(A1:B1)");
  setCellText(XLSX, model, "Calc", 7, 2, "=COUNT(A1:B2)");
  setCellText(XLSX, model, "Calc", 8, 2, "=ROUND(10/3,2)");
  setCellText(XLSX, model, "Calc", 9, 2, "=ABS(-5)");
  setCellText(XLSX, model, "Calc", 10, 2, "=IF(A1>B1,100,0)");
  assert.equal(model.workbook.Sheets.Calc.C5.v, 7);
  assert.equal(model.workbook.Sheets.Calc.C6.v, 3.5);
  assert.equal(model.workbook.Sheets.Calc.C7.v, 7);
  assert.equal(model.workbook.Sheets.Calc.C8.v, 2);
  assert.equal(model.workbook.Sheets.Calc.C9.v, 3.33);
  assert.equal(model.workbook.Sheets.Calc.C10.v, 5);
  assert.equal(model.workbook.Sheets.Calc.C11.v, 100);

  setCellText(XLSX, model, "Calc", 11, 2, "=VLOOKUP(A1,A1:B2,2,0)");
  assert.equal(model.workbook.Sheets.Calc.C12.f, "VLOOKUP(A1,A1:B2,2,0)");
  assert.equal(model.sheets[0].data[11][2], "#暂不支持");
});

test("lightweight input stores numbers and percentages without breaking text identifiers", () => {
  const model = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/types.xlsx");
  setCellText(XLSX, model, "Calc", 2, 0, "123.5");
  setCellText(XLSX, model, "Calc", 3, 0, "25%");
  setCellText(XLSX, model, "Calc", 4, 0, "00123");
  setCellText(XLSX, model, "Calc", 5, 0, "'456");

  const sheet = model.workbook.Sheets.Calc;
  assert.deepEqual({ t: sheet.A3.t, v: sheet.A3.v }, { t: "n", v: 123.5 });
  assert.deepEqual({ t: sheet.A4.t, v: sheet.A4.v, z: sheet.A4.z }, { t: "n", v: 0.25, z: "0%" });
  assert.deepEqual({ t: sheet.A5.t, v: sheet.A5.v }, { t: "s", v: "00123" });
  assert.deepEqual({ t: sheet.A6.t, v: sheet.A6.v }, { t: "s", v: "456" });
});

test("lightweight input recognizes strict dates and RMB currency", () => {
  const model = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/date-currency.xlsx");
  setCellText(XLSX, model, "Calc", 2, 0, "2026-08-30");
  setCellText(XLSX, model, "Calc", 3, 0, "￥1,234.50");

  const sheet = model.workbook.Sheets.Calc;
  assert.equal(sheet.A3.t, "d");
  assert.equal(sheet.A3.z, "yyyy-mm-dd");
  assert.equal(sheet.A3.v.getFullYear(), 2026);
  assert.deepEqual({ t: sheet.A4.t, v: sheet.A4.v, z: sheet.A4.z }, { t: "n", v: 1234.5, z: "[$¥-804]#,##0.00" });
  assert.equal(model.sheets[0].data[2][0], "2026-08-30");
  assert.equal(model.sheets[0].data[3][0], "¥1,234.50");

  const reopened = XLSX.read(serializeWorkbookModel(XLSX, model), { type: "array", cellDates: true, cellStyles: true });
  assert.equal(reopened.Sheets.Calc.A3.t, "d");
  assert.equal(reopened.Sheets.Calc.A3.z, "yyyy-mm-dd");
  assert.equal(reopened.Sheets.Calc.A4.v, 1234.5);
  assert.equal(reopened.Sheets.Calc.A4.z, "[$¥-804]#,##0.00");
});

test("changing an automatic date or currency back to text clears its old number format", () => {
  const model = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/type-switch.xlsx");
  setCellText(XLSX, model, "Calc", 2, 0, "2026-08-30");
  setCellText(XLSX, model, "Calc", 2, 0, "普通文本");
  setCellText(XLSX, model, "Calc", 3, 0, "¥99.50");
  setCellText(XLSX, model, "Calc", 3, 0, "42");

  assert.deepEqual({ t: model.workbook.Sheets.Calc.A3.t, v: model.workbook.Sheets.Calc.A3.v, z: model.workbook.Sheets.Calc.A3.z }, { t: "s", v: "普通文本", z: undefined });
  assert.deepEqual({ t: model.workbook.Sheets.Calc.A4.t, v: model.workbook.Sheets.Calc.A4.v, z: model.workbook.Sheets.Calc.A4.z }, { t: "n", v: 42, z: undefined });
});

test("batch cell replacement recalculates once and replays as one recovery operation", () => {
  const model = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/batch-replace.xlsx");
  setCellsText(XLSX, model, "Calc", [
    { row: 0, col: 0, value: "10" },
    { row: 0, col: 1, value: "20" },
    { row: 2, col: 0, value: "=A1+B1" }
  ]);

  assert.equal(model.operations.length, 1);
  assert.equal(model.operations[0].type, "setCells");
  assert.equal(model.workbook.Sheets.Calc.C1.v, 30);
  assert.equal(model.workbook.Sheets.Calc.A3.v, 30);

  const recovered = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/batch-replace.xlsx");
  applyRecoveryPayload(XLSX, recovered, makeRecoveryPayload(model));
  assert.equal(recovered.operations.length, 1);
  assert.equal(recovered.workbook.Sheets.Calc.C1.v, 30);
  assert.equal(recovered.workbook.Sheets.Calc.A3.f, "A1+B1");
  assert.equal(recovered.workbook.Sheets.Calc.A3.v, 30);
});

test("formula evaluator exposes distinct lightweight error results", () => {
  const model = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/formula-errors.xlsx");
  setCellText(XLSX, model, "Calc", 2, 0, "=1/0");
  setCellText(XLSX, model, "Calc", 3, 0, "=A2+1");
  setCellText(XLSX, model, "Calc", 4, 0, "=A5+1");

  assert.equal(model.sheets[0].data[2][0], "#DIV/0!");
  assert.equal(model.sheets[0].data[3][0], "#VALUE!");
  assert.equal(model.sheets[0].data[4][0], "#CYCLE!");
});

test("selection statistics count text and summarize only numeric cells", () => {
  const model = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/selection-summary.xlsx");
  assert.deepEqual(selectionStatistics(XLSX, model, "Calc", 0, 0, 1, 2), {
    nonEmptyCount: 4,
    numericCount: 3,
    sum: 6,
    average: 2
  });

  setCellText(XLSX, model, "Calc", 2, 0, "2026-08-30");
  setCellText(XLSX, model, "Calc", 2, 1, "￥10.50");
  assert.deepEqual(selectionStatistics(XLSX, model, "Calc", 2, 0, 2, 1), {
    nonEmptyCount: 2,
    numericCount: 1,
    sum: 10.5,
    average: 10.5
  });
});

test("selection statistics cover the full lightweight 500 by 50 range", () => {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 500 }, () => Array(50).fill(1)));
  XLSX.utils.book_append_sheet(workbook, worksheet, "Data");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const model = parseWorkbookModel(XLSX, bytes, "/assets/selection-pressure.xlsx");
  assert.deepEqual(selectionStatistics(XLSX, model, "Data", 0, 0, 499, 49), {
    nonEmptyCount: 25_000,
    numericCount: 25_000,
    sum: 25_000,
    average: 1
  });
});

test("row heights and column widths survive recovery and xlsx round trips", () => {
  const model = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/layout.xlsx");
  setColumnWidth(model, "Calc", 1, 180);
  setRowHeight(model, "Calc", 1, 44);

  const recovered = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/layout.xlsx");
  applyRecoveryPayload(XLSX, recovered, makeRecoveryPayload(model));
  assert.equal(recovered.workbook.Sheets.Calc["!cols"][1].wpx, 180);
  assert.equal(recovered.workbook.Sheets.Calc["!rows"][1].hpx, 44);

  const reopened = XLSX.read(serializeWorkbookModel(XLSX, recovered), {
    type: "array",
    cellStyles: true
  });
  assert.ok(Math.abs(reopened.Sheets.Calc["!cols"][1].wpx - 180) <= 1);
  assert.ok(Math.abs(reopened.Sheets.Calc["!rows"][1].hpx - 44) <= 1);
});

test("v1.8.1 layout recovery does not clear existing column widths", () => {
  const model = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/legacy-layout.xlsx");
  const originalWidth = model.workbook.Sheets.Calc["!cols"][0].wch;
  restoreSheetLayout(model, "Calc", {
    merges: model.workbook.Sheets.Calc["!merges"],
    rows: [],
    freeze: { rows: 0, cols: 0 },
    filter: null,
    charts: []
  }, false);
  assert.equal(model.workbook.Sheets.Calc["!cols"][0].wch, originalWidth);
});

test("inserting and deleting columns shifts formulas, merges, and column widths", () => {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    [1, 2, 3, { t: "n", f: "SUM($A$1:C1)", v: 6 }, "", { t: "n", f: "IF(A1=\"A1\",B1,0)", v: 2 }],
    ["merged", ""]
  ]);
  worksheet["!merges"] = [XLSX.utils.decode_range("A2:B2")];
  worksheet["!cols"] = [{ wpx: 80 }, { wpx: 120 }, { wpx: 160 }, { wpx: 200 }];
  XLSX.utils.book_append_sheet(workbook, worksheet, "Data");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx", cellStyles: true });
  const model = parseWorkbookModel(XLSX, bytes, "/assets/columns.xlsx");

  insertColumns(XLSX, model, "Data", 1, 1);
  let sheet = model.workbook.Sheets.Data;
  assert.equal(sheet.E1.f, "SUM($A$1:D1)");
  assert.equal(sheet.G1.f, "IF(A1=\"A1\",C1,0)");
  assert.equal(sheet.C1.v, 2);
  assert.deepEqual(sheet["!merges"][0], XLSX.utils.decode_range("A2:C2"));
  assert.equal(sheet["!cols"][2].wpx, 120);

  deleteColumns(XLSX, model, "Data", 1, 1);
  sheet = model.workbook.Sheets.Data;
  assert.equal(sheet.D1.f, "SUM($A$1:C1)");
  assert.equal(sheet.F1.f, "IF(A1=\"A1\",B1,0)");
  assert.equal(sheet.B1.v, 2);
  assert.deepEqual(sheet["!merges"][0], XLSX.utils.decode_range("A2:B2"));
  assert.equal(sheet["!cols"][1].wpx, 120);
});

test("row structure operations update local and cross-sheet references", () => {
  const workbook = XLSX.utils.book_new();
  const data = XLSX.utils.aoa_to_sheet([
    [1],
    [2],
    [3],
    ["", { t: "n", f: "SUM(A1:A3)", v: 6 }]
  ]);
  data["!rows"] = [{ hpx: 24 }, { hpx: 36 }, { hpx: 48 }, { hpx: 60 }];
  const summary = XLSX.utils.aoa_to_sheet([[{ t: "n", f: "Data!A2", v: 2 }]]);
  XLSX.utils.book_append_sheet(workbook, data, "Data");
  XLSX.utils.book_append_sheet(workbook, summary, "Summary");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx", cellStyles: true });
  const model = parseWorkbookModel(XLSX, bytes, "/assets/rows.xlsx");
  model.sheets[0].freeze = { rows: 2, cols: 0 };

  insertRows(XLSX, model, "Data", 1, 1);
  assert.equal(model.workbook.Sheets.Data.B5.f, "SUM(A1:A4)");
  assert.equal(model.workbook.Sheets.Summary.A1.f, "Data!A3");
  assert.equal(model.workbook.Sheets.Data["!rows"][2].hpx, 36);
  assert.equal(model.sheets[0].freeze.rows, 3);

  deleteRows(XLSX, model, "Data", 2, 1);
  assert.equal(model.workbook.Sheets.Data.B4.f, "SUM(A1:A3)");
  assert.equal(model.workbook.Sheets.Summary.A1.f, "#REF!");
  assert.equal(model.sheets[0].freeze.rows, 2);
});

test("structure boundaries keep merges, filters, charts, and freezes aligned", () => {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["A", "B", "C", "D"],
    [1, 2, 3, 4],
    [5, 6, 7, 8],
    [9, 10, 11, 12]
  ]);
  worksheet["!merges"] = [XLSX.utils.decode_range("B2:C3")];
  worksheet["!autofilter"] = { ref: "A1:D4" };
  XLSX.utils.book_append_sheet(workbook, worksheet, "Data");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const model = parseWorkbookModel(XLSX, bytes, "/assets/structure-boundaries.xlsx");
  model.sheets[0].freeze = { rows: 2, cols: 2 };
  model.sheets[0].filter = { col: 2, query: "7" };
  model.sheets[0].charts = [{ id: "chart", type: "bar", range: "B2:D4" }];

  insertRows(XLSX, model, "Data", 2, 1);
  insertColumns(XLSX, model, "Data", 2, 1);
  assert.deepEqual(model.workbook.Sheets.Data["!merges"][0], XLSX.utils.decode_range("B2:D4"));
  assert.equal(model.workbook.Sheets.Data["!autofilter"].ref, "A1:E5");
  assert.deepEqual(model.sheets[0].freeze, { rows: 2, cols: 2 });
  assert.deepEqual(model.sheets[0].filter, { col: 3, query: "7" });
  assert.equal(model.sheets[0].charts[0].range, "B2:E5");

  deleteRows(XLSX, model, "Data", 0, 1);
  deleteColumns(XLSX, model, "Data", 2, 1);
  assert.deepEqual(model.workbook.Sheets.Data["!merges"][0], XLSX.utils.decode_range("B1:C3"));
  assert.equal(model.workbook.Sheets.Data["!autofilter"].ref, "A1:D4");
  assert.deepEqual(model.sheets[0].freeze, { rows: 1, cols: 2 });
  assert.deepEqual(model.sheets[0].filter, { col: 2, query: "7" });
  assert.equal(model.sheets[0].charts[0].range, "B1:D4");
});

test("targeted structure snapshots do not copy unrelated large sheet data", () => {
  const workbook = XLSX.utils.book_new();
  const data = XLSX.utils.aoa_to_sheet([["value"], [1]]);
  const largeRows = Array.from({ length: 1200 }, (_, index) => [index, `row-${index}`]);
  const archive = XLSX.utils.aoa_to_sheet(largeRows);
  archive.C1 = { t: "n", f: "Data!A2", v: 1 };
  archive["!ref"] = "A1:C1200";
  XLSX.utils.book_append_sheet(workbook, data, "Data");
  XLSX.utils.book_append_sheet(workbook, archive, "Archive");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const model = parseWorkbookModel(XLSX, bytes, "/assets/targeted-history.xlsx");

  const snapshot = captureWorkbookState(model, "Data");
  assert.deepEqual(snapshot.sheets.map((item) => item.name), ["Data"]);
  assert.deepEqual(snapshot.formulaCells.Archive.map(([address]) => address), ["C1"]);
  assert.ok(JSON.stringify(snapshot).length < 20_000);
});

test("continuous row and column operations replay safely from recovery", () => {
  const workbook = XLSX.utils.book_new();
  const data = XLSX.utils.aoa_to_sheet([["header", "value"], ["item", 10]]);
  const summary = XLSX.utils.aoa_to_sheet([[{ t: "n", f: "Data!B2", v: 10 }]]);
  XLSX.utils.book_append_sheet(workbook, data, "Data");
  XLSX.utils.book_append_sheet(workbook, summary, "Summary");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const model = parseWorkbookModel(XLSX, bytes, "/assets/continuous-structure.xlsx");

  for (let index = 0; index < 12; index++) {
    insertRows(XLSX, model, "Data", 1, 1);
    insertColumns(XLSX, model, "Data", 1, 1);
    deleteRows(XLSX, model, "Data", 1, 1);
    deleteColumns(XLSX, model, "Data", 1, 1);
  }
  const recovered = parseWorkbookModel(XLSX, bytes, "/assets/continuous-structure.xlsx");
  applyRecoveryPayload(XLSX, recovered, makeRecoveryPayload(model));
  assert.equal(recovered.workbook.Sheets.Data.B2.v, 10);
  assert.equal(recovered.workbook.Sheets.Summary.A1.f, "Data!B2");
  assert.equal(recovered.operations.length, 48);
});

test("workbook snapshots restore cross-sheet formulas for structural undo and redo", () => {
  const workbook = XLSX.utils.book_new();
  const data = XLSX.utils.aoa_to_sheet([["header"], [10]]);
  const summary = XLSX.utils.aoa_to_sheet([[{ t: "n", f: "Data!A2", v: 10 }]]);
  XLSX.utils.book_append_sheet(workbook, data, "Data");
  XLSX.utils.book_append_sheet(workbook, summary, "Summary");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const model = parseWorkbookModel(XLSX, bytes, "/assets/workbook-history.xlsx");

  const before = captureWorkbookState(model, "Data");
  insertRows(XLSX, model, "Data", 1, 1);
  const after = captureWorkbookState(model, "Data");
  assert.equal(model.workbook.Sheets.Summary.A1.f, "Data!A3");

  restoreWorkbookState(XLSX, model, before);
  assert.equal(model.workbook.Sheets.Data.A2.v, 10);
  assert.equal(model.workbook.Sheets.Summary.A1.f, "Data!A2");
  const recoveredBefore = parseWorkbookModel(XLSX, bytes, "/assets/workbook-history.xlsx");
  applyRecoveryPayload(XLSX, recoveredBefore, makeRecoveryPayload(model));
  assert.equal(recoveredBefore.workbook.Sheets.Data.A2.v, 10);
  assert.equal(recoveredBefore.workbook.Sheets.Summary.A1.f, "Data!A2");

  restoreWorkbookState(XLSX, model, after);
  assert.equal(model.workbook.Sheets.Data.A3.v, 10);
  assert.equal(model.workbook.Sheets.Summary.A1.f, "Data!A3");
  const recoveredAfter = parseWorkbookModel(XLSX, bytes, "/assets/workbook-history.xlsx");
  applyRecoveryPayload(XLSX, recoveredAfter, makeRecoveryPayload(model));
  assert.equal(recoveredAfter.workbook.Sheets.Data.A3.v, 10);
  assert.equal(recoveredAfter.workbook.Sheets.Summary.A1.f, "Data!A3");
});

test("sheet structure state and recovery restore inserted rows safely", () => {
  const model = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/structure-recovery.xlsx");
  const before = captureSheetState(model, "Calc");
  insertRows(XLSX, model, "Calc", 0, 2);
  setCellText(XLSX, model, "Calc", 0, 0, "new");

  const recovered = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/structure-recovery.xlsx");
  applyRecoveryPayload(XLSX, recovered, makeRecoveryPayload(model));
  assert.equal(recovered.workbook.Sheets.Calc.A1.v, "new");
  assert.equal(recovered.workbook.Sheets.Calc.A3.v, 1);

  const changed = captureSheetState(model, "Calc");
  assert.notDeepEqual(changed.worksheet, before.worksheet);
});

test("range paste and recovery preserve rectangular clipboard data", () => {
  const model = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/range.xlsx");
  const values = parseClipboardTable("甲\t乙\r\n1\t2\r\n");
  assert.deepEqual(values, [["甲", "乙"], ["1", "2"]]);
  setCellRange(XLSX, model, "Calc", 2, 1, values);
  assert.equal(cellRangeToTsv(XLSX, model, "Calc", 2, 1, 2, 2), "甲\t乙\n1\t2");

  const restored = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/range.xlsx");
  applyRecoveryPayload(XLSX, restored, makeRecoveryPayload(model));
  assert.equal(cellRangeToTsv(XLSX, restored, "Calc", 2, 1, 2, 2), "甲\t乙\n1\t2");
});

test("range snapshots restore formulas and styles for undo", () => {
  const model = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/undo.xlsx");
  const before = captureCellRange(XLSX, model, "Calc", 0, 2, 1, 1);
  assert.equal(before[0][0].f, "A1+B1");
  setCellRange(XLSX, model, "Calc", 0, 2, [["覆盖"]]);
  assert.equal(model.workbook.Sheets.Calc.C1.f, undefined);
  restoreCellRange(XLSX, model, "Calc", 0, 2, before);
  assert.equal(model.workbook.Sheets.Calc.C1.f, "A1+B1");

  const restored = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/undo.xlsx");
  applyRecoveryPayload(XLSX, restored, makeRecoveryPayload(model));
  assert.equal(restored.workbook.Sheets.Calc.C1.f, "A1+B1");
});

test("renaming a sheet updates formula references", () => {
  const model = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/rename.xlsx");
  const summary = XLSX.utils.aoa_to_sheet([[{ t: "n", f: "Calc!C1", v: 3 }]]);
  XLSX.utils.book_append_sheet(model.workbook, summary, "Summary");
  model.sheets.push({ name: "Summary", data: [["3"]], viewRows: 30, viewCols: 15 });
  renameWorksheet(model, "Calc", "计算 表");
  assert.equal(model.workbook.Sheets.Summary.A1.f, "'计算 表'!C1");
});

test("deleting a sheet preserves remaining sheets and replays safely from recovery", () => {
  const model = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/delete.xlsx");
  const summary = XLSX.utils.aoa_to_sheet([["keep"]]);
  XLSX.utils.book_append_sheet(model.workbook, summary, "Summary");
  model.sheets.push({ name: "Summary", data: [["keep"]], viewRows: 30, viewCols: 15 });
  deleteWorksheet(model, "Calc");

  assert.deepEqual(model.workbook.SheetNames, ["Summary"]);
  assert.equal(model.workbook.Sheets.Calc, undefined);
  assert.equal(model.workbook.Sheets.Summary.A1.v, "keep");
  assert.throws(() => deleteWorksheet(model, "Summary"), /至少保留一个 Sheet/);

  const restored = parseWorkbookModel(XLSX, fixtureBytes(), "/assets/delete.xlsx");
  const restoredSummary = XLSX.utils.aoa_to_sheet([["keep"]]);
  XLSX.utils.book_append_sheet(restored.workbook, restoredSummary, "Summary");
  restored.sheets.push({ name: "Summary", data: [["keep"]], viewRows: 30, viewCols: 15 });
  applyRecoveryPayload(XLSX, restored, makeRecoveryPayload(model));
  assert.deepEqual(restored.workbook.SheetNames, ["Summary"]);
  assert.equal(restored.workbook.Sheets.Summary.A1.v, "keep");
});

test("non-xlsx assets are rejected before an incompatible write", () => {
  for (const name of ["book.csv", "book.xls", "book.xlsm", "book.xlsb"]) {
    assert.throws(
      () => parseWorkbookModel(XLSX, fixtureBytes(), `/assets/${name}`),
      /仅允许编辑 \.xlsx/
    );
  }
});

test("lightweight workbook limit accepts exactly 500 by 50", () => {
  const workbook = XLSX.utils.book_new();
  const rows = Array.from({ length: 500 }, (_, row) =>
    Array.from({ length: 50 }, (_, col) => `${row}:${col}`)
  );
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Limit");
  const result = analyzeWorkbookCapabilities(XLSX, workbook);
  assert.equal(result.safeToEdit, true);
  assert.equal(result.maxRows, 500);
  assert.equal(result.maxCols, 50);
  assert.equal(result.warnings.length, 0);
});

test("one row or column beyond the limit is rejected independently", () => {
  for (const [rows, cols, warning] of [[501, 50, "行数"], [500, 51, "列数"]]) {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(
      Array.from({ length: rows }, () => Array(cols).fill("x"))
    ), "Limit");
    const result = analyzeWorkbookCapabilities(XLSX, workbook);
    assert.equal(result.safeToEdit, false);
    assert.ok(result.warnings.some((item) => item.includes(warning)));
  }
});

test("serializing the full lightweight boundary stays within the performance budget", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(
    Array.from({ length: 500 }, (_, row) => Array.from({ length: 50 }, (_, col) => row * 50 + col))
  ), "Limit");
  const model = parseWorkbookModel(XLSX, new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" })), "/assets/limit.xlsx");
  const startedAt = performance.now();
  const bytes = serializeWorkbookModel(XLSX, model);
  const elapsed = performance.now() - startedAt;
  assert.ok(bytes.length > 0);
  assert.ok(elapsed < 1000, `boundary serialization took ${elapsed.toFixed(1)} ms`);
});
