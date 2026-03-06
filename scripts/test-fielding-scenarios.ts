/**
 * 守備エンジン体系的テスト
 *
 * 全走者パターン × 代表的打球パターン × アウトカウントで
 * resolvePlayWithAgents を回し、野球ルール上おかしい結果を自動検出する。
 *
 * 実行: npx tsx scripts/test-fielding-scenarios.ts
 */
import { resolvePlayWithAgents } from "../src/engine/fielding-agent";
import { calcBallLanding } from "../src/engine/fielding-ai";
import { classifyBattedBallType } from "../src/engine/simulation";
import type { Player, Position } from "../src/models/player";
import type { FielderPosition, AgentFieldingResult, RunnerResult } from "../src/engine/fielding-agent-types";

// ====================================================================
// ヘルパー
// ====================================================================

const POSITION_MAP: Record<FielderPosition, Position> = {
  1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF",
};

function createD50(pos: FielderPosition): Player {
  const position = POSITION_MAP[pos];
  return {
    id: `g-${position}`, name: `G50${position}`, age: 25, position,
    isPitcher: pos === 1, throwHand: "R", batSide: "R",
    batting: { contact: 50, power: 50, trajectory: 2, speed: 50, arm: 50, fielding: 50, catching: 50, eye: 50 },
    pitching: pos === 1
      ? { velocity: 145, control: 50, pitches: [{ type: "slider", level: 4 }], stamina: 50, mentalToughness: 50, arm: 50, fielding: 50, catching: 50 }
      : null,
    potential: { overall: "C" }, salary: 500, contractYears: 1,
    careerBattingStats: {}, careerPitchingStats: {},
  } as Player;
}

const fielderMap = new Map<FielderPosition, Player>();
for (const p of [1, 2, 3, 4, 5, 6, 7, 8, 9] as FielderPosition[]) {
  fielderMap.set(p, createD50(p));
}

const batter = createD50(3);
const runnerPlayer = createD50(4);

// ====================================================================
// テストシナリオ定義
// ====================================================================

/** 打球パターン: [名前, direction, launchAngle, exitVelocity] */
const BALL_PATTERNS: [string, number, number, number][] = [
  // ゴロ系
  ["遅いゴロ（正面）",   45, -15, 80],
  ["速いゴロ（正面）",   45, -10, 130],
  ["ゴロ（三遊間）",     20, -12, 100],
  ["ゴロ（一二間）",     70, -12, 100],
  ["弱いゴロ（投前）",   25, -8, 60],

  // ライナー系
  ["低ライナー",         45, 15, 80],
  ["鋭いライナー(左中)", 25, 12, 130],
  ["ライナー(右中)",     65, 18, 110],

  // フライ系
  ["浅いフライ",         45, 30, 90],
  ["深いフライ(左)",     15, 35, 120],
  ["深いフライ(中)",     45, 32, 130],
  ["深いフライ(右)",     75, 35, 120],
  ["フェンス際フライ",   45, 28, 145],

  // ポップフライ
  ["内野ポップ",         45, 65, 70],
  ["キャッチャーポップ", 45, 75, 60],

  // 極端なケース
  ["三塁線ゴロ",          5, -10, 90],
  ["一塁線ゴロ",         85, -10, 90],
  ["ボテボテゴロ",       45, -5, 50],
];

/** 走者パターン: [名前, {first, second, third}] */
interface RunnerConfig { first: boolean; second: boolean; third: boolean; }
const RUNNER_PATTERNS: [string, RunnerConfig][] = [
  ["走者なし",    { first: false, second: false, third: false }],
  ["一塁",       { first: true,  second: false, third: false }],
  ["二塁",       { first: false, second: true,  third: false }],
  ["三塁",       { first: false, second: false, third: true  }],
  ["一二塁",     { first: true,  second: true,  third: false }],
  ["一三塁",     { first: true,  second: false, third: true  }],
  ["二三塁",     { first: false, second: true,  third: true  }],
  ["満塁",       { first: true,  second: true,  third: true  }],
];

const OUT_COUNTS = [0, 1, 2];

// ====================================================================
// 野球ルール検証ロジック
// ====================================================================

interface Violation {
  severity: "ERROR" | "WARN";
  rule: string;
  detail: string;
  scenario: string;
}

const OUT_RESULTS = new Set([
  "groundout", "flyout", "lineout", "popout", "doublePlay",
  "sacrificeFly", "fieldersChoice", "sacrifice_bunt", "bunt_out",
]);
const HIT_RESULTS = new Set([
  "single", "double", "triple", "homerun", "infieldHit", "bunt_hit",
]);

