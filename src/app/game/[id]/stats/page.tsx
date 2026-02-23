"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/game-store";
import { POSITION_NAMES } from "@/models/player";
import type { Position } from "@/models/player";

// ── Sort types ──

type BattingSortBasic = "avg" | "homeRuns" | "rbi" | "stolenBases";
type BattingSortAdv = "ops" | "woba" | "wrcPlus" | "war";
type BattingSort = BattingSortBasic | BattingSortAdv;

type PitchingSortBasic = "era" | "wins" | "strikeouts" | "saves";
type PitchingSortAdv = "fip" | "war" | "k9" | "kPerBb";
type PitchingSort = PitchingSortBasic | PitchingSortAdv;

type FieldingSortKey = "fieldingPct" | "putOuts" | "assists" | "errors";

type LeagueFilter = "myTeam" | "central" | "pacific" | "all";

// ── Row interfaces ──

interface BatterRow {
  playerId: string;
  name: string;
  teamId: string;
  teamShortName: string;
  teamColor: string;
  leagueId: string;
  // basic
  games: number;
  pa: number;
  atBats: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  rbi: number;
  walks: number;
  strikeouts: number;
  stolenBases: number;
  avg: number;
  obp: number;
  slg: number;
  ops: number;
  hitByPitch: number;
  sacrificeFlies: number;
  groundedIntoDP: number;
  // advanced
  iso: number;
  babip: number;
  kPct: number;
  bbPct: number;
  bbPerK: number;
  woba: number;
  wrcPlus: number;
  war: number;
}

interface PitcherRow {
  playerId: string;
  name: string;
  teamId: string;
  teamShortName: string;
  teamColor: string;
  leagueId: string;
  // basic
  games: number;
  wins: number;
  losses: number;
  era: number;
  outs: number;
  ipDisplay: string;
  ip: number;
  strikeouts: number;
  walks: number;
  hits: number;
  homeRunsAllowed: number;
  whip: number;
  saves: number;
  // advanced
  k9: number;
  bb9: number;
  hr9: number;
  kPerBb: number;
  kPct: number;
  bbPct: number;
  fip: number;
  war: number;
}

interface FielderRow {
  playerId: string;
  name: string;
  teamId: string;
  teamShortName: string;
  teamColor: string;
  leagueId: string;
  position: string;
  games: number;
  putOuts: number;
  assists: number;
  errors: number;
  totalChances: number;
  fieldingPct: number;
  rangeFactor: number;
}

// ── wOBA linear weights (MLB standard) ──

const W_BB = 0.69;
const W_HBP = 0.72;
const W_1B = 0.87;
const W_2B = 1.27;
const W_3B = 1.62;
const W_HR = 2.1;
const WOBA_SCALE = 1.157;

// ── Format helpers ──

function fmtRate(val: number): string {
  if (!isFinite(val)) return "---";
  if (val >= 1) return val.toFixed(3);
  return val.toFixed(3).replace(/^0/, "");
}

function fmtPct(val: number): string {
  if (!isFinite(val)) return "---";
  return (val * 100).toFixed(1) + "%";
}

function fmtDec2(val: number): string {
  if (!isFinite(val)) return "---";
  return val.toFixed(2);
}

function fmtDec1(val: number): string {
  if (!isFinite(val)) return "---";
  return val.toFixed(1);
}

function fmtWar(val: number): string {
  if (!isFinite(val)) return "---";
  return val.toFixed(1);
}

function fmtInt(val: number): string {
  return `${val}`;
}

function formatIP(outs: number): string {
  const full = Math.floor(outs / 3);
  const remainder = outs % 3;
  if (remainder === 0) return `${full}`;
  return `${full} ${remainder}/3`;
}

// ══════════════════════════════════════════════════════════
// テーブルスタイル一元管理
// ここだけ変えれば 打撃(基本/応用)・投手(基本/応用) 全テーブルに反映
// ══════════════════════════════════════════════════════════

const S = {
  // ── ヘッダー ──
  thBase:
    "py-2 px-2 whitespace-nowrap text-xs sticky top-0 z-10 border-b-2 border-gray-600",
  thBg: "bg-gray-900",
  thSortActiveBg: "bg-gray-800",
  headerRow: "text-xs uppercase tracking-wider",

  // ── データセル ──
  cell: "py-1.5 px-2 text-right text-gray-100 text-sm",
  cellMono:
    "py-1.5 px-2 text-right text-gray-100 text-sm font-mono tracking-wide",
  highlight: "bg-yellow-400/5 text-yellow-300 font-bold",

  // ── 固定カラム (順位・選手名・チーム) ──
  rankCell: "py-1.5 px-2 font-bold text-sm",
  nameCell: "py-1.5 px-2 font-medium text-white text-sm",
  teamCell: "py-1.5 px-2 text-center text-sm",
  rankColors: ["text-yellow-400", "text-blue-300", "text-amber-600"] as const,
  rankDefault: "text-gray-400",

  // ── 行 ──
  myTeamRow: "bg-blue-900/60 border-l-2 border-l-blue-400",
  evenRow: "bg-gray-900",
  oddRow: "bg-gray-800/70",
  rowBorder: "border-b border-gray-700/30",
  rowBorder5: "border-b-2 border-gray-600/60",
  rowHover: "transition-colors hover:bg-gray-700/50",

  // ── コンテナ ──
  wrapper: "overflow-auto max-h-[600px]",
  table: "w-full whitespace-nowrap",
  empty: "text-center py-8 text-gray-500",
};

