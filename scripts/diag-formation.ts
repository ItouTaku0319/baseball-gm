/**
 * 守備フォーメーション体系的診断
 *
 * 全方向 × 打球タイプで野手配置を検証し、以下を検出:
 * 1. 野手の位置重なり（同じ場所に複数人）
 * 2. 追球者が不適切（本来追うべきでない野手が追っている）
 * 3. バックアップ/カバー不足
 * 4. 不自然な動き（HOLDING のまま動かない外野手等）
 *
 * 実行: npx tsx scripts/diag-formation.ts
 */
import { resolvePlayWithAgents } from "../src/engine/fielding-agent";
import { calcBallLanding } from "../src/engine/fielding-ai";
import { classifyBattedBallType } from "../src/engine/simulation";
import type { Player, Position } from "../src/models/player";
import type { FielderPosition } from "../src/engine/fielding-agent-types";

const POS_NAMES: Record<number, string> = {
  1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF",
};

function createD50(pos: FielderPosition): Player {
  const position = ({ 1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF" } as Record<FielderPosition, Position>)[pos];
  return {
    id: `g-${position}`, name: `G50${position}`, age: 25, position,
    isPitcher: pos === 1, throwHand: "R", batSide: "R",
    batting: { contact: 50, power: 50, trajectory: 2, speed: 50, arm: 50, fielding: 50, catching: 50, eye: 50 },
    pitching: pos === 1 ? { velocity: 145, control: 50, pitches: [{ type: "slider", level: 4 }], stamina: 50, mentalToughness: 50, arm: 50, fielding: 50, catching: 50 } : null,
    potential: { overall: "C" }, salary: 500, contractYears: 1, careerBattingStats: {}, careerPitchingStats: {},
  } as Player;
}

const fm = new Map<FielderPosition, Player>();
for (const p of [1, 2, 3, 4, 5, 6, 7, 8, 9] as FielderPosition[]) fm.set(p, createD50(p));
const batter = createD50(3);
const noRunners = { first: null, second: null, third: null };
const runnersFirst = { first: createD50(4), second: null, third: null };
const runnersThird = { first: null, second: null, third: createD50(4) };

// ====================================================================
// テストパターン
// ====================================================================

interface BallPattern {
  name: string;
  dir: number;
  la: number;
  ev: number;
  expectedPursuer: string;   // 本来追うべき野手
  expectedBackup?: string;   // バックアップ期待
}

const PATTERNS: BallPattern[] = [
  // === 外野フライ: 各方向 ===
  { name: "LF定位置フライ",     dir: 15, la: 30, ev: 100, expectedPursuer: "LF" },
  { name: "LF深いフライ",       dir: 10, la: 30, ev: 150, expectedPursuer: "LF", expectedBackup: "CF" },
  { name: "LF線際フライ",       dir: 3,  la: 28, ev: 120, expectedPursuer: "LF" },
  { name: "左中間フライ",       dir: 25, la: 32, ev: 120, expectedPursuer: "LF/CF" },
  { name: "CF定位置フライ",     dir: 45, la: 30, ev: 100, expectedPursuer: "CF" },
  { name: "CF深いフライ",       dir: 45, la: 30, ev: 150, expectedPursuer: "CF", expectedBackup: "LF/RF" },
  { name: "右中間フライ",       dir: 65, la: 32, ev: 120, expectedPursuer: "CF/RF" },
  { name: "RF定位置フライ",     dir: 75, la: 30, ev: 100, expectedPursuer: "RF" },
  { name: "RF深いフライ",       dir: 80, la: 30, ev: 150, expectedPursuer: "RF", expectedBackup: "CF" },
  { name: "RF線際フライ",       dir: 87, la: 28, ev: 120, expectedPursuer: "RF" },

  // === 内野フライ/ポップ ===
  { name: "SS頭上ポップ",       dir: 30, la: 60, ev: 70,  expectedPursuer: "SS" },
  { name: "2B頭上ポップ",       dir: 60, la: 60, ev: 70,  expectedPursuer: "2B" },
  { name: "投手後方ポップ",     dir: 45, la: 65, ev: 75,  expectedPursuer: "P/SS/2B" },
  { name: "捕手後方ポップ",     dir: 45, la: 80, ev: 50,  expectedPursuer: "C/P" },

  // === ゴロ: 各方向 ===
  { name: "3B正面ゴロ",         dir: 15, la: -12, ev: 100, expectedPursuer: "3B" },
  { name: "三遊間ゴロ",         dir: 22, la: -12, ev: 100, expectedPursuer: "SS/3B" },
  { name: "SS正面ゴロ",         dir: 30, la: -12, ev: 100, expectedPursuer: "SS" },
  { name: "センター返しゴロ",   dir: 45, la: -10, ev: 100, expectedPursuer: "SS/2B/P" },
  { name: "2B正面ゴロ",         dir: 60, la: -12, ev: 100, expectedPursuer: "2B" },
  { name: "一二間ゴロ",         dir: 68, la: -12, ev: 100, expectedPursuer: "2B/1B" },
  { name: "1B正面ゴロ",         dir: 75, la: -12, ev: 100, expectedPursuer: "1B" },
  { name: "3B線ゴロ",           dir: 5,  la: -10, ev: 90,  expectedPursuer: "3B" },
  { name: "1B線ゴロ",           dir: 85, la: -10, ev: 90,  expectedPursuer: "1B" },
  { name: "投手前ボテボテ",     dir: 45, la: -5,  ev: 50,  expectedPursuer: "P" },

  // === ライナー ===
  { name: "三遊間ライナー",     dir: 22, la: 12, ev: 130, expectedPursuer: "SS/3B" },
  { name: "センターライナー",   dir: 45, la: 10, ev: 140, expectedPursuer: "SS/2B/P" },
  { name: "一二間ライナー",     dir: 68, la: 12, ev: 120, expectedPursuer: "2B/1B" },
  { name: "LF前ライナー",       dir: 15, la: 15, ev: 110, expectedPursuer: "3B/SS/LF" },
  { name: "RF前ライナー",       dir: 75, la: 15, ev: 110, expectedPursuer: "1B/2B/RF" },
];

// ====================================================================
// 分析ロジック
// ====================================================================

interface Issue {
  severity: "CRITICAL" | "WARN" | "INFO";
  pattern: string;
  message: string;
}

function analyzeFormation(pattern: BallPattern): Issue[] {
  const issues: Issue[] = [];
  const { name, dir, la, ev } = pattern;

  const ballType = classifyBattedBallType(la, ev);
  const landing = calcBallLanding(dir, la, ev);
  const ball = { direction: dir, launchAngle: la, exitVelocity: ev, type: ballType };

  let result;
  try {
    result = resolvePlayWithAgents(ball, landing, fm, batter, noRunners, 0, {
      collectTimeline: true,
      perceptionNoise: 0,
      random: () => 0.5,
    });
  } catch (e: unknown) {
    issues.push({ severity: "CRITICAL", pattern: name, message: `クラッシュ: ${e instanceof Error ? e.message : String(e)}` });
    return issues;
  }

  const tl = result.agentTimeline;
  if (!tl || tl.length === 0) {
    issues.push({ severity: "CRITICAL", pattern: name, message: "タイムラインなし" });
    return issues;
  }

  // t=2.0時点のスナップショットを分析（打球反応が一通り決まった後）
  const analysisTime = 2.0;
  const analysisFrame = tl.find(f => Math.abs(f.t - analysisTime) < 0.06) ?? tl[Math.min(30, tl.length - 1)];
  const finalFrame = tl[tl.length - 1];

  // --- チェック1: 位置重なり ---
  const OVERLAP_THRESHOLD = 3.0; // 3m以内は重なり
  for (let i = 0; i < analysisFrame.agents.length; i++) {
    for (let j = i + 1; j < analysisFrame.agents.length; j++) {
      const a = analysisFrame.agents[i];
      const b = analysisFrame.agents[j];
      // P/Cは除外（元から近い）
      if ((a.pos === 1 && b.pos === 2) || (a.pos === 2 && b.pos === 1)) continue;
      // HOLDINGのP/Cと他の野手の重なりも除外
      if ((a.pos <= 2 && a.state === "HOLDING") || (b.pos <= 2 && b.state === "HOLDING")) continue;

      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < OVERLAP_THRESHOLD) {
        const aName = POS_NAMES[a.pos];
        const bName = POS_NAMES[b.pos];
        const aState = a.state;
        const bState = b.state;
        issues.push({
          severity: "CRITICAL",
          pattern: name,
          message: `位置重なり: ${aName}(${aState}) と ${bName}(${bState}) が${dist.toFixed(1)}m — pos(${a.x.toFixed(0)},${a.y.toFixed(0)})`,
        });
      }
    }
  }

  // --- チェック2: 追球者の妥当性 ---
  const pursuers = analysisFrame.agents.filter(a => a.state === "PURSUING");
  if (pursuers.length === 0 && !["popout", "flyout", "lineout"].includes(result.result)) {
    // ゴロでは追球者=0になるケースもあるが、フライで0は問題
    if (la > 10) {
      issues.push({ severity: "WARN", pattern: name, message: "追球者なし（フライ/ライナーなのに誰も追っていない）" });
    }
  }
  if (pursuers.length > 0) {
    const pursuerNames = pursuers.map(p => POS_NAMES[p.pos]).join(",");
    const expected = pattern.expectedPursuer.split("/");
    const anyMatch = pursuers.some(p => expected.includes(POS_NAMES[p.pos]));
    if (!anyMatch) {
      issues.push({
        severity: "WARN",
        pattern: name,
        message: `追球者不適切: ${pursuerNames} が追球中（期待: ${pattern.expectedPursuer}）`,
      });
    }
  }

  // --- チェック3: 外野フライでのバックアップ ---
  if (pattern.expectedBackup) {
    const backuppers = analysisFrame.agents.filter(a => a.state === "BACKING_UP");
    const expected = pattern.expectedBackup.split("/");
    const anyBackup = backuppers.some(b => expected.includes(POS_NAMES[b.pos]));
    if (!anyBackup) {
      issues.push({
        severity: "WARN",
        pattern: name,
        message: `バックアップ不足: ${pattern.expectedBackup}のバックアップ期待だが、BACKING_UP=[${backuppers.map(b => POS_NAMES[b.pos]).join(",") || "なし"}]`,
      });
    }
  }

  // --- チェック4: 外野手がHOLDINGで微動だにしない ---
  const outfielders = [7, 8, 9];
  for (const ofPos of outfielders) {
    const agent = analysisFrame.agents.find(a => a.pos === ofPos);
    const initial = tl[0].agents.find(a => a.pos === ofPos);
    if (!agent || !initial) continue;

    const moved = Math.sqrt((agent.x - initial.x) ** 2 + (agent.y - initial.y) ** 2);
    if (agent.state === "HOLDING" && moved < 1.0 && la > 15) {
      // フライ/ライナーで外野手が全く動いてないのはおかしい（ドリフトすべき）
      issues.push({
        severity: "INFO",
        pattern: name,
        message: `${POS_NAMES[ofPos]}がフライ/ライナーでHOLDING+移動<1m（ドリフトすべき？）`,
      });
    }
  }

  // --- チェック5: 内野手の塁カバー状況 ---
  const coverers = analysisFrame.agents.filter(a => a.state === "COVERING");
  // 1塁は常にカバーされるべき（打者走者がいるため）
  const firstBaseCovered = coverers.some(a => {
    const tgtDist = Math.sqrt((a.targetX! - 19.4) ** 2 + (a.targetY! - 19.4) ** 2);
    return tgtDist < 5;
  });
  if (!firstBaseCovered) {
    // RECEIVING状態の野手も1塁カバーの可能性
    const firstReceiver = analysisFrame.agents.some(a => {
      if (a.state !== "RECEIVING") return false;
      const d = Math.sqrt((a.x - 19.4) ** 2 + (a.y - 19.4) ** 2);
      return d < 5;
    });
    if (!firstReceiver) {
      issues.push({
        severity: "INFO",
        pattern: name,
        message: "1塁カバーなし（打者走者の送球先が確保されていない）",
      });
    }
  }

  // --- チェック6: プレー時間 ---
  const duration = finalFrame.t;
  if (duration > 12) {
    issues.push({ severity: "CRITICAL", pattern: name, message: `プレー時間 ${duration.toFixed(1)}s（12s超）` });
  } else if (duration > 8) {
    issues.push({ severity: "WARN", pattern: name, message: `プレー時間 ${duration.toFixed(1)}s（8s超）` });
  }

  // --- チェック7: 最終状態で動き続ける野手（フリーズせず終了すべき） ---
  const endTime = finalFrame.t;
  if (endTime > 10) {
    // 10秒以上のプレーで、まだPURSUINGの野手がいればおかしい
    const stillPursuing = finalFrame.agents.filter(a => a.state === "PURSUING");
    if (stillPursuing.length > 0) {
      issues.push({
        severity: "WARN",
        pattern: name,
        message: `終了時にまだPURSUING: ${stillPursuing.map(a => POS_NAMES[a.pos]).join(",")}`,
      });
    }
  }

  return issues;
}

// ====================================================================
// 走者ありのテスト
// ====================================================================

function analyzeWithRunners(): Issue[] {
  const issues: Issue[] = [];

  const runnerScenarios: Array<{ name: string; bases: { first: Player | null; second: Player | null; third: Player | null }; patterns: BallPattern[] }> = [
    {
      name: "一塁走者",
      bases: runnersFirst,
      patterns: [
        { name: "[1塁]LF深フライ",   dir: 10, la: 30, ev: 150, expectedPursuer: "LF", expectedBackup: "CF" },
        { name: "[1塁]SS前ゴロ",      dir: 30, la: -12, ev: 100, expectedPursuer: "SS" },
        { name: "[1塁]CF定位置フライ", dir: 45, la: 30, ev: 100, expectedPursuer: "CF" },
      ],
    },
    {
      name: "三塁走者",
      bases: runnersThird,
      patterns: [
        { name: "[3塁]CF深フライ",    dir: 45, la: 30, ev: 120, expectedPursuer: "CF" },
        { name: "[3塁]LFフライ",      dir: 15, la: 28, ev: 110, expectedPursuer: "LF" },
        { name: "[3塁]SS前ゴロ",      dir: 30, la: -12, ev: 100, expectedPursuer: "SS" },
      ],
    },
  ];

  for (const scenario of runnerScenarios) {
    for (const pattern of scenario.patterns) {
      const { name, dir, la, ev } = pattern;
      const ballType = classifyBattedBallType(la, ev);
      const landing = calcBallLanding(dir, la, ev);
      const ball = { direction: dir, launchAngle: la, exitVelocity: ev, type: ballType };

      let result;
      try {
        result = resolvePlayWithAgents(ball, landing, fm, batter, scenario.bases, 0, {
          collectTimeline: true,
          perceptionNoise: 0,
          random: () => 0.5,
        });
      } catch (e: unknown) {
        issues.push({ severity: "CRITICAL", pattern: name, message: `クラッシュ: ${e instanceof Error ? e.message : String(e)}` });
        continue;
      }

      const tl = result.agentTimeline;
      if (!tl || tl.length === 0) continue;

      const analysisTime = 2.0;
      const analysisFrame = tl.find(f => Math.abs(f.t - analysisTime) < 0.06) ?? tl[Math.min(30, tl.length - 1)];

      // 重なりチェック
      const OVERLAP_THRESHOLD = 3.0;
      for (let i = 0; i < analysisFrame.agents.length; i++) {
        for (let j = i + 1; j < analysisFrame.agents.length; j++) {
          const a = analysisFrame.agents[i];
          const b = analysisFrame.agents[j];
          if ((a.pos === 1 && b.pos === 2) || (a.pos === 2 && b.pos === 1)) continue;
          if ((a.pos <= 2 && a.state === "HOLDING") || (b.pos <= 2 && b.state === "HOLDING")) continue;

          const dist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
          if (dist < OVERLAP_THRESHOLD) {
            issues.push({
              severity: "CRITICAL",
              pattern: name,
              message: `位置重なり: ${POS_NAMES[a.pos]}(${a.state}) と ${POS_NAMES[b.pos]}(${b.state}) が${dist.toFixed(1)}m`,
            });
          }
        }
      }

      // プレー時間
      const duration = tl[tl.length - 1].t;
      if (duration > 12) {
        issues.push({ severity: "CRITICAL", pattern: name, message: `プレー時間 ${duration.toFixed(1)}s` });
      }
    }
  }

  return issues;
}

// ====================================================================
// フォーメーションサマリー出力
// ====================================================================

function printFormationSummary(pattern: BallPattern): void {
  const { name, dir, la, ev } = pattern;
  const ballType = classifyBattedBallType(la, ev);
  const landing = calcBallLanding(dir, la, ev);
  const ball = { direction: dir, launchAngle: la, exitVelocity: ev, type: ballType };

  const result = resolvePlayWithAgents(ball, landing, fm, batter, noRunners, 0, {
    collectTimeline: true,
    perceptionNoise: 0,
    random: () => 0.5,
  });

  const tl = result.agentTimeline;
  if (!tl || tl.length === 0) return;

  const analysisTime = 2.0;
  const frame = tl.find(f => Math.abs(f.t - analysisTime) < 0.06) ?? tl[Math.min(30, tl.length - 1)];

  const agents = frame.agents.map(a => {
    const tgt = a.targetX != null ? `→(${a.targetX.toFixed(0)},${a.targetY!.toFixed(0)})` : "";
    return `${POS_NAMES[a.pos]}:${a.state.slice(0, 4)}(${a.x.toFixed(0)},${a.y.toFixed(0)})${tgt}`;
  });

  console.log(`  ${name.padEnd(20)} dist=${landing.distance.toFixed(0)}m  結果=${result.result.padEnd(10)}  ${agents.join("  ")}`);
}

// ====================================================================
// メイン
// ====================================================================

console.log("=====================================================");
console.log("  守備フォーメーション体系的診断");
console.log("=====================================================\n");

// フォーメーションサマリー
console.log("=== フォーメーションサマリー（t=2.0s時点）===\n");
for (const p of PATTERNS) {
  printFormationSummary(p);
}

// 問題検出
console.log("\n=== 問題検出（走者なし）===\n");
const allIssues: Issue[] = [];
for (const p of PATTERNS) {
  const issues = analyzeFormation(p);
  allIssues.push(...issues);
}

// 走者ありテスト
console.log("=== 問題検出（走者あり）===\n");
const runnerIssues = analyzeWithRunners();
allIssues.push(...runnerIssues);

// 結果出力
const critical = allIssues.filter(i => i.severity === "CRITICAL");
const warns = allIssues.filter(i => i.severity === "WARN");
const infos = allIssues.filter(i => i.severity === "INFO");

if (critical.length > 0) {
  console.log(`[CRITICAL] ${critical.length}件:`);
  for (const i of critical) {
    console.log(`  ${i.pattern}: ${i.message}`);
  }
}

if (warns.length > 0) {
  console.log(`\n[WARN] ${warns.length}件:`);
  for (const i of warns) {
    console.log(`  ${i.pattern}: ${i.message}`);
  }
}

if (infos.length > 0) {
  console.log(`\n[INFO] ${infos.length}件:`);
  for (const i of infos) {
    console.log(`  ${i.pattern}: ${i.message}`);
  }
}

console.log("\n=====================================================");
console.log(`  合計: CRITICAL=${critical.length}  WARN=${warns.length}  INFO=${infos.length}`);
console.log("=====================================================");
