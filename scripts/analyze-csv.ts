#!/usr/bin/env tsx
import * as fs from "fs";

const lines = fs.readFileSync("reports/fielding-decisions.csv", "utf-8").replace(/^\uFEFF/, "").split("\n").filter(l => l.trim());
const header = lines[0].split(",");
const rows = lines.slice(1).map(l => {
  const cols = l.split(",");
  const obj: Record<string, string> = {};
  header.forEach((h, i) => obj[h] = cols[i] ?? "");
  return obj;
});

console.log("=== 全体統計 ===");
console.log("総件数:", rows.length);
const byResult: Record<string, number> = {};
rows.forEach(r => { byResult[r["結果"]] = (byResult[r["結果"]] ?? 0) + 1; });
console.log("結果分布:", byResult);

const shortDoubles = rows.filter(r => r["結果"] === "double" && parseFloat(r["飛距離(m)"]) < 55);
console.log("\n=== 短距離二塁打 (<55m) ===");
console.log("件数:", shortDoubles.length);
const byType: Record<string, number> = {};
shortDoubles.forEach(r => { byType[r["打球種"]] = (byType[r["打球種"]] ?? 0) + 1; });
console.log("打球種:", byType);

console.log("\n=== 短距離二塁打サンプル (先頭10件) ===");
for (const r of shortDoubles.slice(0, 10)) {
  const lfD = parseFloat(r["LF_着地時距離(m)"]);
  const cfD = parseFloat(r["CF_着地時距離(m)"]);
  const rfD = parseFloat(r["RF_着地時距離(m)"]);
  const minOF = Math.min(lfD, cfD, rfD);
  const closest = lfD === minOF ? "LF" : cfD === minOF ? "CF" : "RF";
  console.log(
    `  ${r["打球種"].padEnd(12)} dir=${r["方向(°)"].padStart(5)} dist=${r["飛距離(m)"].padStart(5)}m EV=${r["初速(km/h)"].padStart(3)}`,
    `${closest}残=${minOF.toFixed(1)}m bounce=${r["バウンス(s)"]}s 回収=${r["回収野手"]} 2Bマージン=${r["2Bマージン(s)"]}s`
  );
}

console.log("\n=== 異常パターン検出 ===");

const closeOFDoubles = shortDoubles.filter(r => {
  return Math.min(parseFloat(r["LF_着地時距離(m)"]), parseFloat(r["CF_着地時距離(m)"]), parseFloat(r["RF_着地時距離(m)"])) < 5;
});
console.log("外野手が着地時5m以内で二塁打:", closeOFDoubles.length);
for (const r of closeOFDoubles.slice(0, 5)) {
  const lfD = parseFloat(r["LF_着地時距離(m)"]);
  const cfD = parseFloat(r["CF_着地時距離(m)"]);
  const rfD = parseFloat(r["RF_着地時距離(m)"]);
  const minOF = Math.min(lfD, cfD, rfD);
  const closest = lfD === minOF ? "LF" : cfD === minOF ? "CF" : "RF";
  console.log(
    `  ${r["打球種"].padEnd(12)} dir=${r["方向(°)"]} dist=${r["飛距離(m)"]}m EV=${r["初速(km/h)"]}`,
    `${closest}残=${minOF.toFixed(1)}m bounce=${r["バウンス(s)"]}s total=${r["回収合計(s)"]}s`,
    `走者2B=${r["走者→2B(s)"]}s 守備2B=${r["守備→2B(s)"]}s`
  );
}

const holdPrimary = rows.filter(r => {
  for (const pos of ["LF", "CF", "RF", "P", "C"]) {
    if (r[pos + "_役割"] === "primary" && r[pos + "_アクション"] === "hold") return true;
  }
  return false;
});
console.log("primary野手がhold:", holdPrimary.length);
for (const r of holdPrimary.slice(0, 3)) {
  for (const pos of ["LF", "CF", "RF", "P", "C"]) {
    if (r[pos + "_役割"] === "primary" && r[pos + "_アクション"] === "hold") {
      console.log(`  ${pos} hold+primary: ${r["打球種"]} dir=${r["方向(°)"]} dist=${r["飛距離(m)"]}m`);
    }
  }
}

const groundDoubles = rows.filter(r => r["結果"] === "double" && r["打球種"] === "ground_ball");
console.log("ゴロ二塁打:", groundDoubles.length);
for (const r of groundDoubles.slice(0, 3)) {
  console.log(`  dir=${r["方向(°)"]} EV=${r["初速(km/h)"]} 回収=${r["回収野手"]} bounce=${r["バウンス(s)"]}s total=${r["回収合計(s)"]}s`);
}

const lowBounce = shortDoubles.filter(r => parseFloat(r["バウンス(s)"]) < 0.5);
console.log("バウンス<0.5sの短距離二塁打:", lowBounce.length);

console.log("\n=== 二塁打の2Bマージン分布 ===");
const doubles = rows.filter(r => r["結果"] === "double");
const margins = doubles.map(r => parseFloat(r["2Bマージン(s)"])).filter(m => !isNaN(m));
const buckets = [0, 0.3, 0.6, 1.0, 1.5, 2.0, 999];
for (let i = 0; i < buckets.length - 1; i++) {
  const count = margins.filter(m => m >= buckets[i] && m < buckets[i + 1]).length;
  console.log(`  ${buckets[i].toFixed(1)}-${buckets[i + 1].toFixed(1)}s: ${count}件`);
}
console.log("  平均:", (margins.reduce((a, b) => a + b, 0) / margins.length).toFixed(2) + "s");

// 回収野手がキャッチャーや投手になっているケース
console.log("\n=== 回収野手の分布 ===");
const retrieverDist: Record<string, number> = {};
rows.forEach(r => { retrieverDist[r["回収野手"]] = (retrieverDist[r["回収野手"]] ?? 0) + 1; });
console.log(retrieverDist);

// 回収野手がP/Cの詳細
const pcRetriever = rows.filter(r => r["回収野手"] === "P" || r["回収野手"] === "C");
console.log("P/Cが回収:", pcRetriever.length);
for (const r of pcRetriever.slice(0, 5)) {
  console.log(`  ${r["結果"]} ${r["打球種"]} dir=${r["方向(°)"]} dist=${r["飛距離(m)"]}m 回収=${r["回収野手"]}`);
}
