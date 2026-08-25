import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

import {
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
  setCellText
} from "../static/sheet-workbook.js";

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
  assert.equal(sheet.A1.v, "10");
  assert.equal(sheet.C1.f, "A1+B1");
  assert.equal(sheet["!merges"].length, 1);
  assert.equal(sheet["!cols"][0].wch, 24);
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
  assert.equal(reopened.Sheets.Calc.B1.v, "20");
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
