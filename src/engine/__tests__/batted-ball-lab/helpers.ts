/**
 * 打球計算エンジン テスト用ヘルパー
 *
 * 共通の選手生成関数・統計ユーティリティを提供
 */
import type { Player, BatterAbilities, PitcherAbilities, PitchRepertoire } from "@/models/player";

// ---- デフォルト能力値 ----

const DEFAULT_BATTER_ABILITIES: BatterAbilities = {
  contact: 50,
  power: 50,
  trajectory: 2,
  speed: 50,
  arm: 50,
  fielding: 50,
  catching: 50,
  eye: 50,
};

const DEFAULT_PITCHER_ABILITIES: PitcherAbilities = {
  velocity: 145,
  control: 50,
  pitches: [{ type: "slider", level: 4 }],
  stamina: 60,
  mentalToughness: 50,
  arm: 50,
  fielding: 50,
  catching: 50,
};

// ---- 選手生成 ----

/** テスト用打者を生成。battingの一部だけ上書き可能 */
export function createBatter(
  battingOverrides: Partial<BatterAbilities> = {},
  playerOverrides: Partial<Player> = {}
): Player {
  return {
    id: "test-batter",
    name: "テスト打者",
    age: 25,
    position: "CF",
    isPitcher: false,
    throwHand: "R",
    batSide: "R",
    batting: { ...DEFAULT_BATTER_ABILITIES, ...battingOverrides },
    pitching: null,
    potential: { overall: "C" },
    salary: 500,
    contractYears: 1,
    careerBattingStats: {},
    careerPitchingStats: {},
    ...playerOverrides,
  };
}

/** テスト用投手を生成。pitchingの一部だけ上書き可能 */
export function createPitcher(
  pitchingOverrides: Partial<PitcherAbilities> = {},
  playerOverrides: Partial<Player> = {}
): Player {
  return {
    id: "test-pitcher",
    name: "テスト投手",
    age: 25,
    position: "P",
    isPitcher: true,
    throwHand: "R",
    batSide: "R",
    batting: { ...DEFAULT_BATTER_ABILITIES, contact: 30, power: 20, speed: 30, eye: 30 },
    pitching: { ...DEFAULT_PITCHER_ABILITIES, ...pitchingOverrides },
    potential: { overall: "C" },
    salary: 500,
    contractYears: 1,
    careerBattingStats: {},
    careerPitchingStats: {},
    ...playerOverrides,
  };
}

/** 典型的な打者プロファイルを作成 */
export const BATTER_PROFILES = {
  /** 巧打者: ミート高、パワー低 */
  contactHitter: () => createBatter({ contact: 80, power: 30, eye: 75, trajectory: 1 }),
  /** 強打者: パワー高、ミート低 */
  powerHitter: () => createBatter({ contact: 40, power: 90, trajectory: 4 }),
  /** 俊足巧打: ミート高、走力高 */
  speedster: () => createBatter({ contact: 70, power: 35, speed: 90, trajectory: 1 }),
  /** 長距離砲: パワー最大、弾道4 */
  slugger: () => createBatter({ contact: 50, power: 95, trajectory: 4 }),
  /** 平均的打者 */
  average: () => createBatter(),
  /** 左打者 */
  lefty: () => createBatter({}, { batSide: "L" }),
  /** スイッチヒッター */
  switch: () => createBatter({}, { batSide: "S" }),
  /** 弱打者 */
  weak: () => createBatter({ contact: 25, power: 20, trajectory: 1 }),
} as const;

/** 典型的な投手プロファイルを作成 */
export const PITCHER_PROFILES = {
  /** 速球派 */
  flamethrower: () => createPitcher({ velocity: 160, control: 45, pitches: [{ type: "slider", level: 5 }] }),
  /** 技巧派 */
  craftsman: () => createPitcher({ velocity: 135, control: 80, pitches: [{ type: "slider", level: 4 }, { type: "changeup", level: 5 }] }),
  /** シンカーボーラー */
  sinkerBaller: () => createPitcher({
    velocity: 148,
    pitches: [{ type: "sinker", level: 6 }, { type: "slider", level: 3 }],
  }),
  /** フォークボーラー */
  forkBaller: () => createPitcher({
    velocity: 150,
    pitches: [{ type: "fork", level: 7 }],
  }),
  /** 平均的投手 */
  average: () => createPitcher(),
  /** 多彩な球種 */
  versatile: () => createPitcher({
    velocity: 145,
    control: 60,
    pitches: [
      { type: "slider", level: 4 },
      { type: "curve", level: 3 },
      { type: "fork", level: 5 },
      { type: "changeup", level: 3 },
    ],
  }),
} as const;