function validateResult(
  result: AgentFieldingResult,
  ballName: string,
  runnerName: string,
  outs: number,
  dir: number,
  la: number,
  ev: number,
  ballType: string,
  duration: number,
): Violation[] {
  const violations: Violation[] = [];
  const scenario = `${ballName} | ${runnerName} | ${outs}アウト | dir=${dir},la=${la},ev=${ev} → ${result.result}`;

  const runners = result.runnerResults ?? [];
  const outsRecorded = runners.filter(r => r.isOut).length;
  const batterRunner = runners.find(r => r.fromBase === 0);
  const batterOut = batterRunner?.isOut ?? false;
  const batterReached = batterRunner ? (!batterRunner.isOut && batterRunner.reachedBase >= 1) : false;

  // === ルール1: アウトカウント整合性 ===
  // 3アウトを超えることはない
  if (outs + outsRecorded > 3) {
    violations.push({ severity: "ERROR", rule: "3アウト超過",
      detail: `既存${outs}アウト + 記録${outsRecorded}アウト = ${outs + outsRecorded}`, scenario });
  }

  // === ルール2: 結果とアウト数の整合性 ===
  // DP不整合: runnerResultsがある場合のみチェック
  if (result.result === "doublePlay" && runners.length > 0 && outsRecorded < 2) {
    violations.push({ severity: "ERROR", rule: "DP不整合",
      detail: `DPなのにアウト${outsRecorded}個`, scenario });
  }
  if (result.result === "doublePlay" && outs === 2) {
    violations.push({ severity: "ERROR", rule: "2アウトDP",
      detail: `2アウトからDPは不可能（最大1アウト追加）`, scenario });
  }

  // === ルール3: ヒット結果なのにアウトが記録されている場合 ===
  // ヒットで打者以外のランナーがアウト → これはFC的状況のはず
  // runnerResultsがある場合のみチェック
  if (HIT_RESULTS.has(result.result) && runners.length > 0) {
    const nonBatterOuts = runners.filter(r => r.isOut && r.fromBase !== 0);
    if (nonBatterOuts.length > 0) {
      violations.push({ severity: "ERROR", rule: "ヒット+ランナーアウト",
        detail: `結果=${result.result}なのにランナーがアウト: ${nonBatterOuts.map(r => `${r.fromBase}塁`).join(",")}`, scenario });
    }
  }

  // === ルール4: アウト結果なのに誰もアウトになっていない ===
  // 注: 標準のgroundout/DP/flyout/lineout/popoutパスではrunnerResultsを返さない設計
  // runnerResultsがある場合のみチェック（捕球失敗→送球アウトパス）
  if (OUT_RESULTS.has(result.result) && runners.length > 0 && outsRecorded === 0) {
    if (!["flyout", "lineout", "popout", "sacrificeFly", "groundout", "doublePlay"].includes(result.result)) {
      violations.push({ severity: "ERROR", rule: "アウト結果なのにアウト0",
        detail: `結果=${result.result}だがrunnerResultsにアウトなし`, scenario });
    }
  }

  // === ルール5: groundout結果で打者がセーフ（通常のゴロアウトでは打者はアウトのはず） ===
  // ただし、FCアウト（他のランナーをアウトにして打者生存）は現在groundoutで表現される
  // → これはWARNに留める（FC的状況は現実にありうる）

  // === ルール6: フォースプレーの整合性 ===
  // 一塁が埋まっている状態でゴロ→打者は1塁へ走る義務がある
  // フォースアウトは打者から順に連続する塁でのみ発生

  // === ルール7: 犠牲フライの条件 ===
  if (result.result === "sacrificeFly") {
    if (outs >= 2) {
      violations.push({ severity: "WARN", rule: "2アウト犠飛",
        detail: `2アウトから犠飛（フライ捕球で3アウトチェンジのため通常得点しない）`, scenario });
    }
    // 犠飛はフライ（ゴロではない）が前提
    if (ballType === "ground_ball") {
      violations.push({ severity: "ERROR", rule: "ゴロ犠飛",
        detail: `ゴロなのに犠飛判定`, scenario });
    }
  }

  // === ルール8: プレー時間の妥当性 ===
  if (duration > 15) {
    violations.push({ severity: "ERROR", rule: "プレー時間過大",
      detail: `${duration.toFixed(1)}秒（15秒超）`, scenario });
  } else if (duration > 10) {
    violations.push({ severity: "WARN", rule: "プレー時間長い",
      detail: `${duration.toFixed(1)}秒（10秒超）`, scenario });
  }

  // === ルール9: ランナーの到達塁の整合性 ===
  for (const r of runners) {
    // ランナーは後退できない（アウトでない限り）
    if (!r.isOut && r.reachedBase < r.fromBase && r.fromBase !== 0) {
      violations.push({ severity: "ERROR", rule: "ランナー後退",
        detail: `${r.fromBase}塁→${r.reachedBase}塁に後退`, scenario });
    }
    // ホームを超えることはない
    if (r.reachedBase > 4) {
      violations.push({ severity: "ERROR", rule: "塁番号超過",
        detail: `到達塁=${r.reachedBase}（4=ホーム超）`, scenario });
    }
    // アウトのランナーが進塁していてはいけない（タッチアウト等は元の塁位置で）
    // → ただしFCで先の塁でアウトの場合はfromBase < reachedBaseもありうる
  }

  // === ルール10: 同一塁に複数ランナーがいないか ===
  const safeRunners = runners.filter(r => !r.isOut);
  const occupiedBases = safeRunners.map(r => r.reachedBase).filter(b => b >= 1 && b <= 3);
  const uniqueBases = new Set(occupiedBases);
  if (uniqueBases.size < occupiedBases.length) {
    violations.push({ severity: "ERROR", rule: "同一塁重複",
      detail: `セーフランナーの到達塁: [${occupiedBases.join(",")}]`, scenario });
  }

  // === ルール11: フライアウトはゴロ打球では起きない ===
  if (["flyout", "lineout", "popout"].includes(result.result) && ballType === "ground_ball") {
    violations.push({ severity: "ERROR", rule: "ゴロでフライアウト",
      detail: `ゴロなのに${result.result}`, scenario });
  }

  // === ルール12: ゴロで犠飛は不可能 ===
  // (ルール7と重複するがゴロ判定で明確に)

  // === ルール13: エラーの整合性 ===
  if (result.result === "error" && !result.errorPos) {
    violations.push({ severity: "WARN", rule: "エラーpos未設定",
      detail: `result=errorだがerrorPosがない`, scenario });
  }

  // === ルール14: 走者なしでFCは起きない ===
  if (result.result === "fieldersChoice" && runnerName === "走者なし") {
    violations.push({ severity: "ERROR", rule: "走者なしFC",
      detail: `走者がいないのにFC`, scenario });
  }

  // === ルール15: DP条件 ===
  if (result.result === "doublePlay") {
    // 走者なしでDPは不可
    if (runnerName === "走者なし") {
      violations.push({ severity: "ERROR", rule: "走者なしDP",
        detail: `走者がいないのにDP`, scenario });
    }
  }

  // === ルール16: 2アウトでの犠飛不可（3アウトでチェンジ） ===
  // ルール7で既にカバー

  // === ルール17: 得点の整合性 ===
  const scoredRunners = runners.filter(r => !r.isOut && r.reachedBase === 4);
  // 3アウトになるプレーでは（最後のアウトがフォースアウトの場合）得点は認められない
  if (outs + outsRecorded >= 3 && scoredRunners.length > 0) {
    // ただしフォースアウトでない場合は、アウトより先に得点した走者は認められる
    // 現段階ではWARNに留める（タイミング依存のため完全な検証は難しい）
    violations.push({ severity: "WARN", rule: "3アウト時得点",
      detail: `${outs}+${outsRecorded}=${outs + outsRecorded}アウトで${scoredRunners.length}人得点`, scenario });
  }

  return violations;
}