/** 行クラスを生成 */
function rowCls(i: number, isMyTeam: boolean): string {
  const bg = isMyTeam ? S.myTeamRow : i % 2 === 1 ? S.oddRow : S.evenRow;
  const border = (i + 1) % 5 === 0 ? S.rowBorder5 : S.rowBorder;
  return `${border} ${S.rowHover} ${bg}`;
}

// ── 共通セルコンポーネント ──

function SortTh({
  label,
  sortKey,
  current,
  onSort,
}: {
  label: string;
  sortKey: string;
  current: string;
  onSort: (k: string) => void;
}) {
  const active = current === sortKey;
  return (
    <th
      className={`${S.thBase} text-right cursor-pointer select-none hover:text-blue-300 ${
        active
          ? `${S.thSortActiveBg} text-yellow-400`
          : `${S.thBg} text-gray-400`
      }`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {active ? " \u25BC" : " \u25BD"}
    </th>
  );
}

function Th({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  return (
    <th
      className={`${S.thBase} ${S.thBg} text-right text-gray-400 ${className}`}
    >
      {children}
    </th>
  );
}

function RankTh() {
  return <th className={`${S.thBase} ${S.thBg} text-left w-8`}>#</th>;
}

function NameTh() {
  return <th className={`${S.thBase} ${S.thBg} text-left`}>選手名</th>;
}

function TeamTh() {
  return <th className={`${S.thBase} ${S.thBg} text-center`}>チーム</th>;
}

function RankCell({ rank }: { rank: number }) {
  const color =
    rank <= 3 ? S.rankColors[rank - 1] : S.rankDefault;
  return <td className={`${S.rankCell} ${color}`}>{rank}</td>;
}

function TeamCell({
  r,
}: {
  r: { teamColor: string; teamShortName: string };
}) {
  return (
    <td className={S.teamCell}>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: r.teamColor }}
        />
        <span className="text-gray-300 text-sm">{r.teamShortName}</span>
      </span>
    </td>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className={S.empty}>
        該当する選手がいません
      </td>
    </tr>
  );
}

// ── Main component ──