// ---- 全ポジション守備ラインナップ ----

/** テスト用の9人守備マップを生成 */
export function createFielderMap(
  overrides: Partial<Record<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9, Partial<BatterAbilities>>> = {}
): Map<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9, Player> {
  const positions: Array<{ pos: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9; name: string; fieldPos: string }> = [
    { pos: 1, name: "投手", fieldPos: "P" },
    { pos: 2, name: "捕手", fieldPos: "C" },
    { pos: 3, name: "一塁手", fieldPos: "1B" },
    { pos: 4, name: "二塁手", fieldPos: "2B" },
    { pos: 5, name: "三塁手", fieldPos: "3B" },
    { pos: 6, name: "遊撃手", fieldPos: "SS" },
    { pos: 7, name: "左翼手", fieldPos: "LF" },
    { pos: 8, name: "中堅手", fieldPos: "CF" },
    { pos: 9, name: "右翼手", fieldPos: "RF" },
  ];

  const map = new Map<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9, Player>();

  for (const { pos, name, fieldPos } of positions) {
    const battingOverrides = overrides[pos] ?? {};
    const player = pos === 1
      ? createPitcher({}, {
          id: `fielder-${pos}`,
          name,
          position: fieldPos as Player["position"],
        })
      : createBatter(battingOverrides, {
          id: `fielder-${pos}`,
          name,
          position: fieldPos as Player["position"],
        });
    map.set(pos, player);
  }

  return map;
}

// ---- 統計ユーティリティ ----

/** 配列の平均値 */
export function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

/** 配列の標準偏差 */
export function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

/** 配列の最小値 */
export function min(arr: number[]): number {
  return Math.min(...arr);
}

/** 配列の最大値 */
export function max(arr: number[]): number {
  return Math.max(...arr);
}

/** パーセンタイル (0-100) */
export function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** ヒストグラム (ビンの範囲と度数を返す) */
export function histogram(arr: number[], bins: number): { range: string; count: number; pct: string }[] {
  const lo = Math.min(...arr);
  const hi = Math.max(...arr);
  const binWidth = (hi - lo) / bins;
  const counts = new Array(bins).fill(0);

  for (const v of arr) {
    const idx = Math.min(Math.floor((v - lo) / binWidth), bins - 1);
    counts[idx]++;
  }

  return counts.map((count, i) => ({
    range: `${(lo + i * binWidth).toFixed(1)}~${(lo + (i + 1) * binWidth).toFixed(1)}`,
    count,
    pct: `${((count / arr.length) * 100).toFixed(1)}%`,
  }));
}

/** 統計サマリーを文字列で返す */
export function statSummary(label: string, arr: number[]): string {
  return [
    `--- ${label} (N=${arr.length}) ---`,
    `  平均: ${mean(arr).toFixed(2)}`,
    `  標準偏差: ${stdDev(arr).toFixed(2)}`,
    `  最小: ${min(arr).toFixed(2)}`,
    `  最大: ${max(arr).toFixed(2)}`,
    `  P5:  ${percentile(arr, 5).toFixed(2)}`,
    `  P25: ${percentile(arr, 25).toFixed(2)}`,
    `  P50: ${percentile(arr, 50).toFixed(2)}`,
    `  P75: ${percentile(arr, 75).toFixed(2)}`,
    `  P95: ${percentile(arr, 95).toFixed(2)}`,
  ].join("\n");
}

/** テーブル形式で整形 */
export function formatTable(headers: string[], rows: (string | number)[][]): string {
  const widths = headers.map((h, i) => {
    const maxRowWidth = Math.max(...rows.map(r => String(r[i]).length));
    return Math.max(h.length, maxRowWidth);
  });

  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join(" | ");
  const separator = widths.map(w => "-".repeat(w)).join("-+-");
  const dataLines = rows.map(row =>
    row.map((cell, i) => {
      const s = typeof cell === "number" ? cell.toFixed(2) : String(cell);
      return typeof cell === "number" ? s.padStart(widths[i]) : s.padEnd(widths[i]);
    }).join(" | ")
  );

  return [headerLine, separator, ...dataLines].join("\n");
}