// ====================================================================
// メイン実行
// ====================================================================

function runAllScenarios() {
  let totalTests = 0;
  let errors = 0;
  let warnings = 0;
  const allViolations: Violation[] = [];

  // 結果分布集計
  const resultCounts: Record<string, number> = {};

  console.log("========================================");
  console.log("  守備エンジン体系的テスト");
  console.log("========================================\n");

  for (const [ballName, dir, la, ev] of BALL_PATTERNS) {
    for (const [runnerName, rc] of RUNNER_PATTERNS) {
      for (const outs of OUT_COUNTS) {
        totalTests++;

        const bases = {
          first: rc.first ? runnerPlayer : null,
          second: rc.second ? runnerPlayer : null,
          third: rc.third ? runnerPlayer : null,
        };

        const ballType = classifyBattedBallType(la, ev);
        const landing = calcBallLanding(dir, la, ev);
        const ball = { direction: dir, launchAngle: la, exitVelocity: ev, type: ballType };

        let result: AgentFieldingResult;
        let duration = 0;
        try {
          result = resolvePlayWithAgents(ball, landing, fielderMap, batter, bases, outs, {
            collectTimeline: true,
            perceptionNoise: 0,
            random: () => 0.5,
          });
          const tl = result.agentTimeline;
          duration = tl && tl.length > 0 ? tl[tl.length - 1].t : 0;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          allViolations.push({
            severity: "ERROR",
            rule: "クラッシュ",
            detail: msg.slice(0, 200),
            scenario: `${ballName} | ${runnerName} | ${outs}アウト`,
          });
          errors++;
          continue;
        }

        // 結果集計
        resultCounts[result.result] = (resultCounts[result.result] ?? 0) + 1;

        // 検証
        const violations = validateResult(
          result, ballName, runnerName, outs, dir, la, ev, ballType, duration
        );
        for (const v of violations) {
          allViolations.push(v);
          if (v.severity === "ERROR") errors++;
          else warnings++;
        }
      }
    }
  }

  // === 結果出力 ===
  console.log(`テスト数: ${totalTests}`);
  console.log(`エラー: ${errors}  警告: ${warnings}\n`);

  // 結果分布
  console.log("--- 結果分布 ---");
  const sorted = Object.entries(resultCounts).sort((a, b) => b[1] - a[1]);
  for (const [res, count] of sorted) {
    const pct = ((count / totalTests) * 100).toFixed(1);
    console.log(`  ${res.padEnd(18)} ${String(count).padStart(4)} (${pct}%)`);
  }

  // エラー一覧
  if (allViolations.length > 0) {
    console.log("\n--- 違反一覧 ---");

    // まずERROR
    const errorViolations = allViolations.filter(v => v.severity === "ERROR");
    if (errorViolations.length > 0) {
      console.log(`\n[ERROR] ${errorViolations.length}件:`);
      // ルール別にグルーピング
      const byRule = new Map<string, Violation[]>();
      for (const v of errorViolations) {
        const arr = byRule.get(v.rule) ?? [];
        arr.push(v);
        byRule.set(v.rule, arr);
      }
      for (const [rule, vs] of byRule) {
        console.log(`\n  == ${rule} (${vs.length}件) ==`);
        // 最大5件表示
        for (const v of vs.slice(0, 5)) {
          console.log(`    ${v.scenario}`);
          console.log(`      → ${v.detail}`);
        }
        if (vs.length > 5) {
          console.log(`    ... 他${vs.length - 5}件`);
        }
      }
    }

    // WARN
    const warnViolations = allViolations.filter(v => v.severity === "WARN");
    if (warnViolations.length > 0) {
      console.log(`\n[WARN] ${warnViolations.length}件:`);
      const byRule = new Map<string, Violation[]>();
      for (const v of warnViolations) {
        const arr = byRule.get(v.rule) ?? [];
        arr.push(v);
        byRule.set(v.rule, arr);
      }
      for (const [rule, vs] of byRule) {
        console.log(`\n  == ${rule} (${vs.length}件) ==`);
        for (const v of vs.slice(0, 5)) {
          console.log(`    ${v.scenario}`);
          console.log(`      → ${v.detail}`);
        }
        if (vs.length > 5) {
          console.log(`    ... 他${vs.length - 5}件`);
        }
      }
    }
  }

  // プレー時間長いWARNの打球パターン×アウトカウント内訳
  const durationWarns = allViolations.filter(v => v.rule === "プレー時間長い");
  if (durationWarns.length > 0) {
    console.log("\n--- プレー時間長いWARN 内訳 ---");
    const byBall = new Map<string, number[]>();
    for (const v of durationWarns) {
      // scenarioから打球パターン名とアウトカウントを抽出
      const parts = v.scenario.split("|").map(s => s.trim());
      const ballName = parts[0];
      const outsMatch = parts[2]?.match(/(\d)アウト/);
      const outsCount = outsMatch ? parseInt(outsMatch[1]) : -1;
      const arr = byBall.get(ballName) ?? [];
      arr.push(outsCount);
      byBall.set(ballName, arr);
    }
    for (const [ball, outsList] of byBall) {
      const outs0 = outsList.filter(o => o === 0).length;
      const outs1 = outsList.filter(o => o === 1).length;
      const outs2 = outsList.filter(o => o === 2).length;
      console.log(`  ${ball}: ${outsList.length}件 (0アウト:${outs0}, 1アウト:${outs1}, 2アウト:${outs2})`);
    }
  }

  console.log("\n========================================");
  if (errors === 0) {
    console.log("  全テスト通過!");
  } else {
    console.log(`  ${errors}件のエラーを検出`);
  }
  console.log("========================================");

  process.exit(errors > 0 ? 1 : 0);
}

runAllScenarios();
