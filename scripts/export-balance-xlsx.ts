/**
 * バランステスト結果を Excel に出力するスクリプト
 * Usage: npx tsx scripts/export-balance-xlsx.ts
 *
 * tmp/ 内の CSV (league-summary, batter-stats, pitcher-stats) を読み込み、
 * reports/balance-report-YYYYMMDD.xlsx に3シート構成で出力する。
 */

import ExcelJS from "exceljs";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const TMP = path.join(ROOT, "tmp");
const REPORTS = path.join(ROOT, "reports");

function parseCSV(filePath: string): string[][] {
  const raw = fs.readFileSync(filePath, "utf-8").replace(/^\uFEFF/, ""); // BOM除去
  return raw
    .trim()
    .split("\n")
    .map((line) => line.split(","));
}

function autoNumber(v: string): string | number {
  if (v === "") return "";
  if (v.endsWith("%")) return v; // %は文字列のまま
  const n = Number(v);
  return isNaN(n) ? v : n;
}

async function main() {
  if (!fs.existsSync(REPORTS)) fs.mkdirSync(REPORTS, { recursive: true });

  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const outPath = path.join(REPORTS, `balance-report-${stamp}.xlsx`);

  const wb = new ExcelJS.Workbook();

  // ── Sheet 1: リーグサマリ ──
  {
    const rows = parseCSV(path.join(TMP, "league-summary.csv"));
    const ws = wb.addWorksheet("リーグサマリ");
    const header = rows[0];
    ws.addRow(header);

    // ヘッダースタイル
    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF2E4057" },
      };
      cell.alignment = { horizontal: "center" };
    });

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      ws.addRow([r[0], autoNumber(r[1]), r[2] ?? ""]);
    }

    // 列幅
    ws.getColumn(1).width = 20;
    ws.getColumn(2).width = 15;
    ws.getColumn(3).width = 18;

    // NPB範囲内かどうかで色付け
    ws.eachRow((row, rowNum) => {
      if (rowNum <= 1) return;
      const npbRef = String(row.getCell(3).value ?? "");
      if (!npbRef) return;
      const val = Number(row.getCell(2).value);
      if (isNaN(val)) return;

      // "X-Y" or ".X-.Y" パース
      const m = npbRef.match(/([\d.]+)\s*-\s*([\d.]+)/);
      if (!m) return;
      const lo = Number(m[1]);
      const hi = Number(m[2]);
      const inRange = val >= lo && val <= hi;
      row.getCell(2).font = {
        color: { argb: inRange ? "FF00AA00" : "FFDD0000" },
        bold: true,
      };
    });
  }

  // ── Sheet 2: 打者成績 ──
  {
    const rows = parseCSV(path.join(TMP, "batter-stats.csv"));
    const ws = wb.addWorksheet("打者成績");
    const header = rows[0];
    ws.addRow(header);

    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF1B3A5C" },
      };
      cell.alignment = { horizontal: "center" };
    });

    for (let i = 1; i < rows.length; i++) {
      ws.addRow(rows[i].map(autoNumber));
    }

    // ストライプ
    ws.eachRow((row, rowNum) => {
      if (rowNum <= 1) return;
      if (rowNum % 2 === 0) {
        row.eachCell((cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF0F4F8" },
          };
        });
      }
    });

    // 列幅自動調整 (簡易)
    ws.columns.forEach((col) => {
      col.width = Math.max(
        10,
        Math.min(
          20,
          String(col.header ?? "").length * 1.5 + 4,
        ),
      );
    });
    ws.getColumn(1).width = 16; // 名前列
  }

  // ── Sheet 3: 投手成績 ──
  {
    const rows = parseCSV(path.join(TMP, "pitcher-stats.csv"));
    const ws = wb.addWorksheet("投手成績");
    const header = rows[0];
    ws.addRow(header);

    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF3B1F2B" },
      };
      cell.alignment = { horizontal: "center" };
    });

    for (let i = 1; i < rows.length; i++) {
      ws.addRow(rows[i].map(autoNumber));
    }

    // ストライプ
    ws.eachRow((row, rowNum) => {
      if (rowNum <= 1) return;
      if (rowNum % 2 === 0) {
        row.eachCell((cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF8F0F4" },
          };
        });
      }
    });

    ws.columns.forEach((col) => {
      col.width = Math.max(
        10,
        Math.min(
          20,
          String(col.header ?? "").length * 1.5 + 4,
        ),
      );
    });
    ws.getColumn(1).width = 16;
  }

  // フィルタ有効化
  for (const ws of [wb.getWorksheet("打者成績")!, wb.getWorksheet("投手成績")!]) {
    const lastCol = ws.getRow(1).cellCount;
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: ws.rowCount, column: lastCol },
    };
    // ウィンドウ枠固定（ヘッダー行）
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }

  await wb.xlsx.writeFile(outPath);
  console.log(`出力完了: ${outPath}`);
  console.log(
    `  シート: リーグサマリ / 打者成績(${parseCSV(path.join(TMP, "batter-stats.csv")).length - 1}人) / 投手成績(${parseCSV(path.join(TMP, "pitcher-stats.csv")).length - 1}人)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