export default function StatsPage() {
  const params = useParams();
  const { game, loadGame } = useGameStore();
  const [tab, setTab] = useState<"batting" | "pitching" | "fielding">("batting");
  const [subTab, setSubTab] = useState<"basic" | "advanced">("basic");
  const [leagueFilter, setLeagueFilter] = useState<LeagueFilter>("myTeam");
  const [battingSort, setBattingSort] = useState<BattingSort>("avg");
  const [pitchingSort, setPitchingSort] = useState<PitchingSort>("era");
  const [fieldingSort, setFieldingSort] = useState<FieldingSortKey>("fieldingPct");
  const [qualifiedOnly, setQualifiedOnly] = useState(true);

  useEffect(() => {
    if (!game && params.id) loadGame(params.id as string);
  }, [game, params.id, loadGame]);

  // 自チームのリーグ
  const myLeagueId = useMemo(() => {
    if (!game) return "";
    for (const league of game.currentSeason.leagues) {
      if (league.teams.includes(game.myTeamId)) return league.id;
    }
    return "";
  }, [game]);

  const teamLeagueMap = useMemo(() => {
    if (!game) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const league of game.currentSeason.leagues) {
      for (const teamId of league.teams) {
        map.set(teamId, league.id);
      }
    }
    return map;
  }, [game]);

  const teamGames = useMemo(() => {
    if (!game) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const [teamId, record] of Object.entries(
      game.currentSeason.standings
    )) {
      map.set(teamId, record.wins + record.losses + record.draws);
    }
    return map;
  }, [game]);

  // ── Collect batting stats ──

  const { batters, lgWoba, lgRunsPerPA } = useMemo(() => {
    if (!game)
      return { batters: [] as BatterRow[], lgWoba: 0, lgRunsPerPA: 0 };
    const year = game.currentSeason.year;
    const rows: BatterRow[] = [];

    // First pass: collect raw data
    let totalWobaNum = 0;
    let totalPA = 0;

    for (const [teamId, team] of Object.entries(game.teams)) {
      for (const player of team.roster) {
        const s = player.careerBattingStats[year];
        if (!s || s.atBats === 0) continue;

        const singles = s.hits - s.doubles - s.triples - s.homeRuns;
        const pa = s.atBats + s.walks + (s.hitByPitch || 0) + (s.sacrificeFlies || 0);
        const totalBases =
          singles + s.doubles * 2 + s.triples * 3 + s.homeRuns * 4;
        const avg = s.hits / s.atBats;
        const obp = pa > 0 ? (s.hits + s.walks + (s.hitByPitch || 0)) / pa : 0;
        const slg = totalBases / s.atBats;
        const ops = obp + slg;
        const iso = slg - avg;
        const babipDenom = s.atBats - s.strikeouts - s.homeRuns;
        const babip =
          babipDenom > 0 ? (s.hits - s.homeRuns) / babipDenom : 0;
        const kPct = pa > 0 ? s.strikeouts / pa : 0;
        const bbPct = pa > 0 ? s.walks / pa : 0;
        const bbPerK = s.strikeouts > 0 ? s.walks / s.strikeouts : 0;

        const wobaNum =
          W_BB * s.walks +
          W_HBP * (s.hitByPitch || 0) +
          W_1B * singles +
          W_2B * s.doubles +
          W_3B * s.triples +
          W_HR * s.homeRuns;
        const woba = pa > 0 ? wobaNum / pa : 0;

        totalWobaNum += wobaNum;
        totalPA += pa;

        rows.push({
          playerId: player.id,
          name: player.name,
          teamId,
          teamShortName: team.shortName,
          teamColor: team.color,
          leagueId: teamLeagueMap.get(teamId) || "",
          games: s.games,
          pa,
          atBats: s.atBats,
          hits: s.hits,
          doubles: s.doubles,
          triples: s.triples,
          homeRuns: s.homeRuns,
          rbi: s.rbi,
          walks: s.walks,
          strikeouts: s.strikeouts,
          stolenBases: s.stolenBases,
          avg,
          obp,
          slg,
          ops,
          iso,
          babip,
          kPct,
          bbPct,
          bbPerK,
          woba,
          hitByPitch: s.hitByPitch || 0,
          sacrificeFlies: s.sacrificeFlies || 0,
          groundedIntoDP: s.groundedIntoDP || 0,
          wrcPlus: 0, // computed below
          war: 0, // computed below
        });
      }
    }

    // League averages
    const lgW = totalPA > 0 ? totalWobaNum / totalPA : 0;
    const lgRPA = lgW / WOBA_SCALE;

    // Second pass: compute wRC+ and WAR
    for (const r of rows) {
      const wRAA = ((r.woba - lgW) / WOBA_SCALE) * r.pa;
      r.wrcPlus =
        lgRPA > 0
          ? (((r.woba - lgW) / WOBA_SCALE + lgRPA) / lgRPA) * 100
          : 100;
      const replacement = (r.pa / 600) * 20;
      r.war = (wRAA + replacement) / 10;
    }

    return { batters: rows, lgWoba: lgW, lgRunsPerPA: lgRPA };
  }, [game, teamLeagueMap]);

  // ── Collect pitching stats ──

  const pitchers = useMemo(() => {
    if (!game) return [] as PitcherRow[];
    const year = game.currentSeason.year;
    const rows: PitcherRow[] = [];

    // First pass: league totals for FIP constant
    let lgIP = 0;
    let lgER = 0;
    let lgHR = 0;
    let lgBBp = 0;
    let lgKp = 0;

    for (const team of Object.values(game.teams)) {
      for (const player of team.roster) {
        const s = player.careerPitchingStats[year];
        if (!s || s.games === 0) continue;
        const ip = s.inningsPitched / 3;
        lgIP += ip;
        lgER += s.earnedRuns;
        lgHR += s.homeRunsAllowed;
        lgBBp += s.walks;
        lgKp += s.strikeouts;
      }
    }

    const lgERA = lgIP > 0 ? (lgER / lgIP) * 9 : 4.0;
    const lgFIPraw =
      lgIP > 0 ? (13 * lgHR + 3 * lgBBp - 2 * lgKp) / lgIP : 0;
    const cFIP = lgERA - lgFIPraw;

    // Second pass: compute per-pitcher stats
    for (const [teamId, team] of Object.entries(game.teams)) {
      for (const player of team.roster) {
        const s = player.careerPitchingStats[year];
        if (!s || s.games === 0) continue;
        const ip = s.inningsPitched / 3;
        const era = ip > 0 ? (s.earnedRuns / ip) * 9 : 0;
        const whip = ip > 0 ? (s.walks + s.hits) / ip : 0;
        const k9 = ip > 0 ? (s.strikeouts / ip) * 9 : 0;
        const bb9 = ip > 0 ? (s.walks / ip) * 9 : 0;
        const hr9 = ip > 0 ? (s.homeRunsAllowed / ip) * 9 : 0;
        const kPerBb = s.walks > 0 ? s.strikeouts / s.walks : 0;
        // Estimate TBF (total batters faced)
        const tbf = s.inningsPitched + s.hits + s.walks;
        const kPct = tbf > 0 ? s.strikeouts / tbf : 0;
        const bbPct = tbf > 0 ? s.walks / tbf : 0;
        const fipRaw =
          ip > 0
            ? (13 * s.homeRunsAllowed + 3 * s.walks - 2 * s.strikeouts) /
              ip
            : 0;
        const fip = fipRaw + cFIP;
        // Pitching WAR (simplified)
        const repLevel = lgERA * 1.1;
        const runsSaved = ip > 0 ? ((repLevel - fip) / 9) * ip : 0;
        const war = runsSaved / 10;

        rows.push({
          playerId: player.id,
          name: player.name,
          teamId,
          teamShortName: team.shortName,
          teamColor: team.color,
          leagueId: teamLeagueMap.get(teamId) || "",
          games: s.games,
          wins: s.wins,
          losses: s.losses,
          era,
          outs: s.inningsPitched,
          ipDisplay: formatIP(s.inningsPitched),
          ip,
          strikeouts: s.strikeouts,
          walks: s.walks,
          hits: s.hits,
          homeRunsAllowed: s.homeRunsAllowed,
          whip,
          saves: s.saves,
          k9,
          bb9,
          hr9,
          kPerBb,
          kPct,
          bbPct,
          fip,
          war,
        });
      }
    }
    return rows;
  }, [game, teamLeagueMap]);

  // ── Collect fielding stats ──

  const fielders = useMemo(() => {
    if (!game) return [] as FielderRow[];
    const year = game.currentSeason.year;
    const rows: FielderRow[] = [];

    for (const [teamId, team] of Object.entries(game.teams)) {
      for (const player of team.roster) {
        const s = player.careerBattingStats[year];
        if (!s || s.games === 0) continue;

        const po = s.putOuts ?? 0;
        const a = s.assists ?? 0;
        const e = s.errors ?? 0;
        const tc = po + a + e;

        if (tc === 0) continue;

        rows.push({
          playerId: player.id,
          name: player.name,
          teamId,
          teamShortName: team.shortName,
          teamColor: team.color,
          leagueId: teamLeagueMap.get(teamId) || "",
          position: player.position,
          games: s.games,
          putOuts: po,
          assists: a,
          errors: e,
          totalChances: tc,
          fieldingPct: tc > 0 ? (po + a) / tc : 0,
          rangeFactor: s.games > 0 ? ((po + a) / s.games) * 9 : 0,
        });
      }
    }
    return rows;
  }, [game, teamLeagueMap]);

  // ── Qualification checks ──

  const isQualifiedBatter = (r: BatterRow) => {
    const g = teamGames.get(r.teamId) || 0;
    return r.pa >= Math.floor(g * 3.1);
  };

  const isQualifiedPitcher = (r: PitcherRow) => {
    const g = teamGames.get(r.teamId) || 0;
    return r.outs >= g * 3;
  };

  // ── Filter & sort ──

  const applyLeagueFilter = <T extends { teamId: string; leagueId: string }>(
    rows: T[]
  ): T[] => {
    switch (leagueFilter) {
      case "myTeam":
        return rows.filter((r) => r.teamId === game?.myTeamId);
      case "central":
      case "pacific":
        return rows.filter((r) => r.leagueId === leagueFilter);
      default:
        return rows;
    }
  };

  const filteredBatters = useMemo(() => {
    let rows = applyLeagueFilter(batters);
    if (qualifiedOnly && (battingSort === "avg" || battingSort === "woba" || battingSort === "wrcPlus")) {
      rows = rows.filter(isQualifiedBatter);
    }
    const asc = false; // all batting sorts are descending
    return [...rows].sort((a, b) => {
      const va = a[battingSort as keyof BatterRow] as number;
      const vb = b[battingSort as keyof BatterRow] as number;
      return asc ? va - vb : vb - va;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batters, leagueFilter, qualifiedOnly, battingSort, teamGames, game?.myTeamId]);

  const filteredPitchers = useMemo(() => {
    let rows = applyLeagueFilter(pitchers);
    if (qualifiedOnly && (pitchingSort === "era" || pitchingSort === "fip")) {
      rows = rows.filter(isQualifiedPitcher);
    }
    const ascending = pitchingSort === "era" || pitchingSort === "fip";
    return [...rows].sort((a, b) => {
      const va = a[pitchingSort as keyof PitcherRow] as number;
      const vb = b[pitchingSort as keyof PitcherRow] as number;
      return ascending ? va - vb : vb - va;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitchers, leagueFilter, qualifiedOnly, pitchingSort, teamGames, game?.myTeamId]);

  const filteredFielders = useMemo(() => {
    const rows = applyLeagueFilter(fielders);
    const ascending = fieldingSort === "errors";
    return [...rows].sort((a, b) => {
      const va = a[fieldingSort as keyof FielderRow] as number;
      const vb = b[fieldingSort as keyof FielderRow] as number;
      return ascending ? va - vb : vb - va;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fielders, leagueFilter, fieldingSort, game?.myTeamId]);

  // ── Title leaders ──

  const titles = useMemo(() => {
    const qB = batters.filter(isQualifiedBatter);
    const qP = pitchers.filter(isQualifiedPitcher);

    const max = <T,>(arr: T[], key: (i: T) => number): T | null =>
      arr.length === 0
        ? null
        : arr.reduce((b, r) => (key(r) > key(b) ? r : b));
    const min = <T,>(arr: T[], key: (i: T) => number): T | null =>
      arr.length === 0
        ? null
        : arr.reduce((b, r) => (key(r) < key(b) ? r : b));

    const val = <T extends BatterRow | PitcherRow>(
      leader: T | null,
      fmt: (l: T) => string
    ) => (leader ? fmt(leader) : "---");

    return [
      {
        label: "首位打者",
        player: max(qB, (r) => r.avg),
        value: val(max(qB, (r) => r.avg), (l) => fmtRate(l.avg)),
      },
      {
        label: "本塁打王",
        player: max(batters, (r) => r.homeRuns),
        value: val(max(batters, (r) => r.homeRuns), (l) => fmtInt(l.homeRuns)),
      },
      {
        label: "打点王",
        player: max(batters, (r) => r.rbi),
        value: val(max(batters, (r) => r.rbi), (l) => fmtInt(l.rbi)),
      },
      {
        label: "盗塁王",
        player: max(batters, (r) => r.stolenBases),
        value: val(max(batters, (r) => r.stolenBases), (l) =>
          fmtInt(l.stolenBases)
        ),
      },
      {
        label: "最優秀防御率",
        player: min(qP, (r) => r.era),
        value: val(min(qP, (r) => r.era), (l) => fmtDec2(l.era)),
      },
      {
        label: "最多勝",
        player: max(pitchers, (r) => r.wins),
        value: val(max(pitchers, (r) => r.wins), (l) => fmtInt(l.wins)),
      },
      {
        label: "最多奪三振",
        player: max(pitchers, (r) => r.strikeouts),
        value: val(max(pitchers, (r) => r.strikeouts), (l) =>
          fmtInt(l.strikeouts)
        ),
      },
      {
        label: "最多セーブ",
        player: max(pitchers, (r) => r.saves),
        value: val(max(pitchers, (r) => r.saves), (l) => fmtInt(l.saves)),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batters, pitchers, teamGames]);

  // ── Sub-tab switch handler ──

  const handleSubTab = (st: "basic" | "advanced") => {
    setSubTab(st);
    if (tab === "batting") {
      setBattingSort(st === "basic" ? "avg" : "war");
    } else {
      setPitchingSort(st === "basic" ? "era" : "fip");
    }
  };

  const handleMainTab = (t: "batting" | "pitching" | "fielding") => {
    setTab(t);
    setSubTab("basic");
    if (t === "batting") setBattingSort("avg");
    else if (t === "pitching") setPitchingSort("era");
    else setFieldingSort("fieldingPct");
  };

  if (!game) return <div className="p-8 text-gray-400">読み込み中...</div>;

  const hasStats = batters.length > 0 || pitchers.length > 0;

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* ヘッダー */}
      <div className="flex items-center gap-4 mb-6">
        <Link
          href={`/game/${params.id}`}
          className="text-gray-400 hover:text-white"
        >
          &larr; 戻る
        </Link>
        <h1 className="text-2xl font-bold">成績</h1>
        <span className="text-gray-500 text-sm">
          {game.currentSeason.year}年シーズン
        </span>
      </div>

      {!hasStats ? (
        <div className="p-8 bg-gray-800/50 rounded-lg border border-dashed border-gray-600 text-center">
          <p className="text-gray-400 text-lg mb-2">データなし</p>
          <p className="text-gray-500 text-sm">
            シーズンが開始されると成績データが表示されます。
          </p>
        </div>
      ) : (
        <>
          {/* タイトル争い */}
          <div className="mb-8">
            <h2 className="text-lg font-semibold mb-3 text-yellow-400">
              タイトル争い
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {titles.map((t) => {
                const p = t.player as (BatterRow | PitcherRow) | null;
                return (
                  <div
                    key={t.label}
                    className="bg-gray-800 rounded-lg p-4 border border-gray-700"
                  >
                    <div className="text-xs text-gray-400 mb-2 tracking-wide">
                      {t.label}
                    </div>
                    <div
                      className="text-2xl font-bold text-white tracking-wider"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {t.value}
                    </div>
                    {p ? (
                      <div className="flex items-center gap-1.5 mt-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: p.teamColor }}
                        />
                        <span className="text-sm text-gray-200 truncate">
                          {p.name}
                        </span>
                        <span className="text-xs text-gray-500 ml-auto flex-shrink-0">
                          {p.teamShortName}
                        </span>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500 mt-2">---</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* メインタブ */}
          <div className="flex gap-1 mb-0">
            {(
              [
                ["batting", "打撃成績"],
                ["pitching", "投手成績"],
                ["fielding", "守備成績"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => handleMainTab(key)}
                className={`px-5 py-2.5 rounded-t-lg font-semibold transition-colors ${
                  tab === key
                    ? "bg-gray-800 text-white border-t-2 border-x border-blue-400 border-x-gray-600"
                    : "bg-gray-900 text-gray-400 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* サブタブ + フィルター */}
          <div className="bg-gray-800 border-x border-gray-600 px-4 pt-3 pb-3 flex flex-wrap items-center gap-3">
            {/* 基本 / セイバー（守備タブでは非表示） */}
            {tab !== "fielding" && (
              <div className="flex bg-gray-900 rounded-lg p-0.5">
                {(
                  [
                    ["basic", "基本"],
                    ["advanced", "セイバー"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => handleSubTab(key)}
                    className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                      subTab === key
                        ? "bg-gray-700 text-white"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {tab !== "fielding" && <div className="w-px h-5 bg-gray-700" />}

            {/* リーグフィルター */}
            <div className="flex gap-1">
              {(
                [
                  ["myTeam", "自チーム"],
                  ["central", "セ・リーグ"],
                  ["pacific", "パ・リーグ"],
                  ["all", "全体"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setLeagueFilter(value)}
                  className={`px-3 py-1 rounded text-sm transition-colors ${
                    leagueFilter === value
                      ? value === "myTeam"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-600 text-white"
                      : "bg-gray-900 text-gray-400 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab !== "fielding" && (
              <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer ml-auto">
                <input
                  type="checkbox"
                  checked={qualifiedOnly}
                  onChange={(e) => setQualifiedOnly(e.target.checked)}
                  className="rounded bg-gray-700 border-gray-600"
                />
                規定到達のみ
              </label>
            )}
          </div>

          {/* テーブル */}
          <div className="border-x border-b border-gray-600 rounded-b-lg overflow-hidden">
            {tab === "batting" ? (
              subTab === "basic" ? (
                <BattingBasicTable
                  rows={filteredBatters}
                  sort={battingSort as BattingSortBasic}
                  onSort={(s) => setBattingSort(s)}
                  myTeamId={game.myTeamId}
                />
              ) : (
                <BattingAdvTable
                  rows={filteredBatters}
                  sort={battingSort as BattingSortAdv}
                  onSort={(s) => setBattingSort(s)}
                  myTeamId={game.myTeamId}
                />
              )
            ) : tab === "pitching" ? (
              subTab === "basic" ? (
                <PitchingBasicTable
                  rows={filteredPitchers}
                  sort={pitchingSort as PitchingSortBasic}
                  onSort={(s) => setPitchingSort(s)}
                  myTeamId={game.myTeamId}
                />
              ) : (
                <PitchingAdvTable
                  rows={filteredPitchers}
                  sort={pitchingSort as PitchingSortAdv}
                  onSort={(s) => setPitchingSort(s)}
                  myTeamId={game.myTeamId}
                />
              )
            ) : (
              <FieldingTable
                rows={filteredFielders}
                sort={fieldingSort}
                onSort={(s) => setFieldingSort(s)}
                myTeamId={game.myTeamId}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── 打撃成績 (基本) ──

function BattingBasicTable({
  rows,
  sort,
  onSort,
  myTeamId,
}: {
  rows: BatterRow[];
  sort: BattingSortBasic;
  onSort: (s: BattingSortBasic) => void;
  myTeamId: string;
}) {
  return (
    <div className={S.wrapper}>
      <table className={S.table} style={{ fontVariantNumeric: "tabular-nums" }}>
        <thead>
          <tr className={S.headerRow}>
            <RankTh />
            <NameTh />
            <TeamTh />
            <Th>試合</Th>
            <Th>打席</Th>
            <Th>打数</Th>
            <Th>安打</Th>
            <SortTh label="打率" sortKey="avg" current={sort} onSort={(k) => onSort(k as BattingSortBasic)} />
            <SortTh label="本塁打" sortKey="homeRuns" current={sort} onSort={(k) => onSort(k as BattingSortBasic)} />
            <SortTh label="打点" sortKey="rbi" current={sort} onSort={(k) => onSort(k as BattingSortBasic)} />
            <SortTh label="盗塁" sortKey="stolenBases" current={sort} onSort={(k) => onSort(k as BattingSortBasic)} />
            <Th>四球</Th>
            <Th>三振</Th>
            <Th>出塁率</Th>
            <Th>長打率</Th>
            <Th>OPS</Th>
            <Th>死球</Th>
            <Th>犠飛</Th>
            <Th>併殺</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow cols={19} />
          ) : (
            rows.map((r, i) => (
              <tr key={r.playerId} className={rowCls(i, r.teamId === myTeamId)}>
                <RankCell rank={i + 1} />
                <td className={S.nameCell}>{r.name}</td>
                <TeamCell r={r} />
                <td className={S.cell}>{r.games}</td>
                <td className={S.cell}>{r.pa}</td>
                <td className={S.cell}>{r.atBats}</td>
                <td className={S.cell}>{r.hits}</td>
                <td className={`${S.cellMono} ${sort === "avg" ? S.highlight : ""}`}>{fmtRate(r.avg)}</td>
                <td className={`${S.cell} ${sort === "homeRuns" ? S.highlight : ""}`}>{r.homeRuns}</td>
                <td className={`${S.cell} ${sort === "rbi" ? S.highlight : ""}`}>{r.rbi}</td>
                <td className={`${S.cell} ${sort === "stolenBases" ? S.highlight : ""}`}>{r.stolenBases}</td>
                <td className={S.cell}>{r.walks}</td>
                <td className={S.cell}>{r.strikeouts}</td>
                <td className={S.cellMono}>{fmtRate(r.obp)}</td>
                <td className={S.cellMono}>{fmtRate(r.slg)}</td>
                <td className={S.cellMono}>{fmtRate(r.ops)}</td>
                <td className={S.cell}>{r.hitByPitch}</td>
                <td className={S.cell}>{r.sacrificeFlies}</td>
                <td className={S.cell}>{r.groundedIntoDP}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── 打撃成績 (セイバー) ──

function BattingAdvTable({
  rows,
  sort,
  onSort,
  myTeamId,
}: {
  rows: BatterRow[];
  sort: BattingSortAdv;
  onSort: (s: BattingSortAdv) => void;
  myTeamId: string;
}) {
  return (
    <div className={S.wrapper}>
      <table className={S.table} style={{ fontVariantNumeric: "tabular-nums" }}>
        <thead>
          <tr className={S.headerRow}>
            <RankTh />
            <NameTh />
            <TeamTh />
            <Th>打席</Th>
            <Th>K%</Th>
            <Th>BB%</Th>
            <Th>BB/K</Th>
            <Th>ISO</Th>
            <Th>BABIP</Th>
            <SortTh label="OPS" sortKey="ops" current={sort} onSort={(k) => onSort(k as BattingSortAdv)} />
            <SortTh label="wOBA" sortKey="woba" current={sort} onSort={(k) => onSort(k as BattingSortAdv)} />
            <SortTh label="wRC+" sortKey="wrcPlus" current={sort} onSort={(k) => onSort(k as BattingSortAdv)} />
            <SortTh label="WAR" sortKey="war" current={sort} onSort={(k) => onSort(k as BattingSortAdv)} />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow cols={13} />
          ) : (
            rows.map((r, i) => (
              <tr key={r.playerId} className={rowCls(i, r.teamId === myTeamId)}>
                <RankCell rank={i + 1} />
                <td className={S.nameCell}>{r.name}</td>
                <TeamCell r={r} />
                <td className={S.cell}>{r.pa}</td>
                <td className={S.cell}>{fmtPct(r.kPct)}</td>
                <td className={S.cell}>{fmtPct(r.bbPct)}</td>
                <td className={S.cellMono}>{fmtDec2(r.bbPerK)}</td>
                <td className={S.cellMono}>{fmtRate(r.iso)}</td>
                <td className={S.cellMono}>{fmtRate(r.babip)}</td>
                <td className={`${S.cellMono} ${sort === "ops" ? S.highlight : ""}`}>{fmtRate(r.ops)}</td>
                <td className={`${S.cellMono} ${sort === "woba" ? S.highlight : ""}`}>{fmtRate(r.woba)}</td>
                <td className={`${S.cell} ${sort === "wrcPlus" ? S.highlight : ""}`}>{Math.round(r.wrcPlus)}</td>
                <td className={`${S.cellMono} ${sort === "war" ? S.highlight : ""}`}>{fmtWar(r.war)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── 投手成績 (基本) ──

function PitchingBasicTable({
  rows,
  sort,
  onSort,
  myTeamId,
}: {
  rows: PitcherRow[];
  sort: PitchingSortBasic;
  onSort: (s: PitchingSortBasic) => void;
  myTeamId: string;
}) {
  return (
    <div className={S.wrapper}>
      <table className={S.table} style={{ fontVariantNumeric: "tabular-nums" }}>
        <thead>
          <tr className={S.headerRow}>
            <RankTh />
            <NameTh />
            <TeamTh />
            <Th>試合</Th>
            <SortTh label="勝" sortKey="wins" current={sort} onSort={(k) => onSort(k as PitchingSortBasic)} />
            <Th>敗</Th>
            <SortTh label="防御率" sortKey="era" current={sort} onSort={(k) => onSort(k as PitchingSortBasic)} />
            <Th>投球回</Th>
            <SortTh label="奪三振" sortKey="strikeouts" current={sort} onSort={(k) => onSort(k as PitchingSortBasic)} />
            <Th>四球</Th>
            <Th>被安打</Th>
            <Th>被本塁打</Th>
            <Th>WHIP</Th>
            <SortTh label="セーブ" sortKey="saves" current={sort} onSort={(k) => onSort(k as PitchingSortBasic)} />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow cols={14} />
          ) : (
            rows.map((r, i) => (
              <tr key={r.playerId} className={rowCls(i, r.teamId === myTeamId)}>
                <RankCell rank={i + 1} />
                <td className={S.nameCell}>{r.name}</td>
                <TeamCell r={r} />
                <td className={S.cell}>{r.games}</td>
                <td className={`${S.cell} ${sort === "wins" ? S.highlight : ""}`}>{r.wins}</td>
                <td className={S.cell}>{r.losses}</td>
                <td className={`${S.cellMono} ${sort === "era" ? S.highlight : ""}`}>{fmtDec2(r.era)}</td>
                <td className={S.cell}>{r.ipDisplay}</td>
                <td className={`${S.cell} ${sort === "strikeouts" ? S.highlight : ""}`}>{r.strikeouts}</td>
                <td className={S.cell}>{r.walks}</td>
                <td className={S.cell}>{r.hits}</td>
                <td className={S.cell}>{r.homeRunsAllowed}</td>
                <td className={S.cellMono}>{fmtDec2(r.whip)}</td>
                <td className={`${S.cell} ${sort === "saves" ? S.highlight : ""}`}>{r.saves}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── 投手成績 (セイバー) ──

function PitchingAdvTable({
  rows,
  sort,
  onSort,
  myTeamId,
}: {
  rows: PitcherRow[];
  sort: PitchingSortAdv;
  onSort: (s: PitchingSortAdv) => void;
  myTeamId: string;
}) {
  return (
    <div className={S.wrapper}>
      <table className={S.table} style={{ fontVariantNumeric: "tabular-nums" }}>
        <thead>
          <tr className={S.headerRow}>
            <RankTh />
            <NameTh />
            <TeamTh />
            <Th>投球回</Th>
            <SortTh label="K/9" sortKey="k9" current={sort} onSort={(k) => onSort(k as PitchingSortAdv)} />
            <Th>BB/9</Th>
            <Th>HR/9</Th>
            <SortTh label="K/BB" sortKey="kPerBb" current={sort} onSort={(k) => onSort(k as PitchingSortAdv)} />
            <Th>K%</Th>
            <Th>BB%</Th>
            <SortTh label="FIP" sortKey="fip" current={sort} onSort={(k) => onSort(k as PitchingSortAdv)} />
            <Th>WHIP</Th>
            <SortTh label="WAR" sortKey="war" current={sort} onSort={(k) => onSort(k as PitchingSortAdv)} />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow cols={13} />
          ) : (
            rows.map((r, i) => (
              <tr key={r.playerId} className={rowCls(i, r.teamId === myTeamId)}>
                <RankCell rank={i + 1} />
                <td className={S.nameCell}>{r.name}</td>
                <TeamCell r={r} />
                <td className={S.cell}>{r.ipDisplay}</td>
                <td className={`${S.cellMono} ${sort === "k9" ? S.highlight : ""}`}>{fmtDec2(r.k9)}</td>
                <td className={S.cellMono}>{fmtDec2(r.bb9)}</td>
                <td className={S.cellMono}>{fmtDec2(r.hr9)}</td>
                <td className={`${S.cellMono} ${sort === "kPerBb" ? S.highlight : ""}`}>{fmtDec2(r.kPerBb)}</td>
                <td className={S.cell}>{fmtPct(r.kPct)}</td>
                <td className={S.cell}>{fmtPct(r.bbPct)}</td>
                <td className={`${S.cellMono} ${sort === "fip" ? S.highlight : ""}`}>{fmtDec2(r.fip)}</td>
                <td className={S.cellMono}>{fmtDec2(r.whip)}</td>
                <td className={`${S.cellMono} ${sort === "war" ? S.highlight : ""}`}>{fmtWar(r.war)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── 守備成績 ──

function FieldingTable({
  rows,
  sort,
  onSort,
  myTeamId,
}: {
  rows: FielderRow[];
  sort: FieldingSortKey;
  onSort: (s: FieldingSortKey) => void;
  myTeamId: string;
}) {
  return (
    <div className={S.wrapper}>
      <table className={S.table} style={{ fontVariantNumeric: "tabular-nums" }}>
        <thead>
          <tr className={S.headerRow}>
            <RankTh />
            <NameTh />
            <TeamTh />
            <Th>守備</Th>
            <Th>試合</Th>
            <SortTh label="刺殺" sortKey="putOuts" current={sort} onSort={(k) => onSort(k as FieldingSortKey)} />
            <SortTh label="補殺" sortKey="assists" current={sort} onSort={(k) => onSort(k as FieldingSortKey)} />
            <SortTh label="失策" sortKey="errors" current={sort} onSort={(k) => onSort(k as FieldingSortKey)} />
            <Th>守備機会</Th>
            <SortTh label="守備率" sortKey="fieldingPct" current={sort} onSort={(k) => onSort(k as FieldingSortKey)} />
            <Th>RF</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow cols={11} />
          ) : (
            rows.map((r, i) => (
              <tr key={r.playerId} className={rowCls(i, r.teamId === myTeamId)}>
                <RankCell rank={i + 1} />
                <td className={S.nameCell}>{r.name}</td>
                <TeamCell r={r} />
                <td className={`${S.cell} text-center`}>{POSITION_NAMES[r.position as Position] ?? r.position}</td>
                <td className={S.cell}>{r.games}</td>
                <td className={`${S.cell} ${sort === "putOuts" ? S.highlight : ""}`}>{r.putOuts}</td>
                <td className={`${S.cell} ${sort === "assists" ? S.highlight : ""}`}>{r.assists}</td>
                <td className={`${S.cell} ${sort === "errors" ? S.highlight : ""}`}>{r.errors}</td>
                <td className={S.cell}>{r.totalChances}</td>
                <td className={`${S.cellMono} ${sort === "fieldingPct" ? S.highlight : ""}`}>{fmtRate(r.fieldingPct)}</td>
                <td className={S.cellMono}>{fmtDec2(r.rangeFactor)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
