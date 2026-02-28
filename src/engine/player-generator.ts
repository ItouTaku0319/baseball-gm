import type {
  Player,
  Position,
  ThrowHand,
  BatSide,
  BatterAbilities,
  PitcherAbilities,
  PitchType,
  PlayerPotential,
} from "@/models";

/**
 * ランダムな選手を生成する
 * ドラフト候補やフリーエージェントの生成に使用
 */

// --- 名前データ (将来的に拡充) ---
const LAST_NAMES = [
  "佐藤","鈴木","高橋","田中","伊藤","渡辺","山本","中村","小林","加藤",
  "吉田","山田","佐々木","松本","井上","木村","林","斎藤","清水","山口",
  "岡田","藤田","前田","石川","中島","大野","藤本","三浦","池田","原",
];

const FIRST_NAMES = [
  "翔太","大輝","健太","拓也","雄太","直樹","達也","和也","康介","裕太",
  "蓮","悠真","颯太","陸","大翔","樹","海翔","陽翔","蒼","律",
];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 能力値をランダム生成 (基準値 ± 幅) */
function randomAbility(base: number, spread: number): number {
  return Math.max(1, Math.min(100, base + randomInt(-spread, spread)));
}

function generateBatterAbilities(overall: number): BatterAbilities {
  const contact = randomAbility(overall, 15);
  const power = randomAbility(overall, 15);
  const trajectoryBase = 1 + (power / 100) * 2.5 + (Math.random() - 0.5) * 1.5;
  const trajectory = Math.max(1, Math.min(4, Math.round(trajectoryBase)));
  return {
    contact,
    power,
    trajectory,
    speed: randomAbility(overall, 15),
    arm: randomAbility(overall, 15),
    fielding: randomAbility(overall, 10),
    catching: randomAbility(overall, 10),
    eye: randomAbility(overall, 15),
    awareness: randomAbility(overall, 10),
  };
}

function generateVelocity(overall: number): number {
  const base = 120 + (overall / 100) * 35;
  const raw = base + randomInt(-8, 8);
  return Math.max(120, Math.min(165, Math.round(raw)));
}

const PITCH_WEIGHTS: { type: PitchType; weight: number }[] = [
  { type: "slider",    weight: 25 },
  { type: "curve",     weight: 15 },
  { type: "fork",      weight: 15 },
  { type: "changeup",  weight: 10 },
  { type: "sinker",    weight: 8  },
  { type: "cutter",    weight: 10 },
  { type: "shoot",     weight: 5  },
  { type: "knuckle",   weight: 1  },
  { type: "screwball", weight: 1  },
  { type: "splitter",  weight: 10 },
];

function generatePitches(overall: number) {
  const count = randomInt(2, 5);
  const selected: PitchType[] = [];

  const pool = [...PITCH_WEIGHTS];
  while (selected.length < count && pool.length > 0) {
    let r = Math.random() * pool.reduce((sum, p) => sum + p.weight, 0);
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].weight;
      if (r <= 0) {
        selected.push(pool[i].type);
        pool.splice(i, 1);
        break;
      }
    }
  }
  return selected.map((type) => ({
    type,
    level: Math.max(1, Math.min(7, Math.round(1 + (overall / 100) * 4 + randomInt(-1, 1)))),
  }));
}

function generatePitcherAbilities(overall: number): PitcherAbilities {
  return {
    velocity: generateVelocity(overall),
    control: randomAbility(overall, 15),
    pitches: generatePitches(overall),
    stamina: randomAbility(overall, 15),
    mentalToughness: randomAbility(overall, 10),
    arm: randomAbility(overall, 15),
    fielding: randomAbility(overall, 10),
    catching: randomAbility(overall, 10),
  };
}

function generatePotential(): PlayerPotential {
  const roll = Math.random();
  let overall: PlayerPotential["overall"];
  if (roll < 0.05) overall = "S";
  else if (roll < 0.15) overall = "A";
  else if (roll < 0.40) overall = "B";
  else if (roll < 0.70) overall = "C";
  else overall = "D";
  return { overall };
}

const POSITIONS: Position[] = ["P","C","1B","2B","3B","SS","LF","CF","RF"];

