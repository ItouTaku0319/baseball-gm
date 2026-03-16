/**
 * 退行テスト: フライ・ライナー・ランナーありシナリオ
 */
import { generateScenarioLog } from "../src/engine/scenario-generator";

const posNames: Record<number, string> = {1:'P',2:'C',3:'1B',4:'2B',5:'3B',6:'SS',7:'LF',8:'CF',9:'RF'};

// フライ系テスト
console.log("=== フライ / ライナー / ポップ ===");
const flyTests = [
  { ev: 140, la: 30, dir: 45, label: "センターフライ" },
  { ev: 160, la: 35, dir: 20, label: "レフトフライ" },
  { ev: 100, la: 50, dir: 45, label: "内野フライ" },
  { ev: 140, la: 10, dir: 30, label: "ライナー" },
  { ev: 120, la: 60, dir: 60, label: "ポップフライ" },
];
for (const t of flyTests) {
  const log = generateScenarioLog({ exitVelocity: t.ev, launchAngle: t.la, direction: t.dir });
  const timeline = log.agentTimeline;
  const frame = timeline?.find(f => Math.abs(f.t - 0.50) < 0.06);
  const pursuers = frame?.agents.filter(a => a.state === "PURSUING").map(a => posNames[a.pos]).join(",") ?? "";
  const coverers = frame?.agents.filter(a => a.state === "COVERING").map(a => posNames[a.pos]).join(",") ?? "";
  console.log(`  ${t.label.padEnd(12)} EV=${t.ev} LA=${t.la} dir=${t.dir} → ${log.result.padEnd(12)} 追球:[${pursuers}] カバー:[${coverers}]`);
}

// 通常ゴロ (EV=130-150)
console.log("\n=== 通常ゴロ (EV=130-150) ===");
for (const ev of [130, 140, 150]) {
  for (const dir of [0, 30, 60, 90]) {
    const log = generateScenarioLog({ exitVelocity: ev, launchAngle: -10, direction: dir });
    const timeline = log.agentTimeline;
    const frame = timeline?.find(f => Math.abs(f.t - 0.50) < 0.06);
    const pursuers = frame?.agents.filter(a => a.state === "PURSUING").map(a => posNames[a.pos]).join(",") ?? "";
    console.log(`  EV=${ev} dir=${String(dir).padStart(2)} → ${log.result.padEnd(12)} 追球:[${pursuers}]`);
  }
}