const ADJACENT_POSITIONS: Record<Position, Position[]> = {
  C: ["1B"],
  "1B": ["3B", "C"],
  "2B": ["SS", "3B"],
  "3B": ["1B", "2B", "SS"],
  SS: ["2B", "3B"],
  LF: ["CF", "RF"],
  CF: ["LF", "RF"],
  RF: ["LF", "CF"],
  P: [],
};

/** ランダムな選手を1人生成 */
export function generatePlayer(options?: {
  forcePitcher?: boolean;
  ageRange?: [number, number];
  overallRange?: [number, number];
}): Player {
  const isPitcher = options?.forcePitcher ?? Math.random() < 0.35;
  const age = randomInt(
    options?.ageRange?.[0] ?? 18,
    options?.ageRange?.[1] ?? 36
  );
  const overall = randomInt(
    options?.overallRange?.[0] ?? 30,
    options?.overallRange?.[1] ?? 75
  );

  const position: Position = isPitcher ? "P" : randomFrom(POSITIONS.filter((p) => p !== "P"));

  let subPositions: Position[] | undefined;
  if (!isPitcher) {
    const adjacent = ADJACENT_POSITIONS[position];
    if (adjacent.length > 0) {
      const roll = Math.random();
      if (roll < 0.10) {
        const shuffled = [...adjacent].sort(() => Math.random() - 0.5);
        subPositions = shuffled.slice(0, 2);
      } else if (roll < 0.40) {
        subPositions = [adjacent[Math.floor(Math.random() * adjacent.length)]];
      }
    }
  }

  return {
    id: crypto.randomUUID(),
    name: `${randomFrom(LAST_NAMES)} ${randomFrom(FIRST_NAMES)}`,
    age,
    position,
    ...(subPositions ? { subPositions } : {}),
    isPitcher,
    throwHand: (Math.random() < 0.75 ? "R" : "L") as ThrowHand,
    batSide: (Math.random() < 0.65 ? "R" : Math.random() < 0.85 ? "L" : "S") as BatSide,
    batting: generateBatterAbilities(isPitcher ? Math.max(20, overall - 20) : overall),
    pitching: isPitcher ? generatePitcherAbilities(overall) : null,
    potential: generatePotential(),
    salary: Math.round((overall * 10 + randomInt(-100, 300)) * (age > 30 ? 1.3 : 1)),
    contractYears: randomInt(1, 4),
    careerBattingStats: {},
    careerPitchingStats: {},
  };
}

/** ドラフト候補を生成 (若い選手) */
export function generateDraftClass(count: number): Player[] {
  return Array.from({ length: count }, () =>
    generatePlayer({
      ageRange: [18, 22],
      overallRange: [25, 65],
    })
  );
}

/** チーム用のロスターを生成 */
export function generateRoster(size = 65): Player[] {
  if (size <= 25) {
    // 旧互換: 25人
    const pitchers = Array.from({ length: 11 }, () =>
      generatePlayer({ forcePitcher: true, overallRange: [35, 75] })
    );
    const batters = Array.from({ length: size - 11 }, () =>
      generatePlayer({ forcePitcher: false, overallRange: [35, 75] })
    );
    return [...pitchers, ...batters];
  }

  // 65人ロスター: 主力層 + 育成層
  const players: Player[] = [];

  // 主力投手 (12人: 先発6 + リリーフ6)
  for (let i = 0; i < 12; i++) {
    players.push(
      generatePlayer({ forcePitcher: true, overallRange: [50, 80], ageRange: [22, 34] })
    );
  }
  // 主力野手 (16人)
  for (let i = 0; i < 16; i++) {
    players.push(
      generatePlayer({ forcePitcher: false, overallRange: [50, 80], ageRange: [22, 34] })
    );
  }
  // 2軍投手 (14人: 若手中心)
  for (let i = 0; i < 14; i++) {
    players.push(
      generatePlayer({ forcePitcher: true, overallRange: [25, 55], ageRange: [18, 28] })
    );
  }
  // 2軍野手 (残り)
  const remaining = size - players.length;
  for (let i = 0; i < remaining; i++) {
    players.push(
      generatePlayer({ forcePitcher: false, overallRange: [25, 55], ageRange: [18, 28] })
    );
  }

  return players;
}
