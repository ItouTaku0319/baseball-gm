"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/store/game-store";
import { simulateGame } from "@/engine/simulation";
import type { AtBatLog, GameResult } from "@/models/league";
import type { GameState } from "@/models/game-state";
import type { Player } from "@/models/player";
import { POSITION_NAMES } from "@/models/player";
import { PlayerAbilityCard } from "@/components/player-ability-card";
import { BattedBallPopup } from "@/components/batted-ball-trajectory";

// ---- 共有定数・ユーティリティ ----

const resultNamesJa: Record<string, string> = {
  single: "ヒット",
  double: "ツーベース",
  triple: "スリーベース",
  homerun: "ホームラン",
  strikeout: "三振",
  walk: "四球",
  hitByPitch: "死球",
  groundout: "ゴロアウト",
  flyout: "フライアウト",
  lineout: "ライナーアウト",
  popout: "ポップアウト",
  doublePlay: "併殺打",
  sacrificeFly: "犠牲フライ",
  fieldersChoice: "フィルダースチョイス",
  infieldHit: "内野安打",
  error: "エラー出塁",
};

const battedBallNamesJa: Record<string, string> = {
  ground_ball: "ゴロ",
  fly_ball: "フライ",
  line_drive: "ライナー",
  popup: "ポップフライ",
};

const posNamesJa: Record<number, string> = {
  1: "投", 2: "捕", 3: "一", 4: "二", 5: "三", 6: "遊", 7: "左", 8: "中", 9: "右",
};

function resultColor(result: string): string {
  switch (result) {
    case "homerun": return "text-red-500 font-bold";
    case "triple": return "text-orange-400 font-semibold";
    case "double": return "text-orange-300";
    case "single": case "infieldHit": return "text-yellow-300";
    case "walk": return "text-blue-400";
    case "hitByPitch": return "text-cyan-400";
    case "error": return "text-purple-400";
    case "doublePlay": return "text-gray-600";
    default: return "text-gray-500";
  }
}

function isHit(result: string): boolean {
  return ["single", "double", "triple", "homerun", "infieldHit"].includes(result);
}

function isHitOrError(result: string): boolean {
  return ["single", "double", "triple", "homerun", "infieldHit", "error"].includes(result);
}

function isOut(result: string): boolean {
  return ["groundout", "flyout", "lineout", "popout", "doublePlay", "sacrificeFly", "fieldersChoice"].includes(result);
}

// ---- 打席ログテーブル (共有コンポーネント) ----

function AtBatLogTable({
  logs,
  getName,
  maxRows = 500,
}: {
  logs: AtBatLog[];
  getName: (id: string) => string;
  maxRows?: number;
}) {
  const [selectedLog, setSelectedLog] = useState<AtBatLog | null>(null);
  const [resultFilter, setResultFilter] = useState<string>("all");
  const [ballTypeFilter, setBallTypeFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<string>("inning");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const filteredLogs = useMemo(() => {
    let result = logs;
    if (resultFilter !== "all") {
      switch (resultFilter) {
        case "hit":
          result = result.filter(l => ["single", "double", "triple", "homerun", "infieldHit", "error"].includes(l.result));
          break;
        case "out":
          result = result.filter(l => ["groundout", "flyout", "lineout", "popout", "doublePlay", "sacrificeFly", "fieldersChoice"].includes(l.result));
          break;
        case "strikeout":
          result = result.filter(l => l.result === "strikeout");
          break;
        case "walk":
          result = result.filter(l => l.result === "walk" || l.result === "hitByPitch");
          break;
        case "homerun":
          result = result.filter(l => l.result === "homerun");
          break;
      }
    }
    if (ballTypeFilter !== "all") {
      result = result.filter(l => l.battedBallType === ballTypeFilter);
    }
    return result;
  }, [logs, resultFilter, ballTypeFilter]);

  const sortedLogs = useMemo(() => {
    const sorted = [...filteredLogs];
    sorted.sort((a, b) => {
      let va: number | string | null = null;
      let vb: number | string | null = null;
      switch (sortKey) {
        case "inning": va = a.inning; vb = b.inning; break;
        case "result": va = a.result; vb = b.result; break;
        case "direction": va = a.direction; vb = b.direction; break;
        case "launchAngle": va = a.launchAngle; vb = b.launchAngle; break;
        case "exitVelocity": va = a.exitVelocity; vb = b.exitVelocity; break;
        case "estimatedDistance": va = a.estimatedDistance ?? null; vb = b.estimatedDistance ?? null; break;
      }
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [filteredLogs, sortKey, sortDir]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(["exitVelocity", "estimatedDistance", "launchAngle"].includes(key) ? "desc" : "asc");
    }
  };

  const sortArrow = (key: string) => sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  return (
    <>
      {/* フィルタバー */}
      <div className="flex items-center gap-3 mb-2 text-xs">
        <label className="flex items-center gap-1 text-gray-400">
          結果
          <select
            value={resultFilter}
            onChange={e => setResultFilter(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-gray-200 text-xs"
          >
            <option value="all">全て</option>
            <option value="hit">ヒット</option>
            <option value="out">アウト</option>
            <option value="strikeout">三振</option>
            <option value="walk">四球・死球</option>
            <option value="homerun">ホームラン</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-gray-400">
          打球
          <select
            value={ballTypeFilter}
            onChange={e => setBallTypeFilter(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-gray-200 text-xs"
          >
            <option value="all">全て</option>
            <option value="ground_ball">ゴロ</option>
            <option value="fly_ball">フライ</option>
            <option value="line_drive">ライナー</option>
            <option value="popup">ポップフライ</option>
          </select>
        </label>
        <span className="ml-auto text-gray-500">{sortedLogs.length.toLocaleString()}件</span>
      </div>
      <div className="max-h-[600px] overflow-y-auto">
        <table className="w-full text-xs" style={{ fontVariantNumeric: "tabular-nums" }}>
          <thead className="sticky top-0 bg-gray-800">
            <tr className="text-gray-400 border-b border-gray-700">
              <th
                className="text-right py-2 px-2 cursor-pointer hover:text-gray-200 select-none"
                onClick={() => handleSort("inning")}
              >
                回{sortArrow("inning")}
              </th>
              <th className="text-center py-2 px-2">半</th>
              <th className="text-left py-2 px-2">打者</th>
              <th className="text-left py-2 px-2">投手</th>
              <th
                className="text-left py-2 px-2 cursor-pointer hover:text-gray-200 select-none"
                onClick={() => handleSort("result")}
              >
                結果{sortArrow("result")}
              </th>
              <th className="text-left py-2 px-2">打球</th>
              <th
                className="text-right py-2 px-2 cursor-pointer hover:text-gray-200 select-none"
                onClick={() => handleSort("direction")}
              >
                方向°{sortArrow("direction")}
              </th>
              <th
                className="text-right py-2 px-2 cursor-pointer hover:text-gray-200 select-none"
                onClick={() => handleSort("launchAngle")}
              >
                角度°{sortArrow("launchAngle")}
              </th>
              <th
                className="text-right py-2 px-2 cursor-pointer hover:text-gray-200 select-none"
                onClick={() => handleSort("exitVelocity")}
              >
                速度{sortArrow("exitVelocity")}
              </th>
              <th
                className="text-right py-2 px-2 cursor-pointer hover:text-gray-200 select-none text-xs text-gray-400"
                onClick={() => handleSort("estimatedDistance")}
              >
                飛距離{sortArrow("estimatedDistance")}
              </th>
              <th className="text-center py-2 px-2">守備</th>
            </tr>
          </thead>
          <tbody>
            {sortedLogs.slice(0, maxRows).map((log, i) => (
              <tr
                key={i}
                onClick={() => log.battedBallType ? setSelectedLog(log) : undefined}
                className={`border-b border-gray-700/20 ${i % 2 === 1 ? "bg-gray-700/10" : ""} ${log.battedBallType ? "cursor-pointer hover:bg-gray-600/30" : ""}`}
              >
                <td className="py-1 px-2 text-right text-gray-400">{log.inning}</td>
                <td className="py-1 px-2 text-center text-gray-400">
                  {log.halfInning === "top" ? "表" : "裏"}
                </td>
                <td className="py-1 px-2 text-gray-200">{getName(log.batterId)}</td>
                <td className="py-1 px-2 text-gray-400">{getName(log.pitcherId)}</td>
                <td className={`py-1 px-2 ${resultColor(log.result)}`}>
                  {resultNamesJa[log.result] ?? log.result}
                </td>
                <td className="py-1 px-2 text-gray-400">
                  {log.battedBallType ? (battedBallNamesJa[log.battedBallType] ?? log.battedBallType) : "-"}
                </td>
                <td className="py-1 px-2 text-right text-gray-300">
                  {log.direction !== null ? log.direction.toFixed(1) : "-"}
                </td>
                <td className="py-1 px-2 text-right text-gray-300">
                  {log.launchAngle !== null ? log.launchAngle.toFixed(1) : "-"}
                </td>
                <td className="py-1 px-2 text-right text-gray-300">
                  {log.exitVelocity !== null ? log.exitVelocity.toFixed(1) : "-"}
                </td>
                <td className="py-1 px-2 text-right text-gray-300">
                  {log.estimatedDistance != null ? `${Math.round(log.estimatedDistance)}m` : "-"}
                </td>
                <td className="py-1 px-2 text-center text-blue-400">
                  {log.result === "homerun"
                    ? "-"
                    : log.fielderPosition !== null
                      ? (posNamesJa[log.fielderPosition] ?? log.fielderPosition)
                      : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sortedLogs.length > maxRows && (
          <p className="text-center text-gray-500 text-xs py-2">
            最大{maxRows}件表示 (全{sortedLogs.length.toLocaleString()}件)
          </p>
        )}
      </div>
      {selectedLog && selectedLog.battedBallType && (
        <BattedBallPopup
          log={selectedLog}
          batterName={getName(selectedLog.batterId)}
          pitcherName={getName(selectedLog.pitcherId)}
          onClose={() => setSelectedLog(null)}
        />
      )}
    </>
  );
}

// ---- シーズンデータタブ ----

function SeasonDataTab() {
  const { game } = useGameStore();

  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const [rangeFilter, setRangeFilter] = useState<string>("all");
  const [playerFilter, setPlayerFilter] = useState<string>("all");
  const [outcomeFilter, setOutcomeFilter] = useState<"all" | "hit" | "out">("all");

  const allTeams = useMemo(() => game ? Object.values(game.teams) : [], [game]);
  const leagues = game?.currentSeason.leagues ?? [];

  // プレイヤーマップ（ID → Player）
  const playerMap = useMemo(() => {
    const map = new Map<string, Player>();
    for (const team of allTeams)
      for (const p of team.roster) map.set(p.id, p);
    return map;
  }, [allTeams]);

  // プレイヤー→チームIDマップ
  const playerTeamMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const team of allTeams)
      for (const p of team.roster) map.set(p.id, team.id);
    return map;
  }, [allTeams]);

  // フィルタ対象のチームIDセット
  const filteredTeamIds = useMemo(() => {
    if (leagueFilter === "all") return new Set(allTeams.map((t) => t.id));
    const league = leagues.find((l) => l.id === leagueFilter);
    if (league) return new Set(league.teams);
    return new Set([leagueFilter]);
  }, [leagueFilter, allTeams, leagues]);

  // チーム変更時にプレイヤーフィルタをリセット (leagueFilter変化のたびに state に反映)
  const [prevLeagueFilter, setPrevLeagueFilter] = useState(leagueFilter);
  if (prevLeagueFilter !== leagueFilter) {
    setPrevLeagueFilter(leagueFilter);
    setPlayerFilter("all");
    setOutcomeFilter("all");
  }

  // フィルタ対象の選手リスト
  const filteredPlayers = useMemo(() => {
    const players: { player: Player; teamShortName: string }[] = [];
    for (const team of allTeams) {
      if (!filteredTeamIds.has(team.id)) continue;
      for (const p of team.roster) {
        players.push({ player: p, teamShortName: team.shortName });
      }
    }
    return players;
  }, [allTeams, filteredTeamIds]);

  const selectedPlayer = useMemo(() => {
    if (playerFilter === "all") return null;
    return playerMap.get(playerFilter) ?? null;
  }, [playerFilter, playerMap]);

  // 消化済み試合を取得
  const playedEntries = useMemo(() => {
    if (!game) return [];
    const schedule = game.currentSeason.schedule;
    const played = schedule.filter((e) => e.result !== null);
    if (rangeFilter === "last1") return played.slice(-6);
    if (rangeFilter === "last10") return played.slice(-60);
    return played;
  }, [game, rangeFilter]);

  // シーズンatBatLogs（自チーム試合のみ存在）
  const seasonAtBatLogs = useMemo(() => {
    const logs: AtBatLog[] = [];
    for (const entry of playedEntries) {
      if (!entry.result?.atBatLogs) continue;
      for (const log of entry.result.atBatLogs) {
        // プレイヤーフィルタ優先
        if (playerFilter !== "all" && selectedPlayer) {
          if (selectedPlayer.isPitcher) {
            if (log.pitcherId !== playerFilter) continue;
          } else {
            if (log.batterId !== playerFilter) continue;
          }
        } else {
          // チームフィルタ: 打者のチームが対象
          const batterTeam = playerTeamMap.get(log.batterId);
          if (!batterTeam || !filteredTeamIds.has(batterTeam)) continue;
        }
        logs.push(log);
      }
    }
    return logs;
  }, [playedEntries, playerTeamMap, filteredTeamIds, playerFilter, selectedPlayer]);

  // atBatLogsが存在するか
  const hasAtBatLogs = useMemo(() => {
    return playedEntries.some((e) => e.result?.atBatLogs && e.result.atBatLogs.length > 0);
  }, [playedEntries]);

  // 打席結果分布集計（三振・四死球 + 打球タイプ）
  const battedBallStats = useMemo(() => {
    // pitcherStatsから集計可能なケース
    const canUsePitcherStats = outcomeFilter === "all" &&
      (playerFilter === "all" || (selectedPlayer?.isPitcher ?? false));

    if (canUsePitcherStats) {
      let gb = 0, fb = 0, ld = 0, pu = 0, k = 0, bb = 0;
      for (const entry of playedEntries) {
        if (!entry.result) continue;
        for (const ps of entry.result.pitcherStats) {
          const pitcherTeam = playerTeamMap.get(ps.playerId);
          if (!pitcherTeam || !filteredTeamIds.has(pitcherTeam)) continue;
          if (playerFilter !== "all" && ps.playerId !== playerFilter) continue;
          gb += ps.groundBalls ?? 0;
          fb += ps.flyBalls ?? 0;
          ld += ps.lineDrives ?? 0;
          pu += ps.popups ?? 0;
          k += ps.strikeouts;
          bb += ps.walks + (ps.hitBatsmen ?? 0);
        }
      }
      const bip = gb + fb + ld + pu;
      return { gb, fb, ld, pu, k, bb, bip, total: bip + k + bb };
    }

    // atBatLogsから集計
    let targetLogs = seasonAtBatLogs;
    if (outcomeFilter === "hit") {
      targetLogs = targetLogs.filter((l) => isHitOrError(l.result));
    } else if (outcomeFilter === "out") {
      targetLogs = targetLogs.filter((l) => isOut(l.result));
    }
    let gb = 0, fb = 0, ld = 0, pu = 0, k = 0, bb = 0;
    for (const l of targetLogs) {
      if (l.result === "strikeout") { k++; continue; }
      if (l.result === "walk" || l.result === "hitByPitch") { bb++; continue; }
      switch (l.battedBallType) {
        case "ground_ball": gb++; break;
        case "fly_ball": fb++; break;
        case "line_drive": ld++; break;
        case "popup": pu++; break;
      }
    }
    const bip = gb + fb + ld + pu;
    return { gb, fb, ld, pu, k, bb, bip, total: bip + k + bb };
  }, [playedEntries, seasonAtBatLogs, playerTeamMap, filteredTeamIds, playerFilter, selectedPlayer, outcomeFilter]);

  // 打撃結果サマリー
  const battingStats = useMemo(() => {
    let atBats = 0, hits = 0, hr = 0, strikeouts = 0, walks = 0, doubles = 0, triples = 0;
    for (const entry of playedEntries) {
      if (!entry.result) continue;
      for (const ps of entry.result.playerStats) {
        const batterTeam = playerTeamMap.get(ps.playerId);
        if (!batterTeam || !filteredTeamIds.has(batterTeam)) continue;
        if (playerFilter !== "all" && ps.playerId !== playerFilter) continue;
        atBats += ps.atBats;
        hits += ps.hits;
        hr += ps.homeRuns;
        strikeouts += ps.strikeouts;
        walks += ps.walks;
        doubles += ps.doubles;
        triples += ps.triples;
      }
    }
    const bip = atBats - strikeouts - hr;
    const babipHits = hits - hr;
    const avg = atBats > 0 ? hits / atBats : 0;
    const kPct = atBats > 0 ? strikeouts / atBats : 0;
    const bbPct = (atBats + walks) > 0 ? walks / (atBats + walks) : 0;
    const babip = bip > 0 ? babipHits / bip : 0;
    const slg = atBats > 0
      ? ((hits - doubles - triples - hr) + doubles * 2 + triples * 3 + hr * 4) / atBats
      : 0;
    const obp = (atBats + walks) > 0 ? (hits + walks) / (atBats + walks) : 0;
    return { atBats, hits, hr, strikeouts, walks, avg, kPct, bbPct, babip, obp, slg, ops: obp + slg };
  }, [playedEntries, playerTeamMap, filteredTeamIds, playerFilter]);

  // ポジション別守備機会
  const fieldingByPos = useMemo(() => {
    const map: Record<number, { po: number; a: number; e: number }> = {};
    for (let pos = 1; pos <= 9; pos++) {
      map[pos] = { po: 0, a: 0, e: 0 };
    }
    for (const entry of playedEntries) {
      if (!entry.result) continue;
      for (const ps of entry.result.playerStats) {
        const player = playerMap.get(ps.playerId);
        if (!player) continue;
        const teamId = playerTeamMap.get(ps.playerId);
        if (!teamId || !filteredTeamIds.has(teamId)) continue;
        if (playerFilter !== "all" && ps.playerId !== playerFilter) continue;
        const posMap: Record<string, number> = {
          P: 1, C: 2, "1B": 3, "2B": 4, "3B": 5, SS: 6, LF: 7, CF: 8, RF: 9,
        };
        const posNum = posMap[player.position];
        if (posNum) {
          map[posNum].po += ps.putOuts ?? 0;
          map[posNum].a += ps.assists ?? 0;
          map[posNum].e += ps.errors ?? 0;
        }
      }
    }
    return map;
  }, [playedEntries, playerMap, playerTeamMap, filteredTeamIds, playerFilter]);

  // 名前解決関数
  const getName = useCallback((id: string) => {
    return playerMap.get(id)?.name ?? id;
  }, [playerMap]);

  if (!game) return null;

  const pct = (n: number) => (n * 100).toFixed(1) + "%";
  const fmt3 = (n: number) => n.toFixed(3).replace(/^0/, "");

  return (
    <div className="space-y-6">
      {/* フィルタ */}
      <div className="flex flex-wrap gap-4 p-4 bg-gray-800 rounded-lg border border-gray-700">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">チーム絞込:</label>
          <select
            value={leagueFilter}
            onChange={(e) => setLeagueFilter(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white"
          >
            <option value="all">全体</option>
            <option value="central">セ・リーグ</option>
            <option value="pacific">パ・リーグ</option>
            {allTeams.map((t) => (
              <option key={t.id} value={t.id}>{t.shortName}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">対象範囲:</label>
          <select
            value={rangeFilter}
            onChange={(e) => setRangeFilter(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white"
          >
            <option value="all">全試合</option>
            <option value="last10">直近10試合</option>
            <option value="last1">直近1試合</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">選手:</label>
          <select
            value={playerFilter}
            onChange={(e) => setPlayerFilter(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white max-w-[220px]"
          >
            <option value="all">全選手</option>
            {filteredPlayers.map(({ player, teamShortName }) => (
              <option key={player.id} value={player.id}>
                {teamShortName} - {player.name} ({POSITION_NAMES[player.position]})
              </option>
            ))}
          </select>
        </div>
        <div className="text-sm text-gray-400 self-center">
          対象試合数: <span className="text-white" style={{ fontVariantNumeric: "tabular-nums" }}>{playedEntries.length}</span>
        </div>
      </div>

      {/* 能力値カード */}
      {selectedPlayer && <PlayerAbilityCard player={selectedPlayer} />}

      {playedEntries.length === 0 ? (
        <div className="text-center text-gray-400 py-12">
          消化済み試合がありません
        </div>
      ) : (
        <>
          {/* 打球タイプ分布 */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-200">打席結果分布</h3>
              {hasAtBatLogs && (
                <div className="flex gap-1">
                  {(["all", "hit", "out"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setOutcomeFilter(f)}
                      className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                        outcomeFilter === f
                          ? "bg-blue-600 text-white"
                          : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                      }`}
                    >
                      {f === "all" ? "全体" : f === "hit" ? "ヒット" : "アウト"}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {battedBallStats.total === 0 ? (
              <p className="text-gray-500 text-sm">データなし</p>
            ) : (
              <div className="space-y-3">
                {/* 三振・四死球 */}
                {[
                  { label: "三振 (K%)", value: battedBallStats.k, bg: "#dc2626" },
                  { label: "四死球 (BB%)", value: battedBallStats.bb, bg: "#0891b2" },
                ].map(({ label, value, bg }) => {
                  const pctVal = battedBallStats.total > 0 ? (value / battedBallStats.total) * 100 : 0;
                  return (
                    <div key={label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-300">{label}</span>
                        <span className="text-white" style={{ fontVariantNumeric: "tabular-nums" }}>
                          {pctVal.toFixed(1)}% ({value.toLocaleString()})
                        </span>
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-3">
                        <div
                          className="h-3 rounded-full transition-all"
                          style={{ width: `${pctVal}%`, backgroundColor: bg }}
                        />
                      </div>
                    </div>
                  );
                })}
                {/* 区切り */}
                <div className="border-t border-gray-600 my-1" />
                {/* 打球タイプ（打席全体に対する割合） */}
                {[
                  { label: "ゴロ (GB%)", value: battedBallStats.gb, color: "bg-green-600" },
                  { label: "フライ (FB%)", value: battedBallStats.fb, color: "bg-blue-600" },
                  { label: "ライナー (LD%)", value: battedBallStats.ld, color: "bg-yellow-500" },
                  { label: "ポップ (PU%)", value: battedBallStats.pu, color: "bg-gray-500" },
                ].map(({ label, value, color }) => {
                  const pctVal = battedBallStats.total > 0 ? (value / battedBallStats.total) * 100 : 0;
                  return (
                    <div key={label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-300">{label}</span>
                        <span className="text-white" style={{ fontVariantNumeric: "tabular-nums" }}>
                          {pctVal.toFixed(1)}% ({value.toLocaleString()})
                        </span>
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-4">
                        <div
                          className={`${color} h-4 rounded-full transition-all`}
                          style={{ width: `${pctVal}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 打撃結果サマリー */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
            <h3 className="text-base font-semibold mb-4 text-gray-200">打撃結果サマリー</h3>
            <div
              className="grid grid-cols-4 gap-3 text-center"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {[
                { label: "打率", value: fmt3(battingStats.avg) },
                { label: "本塁打", value: battingStats.hr.toLocaleString() },
                { label: "K%", value: pct(battingStats.kPct) },
                { label: "BB%", value: pct(battingStats.bbPct) },
                { label: "BABIP", value: fmt3(battingStats.babip) },
                { label: "出塁率", value: fmt3(battingStats.obp) },
                { label: "長打率", value: fmt3(battingStats.slg) },
                { label: "OPS", value: fmt3(battingStats.ops) },
              ].map(({ label, value }) => (
                <div key={label} className="bg-gray-700/50 rounded p-3">
                  <div className="text-lg font-bold text-white">{value}</div>
                  <div className="text-xs text-gray-400 mt-1">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ポジション別守備機会 */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
            <h3 className="text-base font-semibold mb-4 text-gray-200">ポジション別守備機会</h3>
            <table
              className="w-full text-sm"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-700">
                  <th className="text-left py-2 px-3">ポジション</th>
                  <th className="text-right py-2 px-3">刺殺(PO)</th>
                  <th className="text-right py-2 px-3">補殺(A)</th>
                  <th className="text-right py-2 px-3">失策(E)</th>
                  <th className="text-right py-2 px-3">守備機会</th>
                  <th className="text-right py-2 px-3">守備率</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 9 }, (_, i) => i + 1).map((pos) => {
                  const f = fieldingByPos[pos];
                  const tc = f.po + f.a + f.e;
                  const fpct = tc > 0 ? ((f.po + f.a) / tc).toFixed(3).replace(/^0/, "") : "-.---";
                  return (
                    <tr key={pos} className="border-b border-gray-700/30">
                      <td className="py-2 px-3 text-blue-400 font-semibold">{posNamesJa[pos]}</td>
                      <td className="py-2 px-3 text-right text-gray-200">{f.po.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right text-gray-200">{f.a.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right text-red-400">{f.e.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right text-gray-300">{tc.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right text-gray-200">{fpct}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 打席詳細ログ */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
            {(() => {
              const filteredLogs = outcomeFilter === "all"
                ? seasonAtBatLogs
                : outcomeFilter === "hit"
                  ? seasonAtBatLogs.filter((l) => isHitOrError(l.result))
                  : seasonAtBatLogs.filter((l) => isOut(l.result));
              return (
                <>
                  <h3 className="text-base font-semibold mb-4 text-gray-200">
                    打席詳細ログ ({filteredLogs.length.toLocaleString()}件)
                  </h3>
                  {filteredLogs.length === 0 ? (
                    <p className="text-gray-500 text-sm">
                      {seasonAtBatLogs.length === 0
                        ? "自チームの試合のみ打席データを記録しています"
                        : "該当する打席データがありません"}
                    </p>
                  ) : (
                    <AtBatLogTable logs={filteredLogs} getName={getName} />
                  )}
                </>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}

// ---- 診断シミュレーションタブ ----

interface SimSummary {
  homeAvgScore: number;
  awayAvgScore: number;
  homeAvg: number;
  awayAvg: number;
  homeHR: number;
  awayHR: number;
  homeOPS: number;
  awayOPS: number;
}

interface BallPhysicsSummary {
  avgVelocity: number;
  avgAngle: number;
  avgDirection: number;
  pullPct: number;
  centerPct: number;
  oppoPct: number;
  barrelRate: number;
  barrelHRRate: number;
  totalBalls: number;
}

interface BattedBallOutcome {
  type: string;
  label: string;
  count: number;
  hitRate: number;
  hrRate: number;
  outRate: number;
}

interface FieldingTotals {
  [pos: number]: { po: number; a: number; e: number; tc: number };
}

function DiagnosticTab() {
  const { game } = useGameStore();

  const allTeams = useMemo(() => game ? Object.values(game.teams) : [], [game]);

  // プレイヤーマップ（ID → Player）
  const playerMap = useMemo(() => {
    const map = new Map<string, Player>();
    for (const team of allTeams)
      for (const p of team.roster) map.set(p.id, p);
    return map;
  }, [allTeams]);

  const getName = useCallback((id: string) => {
    return playerMap.get(id)?.name ?? id;
  }, [playerMap]);

  const [homeTeamId, setHomeTeamId] = useState<string>("");
  const [awayTeamId, setAwayTeamId] = useState<string>("");
  const [numGames, setNumGames] = useState<number>(10);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [simResults, setSimResults] = useState<GameResult[]>([]);
  const [atBatLogs, setAtBatLogs] = useState<AtBatLog[]>([]);

  useEffect(() => {
    if (allTeams.length >= 2 && !homeTeamId) {
      setHomeTeamId(allTeams[0].id);
      setAwayTeamId(allTeams[1].id);
    }
  }, [allTeams, homeTeamId]);

  const runSimulation = useCallback(() => {
    if (!game) return;
    setIsRunning(true);
    setProgress(0);
    setSimResults([]);
    setAtBatLogs([]);

    const home = game.teams[homeTeamId];
    const away = game.teams[awayTeamId];
    const results: GameResult[] = [];
    const allLogs: AtBatLog[] = [];

    let i = 0;
    const step = () => {
      const batchSize = Math.min(10, numGames - i);
      for (let j = 0; j < batchSize; j++) {
        const result = simulateGame(home, away, { collectAtBatLogs: true });
        results.push(result);
        if (result.atBatLogs) allLogs.push(...result.atBatLogs);
        i++;
      }
      setProgress(i);
      if (i < numGames) {
        setTimeout(step, 0);
      } else {
        setSimResults([...results]);
        setAtBatLogs([...allLogs]);
        setIsRunning(false);
      }
    };
    step();
  }, [game, homeTeamId, awayTeamId, numGames]);

  // チームスコアサマリー
  const simSummary = useMemo((): SimSummary | null => {
    if (simResults.length === 0 || !game) return null;
    const n = simResults.length;

    const homeRoster = new Set(game.teams[homeTeamId]?.roster.map((p) => p.id) ?? []);
    const awayRoster = new Set(game.teams[awayTeamId]?.roster.map((p) => p.id) ?? []);

    let homeAB = 0, homeH = 0, homeHR = 0, homeSLG = 0, homeOB = 0, homeOBDen = 0;
    let awayAB = 0, awayH = 0, awayHR = 0, awaySLG = 0, awayOB = 0, awayOBDen = 0;

    for (const r of simResults) {
      for (const ps of r.playerStats) {
        const isHome = homeRoster.has(ps.playerId);
        const isAway = awayRoster.has(ps.playerId);
        if (!isHome && !isAway) continue;

        const singles = ps.hits - ps.doubles - ps.triples - ps.homeRuns;
        const tb = singles + ps.doubles * 2 + ps.triples * 3 + ps.homeRuns * 4;
        const pa = ps.atBats + ps.walks;

        if (isHome) {
          homeAB += ps.atBats;
          homeH += ps.hits;
          homeHR += ps.homeRuns;
          homeSLG += ps.atBats > 0 ? tb : 0;
          homeOB += ps.hits + ps.walks;
          homeOBDen += pa;
        } else {
          awayAB += ps.atBats;
          awayH += ps.hits;
          awayHR += ps.homeRuns;
          awaySLG += ps.atBats > 0 ? tb : 0;
          awayOB += ps.hits + ps.walks;
          awayOBDen += pa;
        }
      }
    }

    const homeObp = homeOBDen > 0 ? homeOB / homeOBDen : 0;
    const homeSlg = homeAB > 0 ? homeSLG / homeAB : 0;
    const awayObp = awayOBDen > 0 ? awayOB / awayOBDen : 0;
    const awaySlg = awayAB > 0 ? awaySLG / awayAB : 0;

    return {
      homeAvgScore: simResults.reduce((s, r) => s + r.homeScore, 0) / n,
      awayAvgScore: simResults.reduce((s, r) => s + r.awayScore, 0) / n,
      homeAvg: homeAB > 0 ? homeH / homeAB : 0,
      awayAvg: awayAB > 0 ? awayH / awayAB : 0,
      homeHR: homeHR / n,
      awayHR: awayHR / n,
      homeOPS: homeObp + homeSlg,
      awayOPS: awayObp + awaySlg,
    };
  }, [simResults, game, homeTeamId, awayTeamId]);

  // 打球物理サマリー
  const physicsSummary = useMemo((): BallPhysicsSummary | null => {
    const balls = atBatLogs.filter((l) => l.exitVelocity !== null && l.direction !== null && l.launchAngle !== null);
    if (balls.length === 0) return null;

    const n = balls.length;
    const avgVelocity = balls.reduce((s, l) => s + (l.exitVelocity ?? 0), 0) / n;
    const avgAngle = balls.reduce((s, l) => s + (l.launchAngle ?? 0), 0) / n;
    const avgDirection = balls.reduce((s, l) => s + (l.direction ?? 0), 0) / n;

    const pull = balls.filter((l) => (l.direction ?? 0) < 30).length;
    const center = balls.filter((l) => (l.direction ?? 0) >= 30 && (l.direction ?? 0) <= 60).length;
    const oppo = balls.filter((l) => (l.direction ?? 0) > 60).length;

    const barrels = balls.filter((l) =>
      (l.exitVelocity ?? 0) >= 158 && (l.launchAngle ?? 0) >= 22 && (l.launchAngle ?? 0) <= 38
    );
    const barrelHRs = barrels.filter((l) => l.result === "homerun").length;

    return {
      avgVelocity,
      avgAngle,
      avgDirection,
      pullPct: n > 0 ? pull / n : 0,
      centerPct: n > 0 ? center / n : 0,
      oppoPct: n > 0 ? oppo / n : 0,
      barrelRate: n > 0 ? barrels.length / n : 0,
      barrelHRRate: barrels.length > 0 ? barrelHRs / barrels.length : 0,
      totalBalls: n,
    };
  }, [atBatLogs]);

  // 打球タイプ別結果
  const battedBallOutcomes = useMemo((): BattedBallOutcome[] => {
    const types = [
      { type: "ground_ball", label: "ゴロ (GB)" },
      { type: "fly_ball", label: "フライ (FB)" },
      { type: "line_drive", label: "ライナー (LD)" },
      { type: "popup", label: "ポップ (PU)" },
    ];
    return types.map(({ type, label }) => {
      const logs = atBatLogs.filter((l) => l.battedBallType === type);
      const n = logs.length;
      if (n === 0) return { type, label, count: 0, hitRate: 0, hrRate: 0, outRate: 0 };
      const hits = logs.filter((l) => isHit(l.result)).length;
      const hrs = logs.filter((l) => l.result === "homerun").length;
      const outs = logs.filter((l) =>
        ["groundout", "flyout", "lineout", "popout", "doublePlay"].includes(l.result)
      ).length;
      return {
        type,
        label,
        count: n,
        hitRate: hits / n,
        hrRate: hrs / n,
        outRate: outs / n,
      };
    });
  }, [atBatLogs]);

  // 守備集計
  const fieldingTotals = useMemo((): FieldingTotals => {
    const map: FieldingTotals = {};
    for (let pos = 1; pos <= 9; pos++) {
      map[pos] = { po: 0, a: 0, e: 0, tc: 0 };
    }
    if (!game || simResults.length === 0) return map;
    for (const r of simResults) {
      for (const ps of r.playerStats) {
        for (const team of Object.values(game.teams)) {
          const player = team.roster.find((p) => p.id === ps.playerId);
          if (player) {
            const posMap: Record<string, number> = {
              P: 1, C: 2, "1B": 3, "2B": 4, "3B": 5, SS: 6, LF: 7, CF: 8, RF: 9,
            };
            const posNum = posMap[player.position];
            if (posNum) {
              map[posNum].po += ps.putOuts ?? 0;
              map[posNum].a += ps.assists ?? 0;
              map[posNum].e += ps.errors ?? 0;
              map[posNum].tc += (ps.putOuts ?? 0) + (ps.assists ?? 0) + (ps.errors ?? 0);
            }
            break;
          }
        }
      }
    }
    return map;
  }, [simResults, game]);

  // サマリーCSV出力
  const downloadSummaryCSV = () => {
    if (!simSummary || !game) return;
    const home = game.teams[homeTeamId];
    const away = game.teams[awayTeamId];

    const rows = [
      ["項目", "ホーム(" + home.shortName + ")", "アウェイ(" + away.shortName + ")"],
      ["平均得点", simSummary.homeAvgScore.toFixed(2), simSummary.awayAvgScore.toFixed(2)],
      ["打率", simSummary.homeAvg.toFixed(3), simSummary.awayAvg.toFixed(3)],
      ["本塁打/試合", simSummary.homeHR.toFixed(2), simSummary.awayHR.toFixed(2)],
      ["OPS", simSummary.homeOPS.toFixed(3), simSummary.awayOPS.toFixed(3)],
      [],
      ["打球物理サマリー", "値"],
      ["平均打球速度(km/h)", physicsSummary?.avgVelocity.toFixed(1) ?? ""],
      ["平均打球角度(°)", physicsSummary?.avgAngle.toFixed(1) ?? ""],
      ["平均打球方向(°)", physicsSummary?.avgDirection.toFixed(1) ?? ""],
      ["プル率", ((physicsSummary?.pullPct ?? 0) * 100).toFixed(1) + "%"],
      ["センター率", ((physicsSummary?.centerPct ?? 0) * 100).toFixed(1) + "%"],
      ["逆方向率", ((physicsSummary?.oppoPct ?? 0) * 100).toFixed(1) + "%"],
      ["バレル率", ((physicsSummary?.barrelRate ?? 0) * 100).toFixed(1) + "%"],
      ["バレルHR率", ((physicsSummary?.barrelHRRate ?? 0) * 100).toFixed(1) + "%"],
      [],
      ["打球タイプ", "打球数", "安打率", "HR率", "アウト率"],
      ...battedBallOutcomes.map((o) => [
        o.label, o.count, (o.hitRate * 100).toFixed(1) + "%",
        (o.hrRate * 100).toFixed(1) + "%", (o.outRate * 100).toFixed(1) + "%",
      ]),
    ];

    const csvContent = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "summary.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // 打席ログCSV出力
  const downloadAtBatCSV = () => {
    if (atBatLogs.length === 0) return;
    const headers = ["回", "表裏", "打者", "投手", "結果", "打球タイプ", "方向°", "角度°", "速度", "飛距離(m)", "処理守備"];
    const rows = atBatLogs.map((l) => [
      l.inning,
      l.halfInning === "top" ? "表" : "裏",
      getName(l.batterId),
      getName(l.pitcherId),
      resultNamesJa[l.result] ?? l.result,
      l.battedBallType ? (battedBallNamesJa[l.battedBallType] ?? l.battedBallType) : "",
      l.direction !== null ? l.direction.toFixed(1) : "",
      l.launchAngle !== null ? l.launchAngle.toFixed(1) : "",
      l.exitVelocity !== null ? l.exitVelocity.toFixed(1) : "",
      l.estimatedDistance != null ? l.estimatedDistance.toFixed(1) : "",
      l.result === "homerun"
        ? "-"
        : l.fielderPosition !== null
          ? (posNamesJa[l.fielderPosition] ?? l.fielderPosition)
          : "",
    ]);
    const csvContent = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "atbat_log.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!game) return null;

  const homeTeam = game.teams[homeTeamId];
  const awayTeam = game.teams[awayTeamId];

  return (
    <div className="space-y-6">
      {/* 設定パネル */}
      <div className="p-4 bg-gray-800 rounded-lg border border-gray-700">
        <div className="flex flex-wrap gap-4 mb-4">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-400">ホーム:</label>
            <select
              value={homeTeamId}
              onChange={(e) => setHomeTeamId(e.target.value)}
              className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white"
              disabled={isRunning}
            >
              {allTeams.map((t) => (
                <option key={t.id} value={t.id}>{t.shortName}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-400">アウェイ:</label>
            <select
              value={awayTeamId}
              onChange={(e) => setAwayTeamId(e.target.value)}
              className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white"
              disabled={isRunning}
            >
              {allTeams.map((t) => (
                <option key={t.id} value={t.id}>{t.shortName}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-400">試合数:</label>
            <select
              value={numGames}
              onChange={(e) => setNumGames(Number(e.target.value))}
              className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-white"
              disabled={isRunning}
            >
              <option value={1}>1</option>
              <option value={10}>10</option>
              <option value={50}>50</option>
              <option value={143}>143</option>
            </select>
          </div>
          <button
            onClick={runSimulation}
            disabled={isRunning || !homeTeamId || !awayTeamId}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm font-semibold transition-colors"
          >
            {isRunning ? "実行中..." : "シミュレーション実行"}
          </button>
        </div>

        {/* プログレスバー */}
        {isRunning && (
          <div>
            <div
              className="flex justify-between text-sm text-gray-300 mb-1"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              <span>実行中...</span>
              <span>{progress} / {numGames} 試合</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all"
                style={{ width: `${numGames > 0 ? (progress / numGames) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {simResults.length === 0 && !isRunning && (
        <div className="text-center text-gray-400 py-12">
          チームと試合数を選択して「シミュレーション実行」を押してください
        </div>
      )}

      {simResults.length > 0 && (
        <>
          {/* チームスコア */}
          {simSummary && (
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
              <h3 className="text-base font-semibold mb-4 text-gray-200">
                チームスコア ({simResults.length}試合平均)
              </h3>
              <div
                className="grid grid-cols-2 gap-4"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {[
                  { teamId: homeTeamId, team: homeTeam, prefix: "ホーム", score: simSummary.homeAvgScore, avg: simSummary.homeAvg, hr: simSummary.homeHR, ops: simSummary.homeOPS },
                  { teamId: awayTeamId, team: awayTeam, prefix: "アウェイ", score: simSummary.awayAvgScore, avg: simSummary.awayAvg, hr: simSummary.awayHR, ops: simSummary.awayOPS },
                ].map(({ team, prefix, score, avg, hr, ops }) => (
                  <div key={prefix} className="bg-gray-700/50 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: team?.color }} />
                      <span className="font-semibold text-blue-400">{team?.shortName}</span>
                      <span className="text-xs text-gray-400">({prefix})</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><span className="text-gray-400">平均得点: </span><span className="text-white">{score.toFixed(2)}</span></div>
                      <div><span className="text-gray-400">打率: </span><span className="text-white">{avg.toFixed(3).replace(/^0/, "")}</span></div>
                      <div><span className="text-gray-400">HR/試合: </span><span className="text-white">{hr.toFixed(2)}</span></div>
                      <div><span className="text-gray-400">OPS: </span><span className="text-white">{ops.toFixed(3).replace(/^0/, "")}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 打球物理サマリー */}
          {physicsSummary && (
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
              <h3 className="text-base font-semibold mb-4 text-gray-200">
                打球物理サマリー (BIP: {physicsSummary.totalBalls.toLocaleString()}打球)
              </h3>
              {(() => {
                const ballsWithDist = atBatLogs.filter(l => (l.estimatedDistance ?? 0) > 0);
                const avgDist = ballsWithDist.length > 0
                  ? (ballsWithDist.reduce((s, l) => s + (l.estimatedDistance ?? 0), 0) / ballsWithDist.length).toFixed(1)
                  : "-";
                const maxDist = ballsWithDist.length > 0
                  ? Math.max(...ballsWithDist.map(l => l.estimatedDistance ?? 0)).toFixed(1)
                  : "-";
                return (
                  <div
                    className="grid grid-cols-3 gap-3 text-sm"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    <div className="bg-gray-700/50 rounded p-3">
                      <div className="text-gray-400 text-xs mb-1">平均打球速度</div>
                      <div className="text-white font-bold">{physicsSummary.avgVelocity.toFixed(1)} km/h</div>
                    </div>
                    <div className="bg-gray-700/50 rounded p-3">
                      <div className="text-gray-400 text-xs mb-1">平均打球角度</div>
                      <div className="text-white font-bold">{physicsSummary.avgAngle.toFixed(1)}°</div>
                    </div>
                    <div className="bg-gray-700/50 rounded p-3">
                      <div className="text-gray-400 text-xs mb-1">平均打球方向</div>
                      <div className="text-white font-bold">{physicsSummary.avgDirection.toFixed(1)}°</div>
                    </div>
                    <div className="bg-gray-700/50 rounded p-3">
                      <div className="text-gray-400 text-xs mb-1">プル / センター / 逆方向</div>
                      <div className="text-white font-bold">
                        {(physicsSummary.pullPct * 100).toFixed(1)}% /
                        {(physicsSummary.centerPct * 100).toFixed(1)}% /
                        {(physicsSummary.oppoPct * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div className="bg-gray-700/50 rounded p-3">
                      <div className="text-gray-400 text-xs mb-1">バレル率</div>
                      <div className="text-yellow-400 font-bold">{(physicsSummary.barrelRate * 100).toFixed(1)}%</div>
                    </div>
                    <div className="bg-gray-700/50 rounded p-3">
                      <div className="text-gray-400 text-xs mb-1">バレル内HR率</div>
                      <div className="text-yellow-400 font-bold">{(physicsSummary.barrelHRRate * 100).toFixed(1)}%</div>
                    </div>
                    <div className="bg-gray-700/50 rounded p-3">
                      <div className="text-gray-400 text-xs mb-1">平均飛距離</div>
                      <div className="text-white font-bold">{avgDist !== "-" ? `${avgDist}m` : "-"}</div>
                    </div>
                    <div className="bg-gray-700/50 rounded p-3">
                      <div className="text-gray-400 text-xs mb-1">最大飛距離</div>
                      <div className="text-white font-bold">{maxDist !== "-" ? `${maxDist}m` : "-"}</div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* 打球タイプ別結果 */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
            <h3 className="text-base font-semibold mb-4 text-gray-200">打球タイプ別結果</h3>
            <table
              className="w-full text-sm"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-700">
                  <th className="text-left py-2 px-3">タイプ</th>
                  <th className="text-right py-2 px-3">打球数</th>
                  <th className="text-right py-2 px-3">安打率</th>
                  <th className="text-right py-2 px-3">HR率</th>
                  <th className="text-right py-2 px-3">アウト率</th>
                </tr>
              </thead>
              <tbody>
                {battedBallOutcomes.map((o) => (
                  <tr key={o.type} className="border-b border-gray-700/30">
                    <td className="py-2 px-3 text-gray-200">{o.label}</td>
                    <td className="py-2 px-3 text-right text-gray-200">{o.count.toLocaleString()}</td>
                    <td className="py-2 px-3 text-right text-green-400">{(o.hitRate * 100).toFixed(1)}%</td>
                    <td className="py-2 px-3 text-right text-yellow-400">{(o.hrRate * 100).toFixed(1)}%</td>
                    <td className="py-2 px-3 text-right text-red-400">{(o.outRate * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 守備集計 */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
            <h3 className="text-base font-semibold mb-4 text-gray-200">守備集計</h3>
            <table
              className="w-full text-sm"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-700">
                  <th className="text-left py-2 px-3">ポジション</th>
                  <th className="text-right py-2 px-3">刺殺(PO)</th>
                  <th className="text-right py-2 px-3">補殺(A)</th>
                  <th className="text-right py-2 px-3">失策(E)</th>
                  <th className="text-right py-2 px-3">守備機会</th>
                  <th className="text-right py-2 px-3">守備率</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 9 }, (_, i) => i + 1).map((pos) => {
                  const f = fieldingTotals[pos];
                  const fpct = f.tc > 0 ? ((f.po + f.a) / f.tc).toFixed(3).replace(/^0/, "") : "-.---";
                  return (
                    <tr key={pos} className="border-b border-gray-700/30">
                      <td className="py-2 px-3 text-blue-400 font-semibold">{posNamesJa[pos]}</td>
                      <td className="py-2 px-3 text-right text-gray-200">{f.po.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right text-gray-200">{f.a.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right text-red-400">{f.e.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right text-gray-300">{f.tc.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right text-gray-200">{fpct}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 打席詳細ログ */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-200">
                打席詳細ログ ({atBatLogs.length.toLocaleString()}件)
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={downloadSummaryCSV}
                  className="px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded text-xs font-semibold transition-colors"
                >
                  サマリーCSV
                </button>
                <button
                  onClick={downloadAtBatCSV}
                  className="px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded text-xs font-semibold transition-colors"
                >
                  打席ログCSV
                </button>
              </div>
            </div>
            <AtBatLogTable logs={atBatLogs} getName={getName} />
          </div>
        </>
      )}
    </div>
  );
}

// ---- 得点期待値セクション ----

function RunExpectancySection({ game }: { game: GameState }) {
  const { atBatLogs, inningScores } = useMemo(() => {
    const logs: AtBatLog[] = [];
    const scores: { inning: number; halfInning: "top" | "bottom"; runs: number }[] = [];

    for (const entry of game.currentSeason.schedule) {
      const result = entry.result;
      if (!result) continue;
      if (!result.atBatLogs || result.atBatLogs.length === 0) continue;

      for (let i = 0; i < result.innings.length; i++) {
        const inningNum = i + 1;
        scores.push({ inning: inningNum, halfInning: "top", runs: result.innings[i].top });
        scores.push({ inning: inningNum, halfInning: "bottom", runs: result.innings[i].bottom });
      }

      for (const log of result.atBatLogs) {
        logs.push(log);
      }
    }

    return { atBatLogs: logs, inningScores: scores };
  }, [game]);

  return (
    <div className="space-y-6">
      <RunExpectancyTable atBatLogs={atBatLogs} inningScores={inningScores} />
    </div>
  );
}

// ---- 得点期待値テーブル ----

const BASES_LABELS: string[] = ["___", "1__", "_2_", "__3", "12_", "1_3", "_23", "123"];
const BASES_LABELS_JA: string[] = ["走者なし", "一塁", "二塁", "三塁", "一二塁", "一三塁", "二三塁", "満塁"];

function basesToIndex(bases: [boolean, boolean, boolean]): number {
  return (bases[0] ? 1 : 0) | (bases[1] ? 2 : 0) | (bases[2] ? 4 : 0);
}

function heatmapBg(value: number): string {
  if (value >= 2.0) return "bg-red-800";
  if (value >= 1.5) return "bg-orange-800";
  if (value >= 1.0) return "bg-yellow-800";
  if (value >= 0.6) return "bg-green-800";
  if (value >= 0.3) return "bg-blue-700";
  return "bg-blue-900";
}

function RunExpectancyTable({ atBatLogs, inningScores }: {
  atBatLogs: AtBatLog[];
  inningScores: { inning: number; halfInning: "top" | "bottom"; runs: number }[];
}) {
  const data = useMemo(() => {
    const inningScoreMap = new Map<string, number>();
    for (const s of inningScores) {
      inningScoreMap.set(`${s.inning}_${s.halfInning}`, s.runs);
    }

    const groups = new Map<string, AtBatLog[]>();
    for (const log of atBatLogs) {
      const key = `${log.inning}_${log.halfInning}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(log);
    }

    const sumRuns: number[][] = Array.from({ length: 8 }, () => [0, 0, 0]);
    const counts: number[][] = Array.from({ length: 8 }, () => [0, 0, 0]);

    for (const [key, logs] of groups) {
      const totalRuns = inningScoreMap.get(key) ?? 0;
      let runsBeforeAtBat = 0;
      for (const log of logs) {
        if (log.basesBeforePlay === null || log.outsBeforePlay === null) continue;
        const outsIdx = log.outsBeforePlay;
        if (outsIdx < 0 || outsIdx > 2) continue;
        const basesIdx = basesToIndex(log.basesBeforePlay);
        const remainingRuns = Math.max(0, totalRuns - runsBeforeAtBat);
        sumRuns[basesIdx][outsIdx] += remainingRuns;
        counts[basesIdx][outsIdx]++;
        if (
          log.result === "single" || log.result === "double" ||
          log.result === "triple" || log.result === "homerun" ||
          log.result === "infieldHit" || log.result === "error" ||
          log.result === "walk" || log.result === "hitByPitch" ||
          log.result === "fieldersChoice" || log.result === "sacrificeFly"
        ) {
          runsBeforeAtBat = Math.min(runsBeforeAtBat, totalRuns);
        }
      }
    }

    return { sumRuns, counts };
  }, [atBatLogs, inningScores]);

  const totalSamples = data.counts.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-gray-200">得点期待値</h3>
        <span className="text-xs text-gray-500" style={{ fontVariantNumeric: "tabular-nums" }}>
          総サンプル: {totalSamples.toLocaleString()}打席
        </span>
      </div>
      {totalSamples === 0 ? (
        <p className="text-gray-500 text-sm">データなし（自チームの試合データが必要です）</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-700">
                  <th className="text-left py-2 px-3">走者状況</th>
                  <th className="text-center py-2 px-3">0アウト</th>
                  <th className="text-center py-2 px-3">1アウト</th>
                  <th className="text-center py-2 px-3">2アウト</th>
                </tr>
              </thead>
              <tbody>
                {BASES_LABELS.map((label, basesIdx) => (
                  <tr key={label} className="border-b border-gray-700/30">
                    <td className="py-2 px-3 text-gray-300 font-mono text-xs">{BASES_LABELS_JA[basesIdx]}</td>
                    {[0, 1, 2].map((outsIdx) => {
                      const n = data.counts[basesIdx][outsIdx];
                      const avg = n > 0 ? data.sumRuns[basesIdx][outsIdx] / n : null;
                      return (
                        <td
                          key={outsIdx}
                          className={`py-2 px-3 text-center text-white ${avg !== null ? heatmapBg(avg) : "bg-gray-800"}`}
                        >
                          {avg !== null ? (
                            <div>
                              <div className="font-bold">{avg.toFixed(2)}</div>
                              <div className="text-xs text-gray-300">(N={n.toLocaleString()})</div>
                            </div>
                          ) : (
                            <span className="text-gray-600">-</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            ※ データが十分でない場合、期待値の信頼度は低くなります。自チームの試合のみ記録されます。
          </p>
        </>
      )}
    </div>
  );
}

// ---- メインページ ----

export default function AnalyticsPage() {
  const { game, loadGame } = useGameStore();
  const params = useParams();
  const id = params.id as string;

  const [tab, setTab] = useState<"season" | "diagnostic" | "runexp">("season");

  useEffect(() => {
    if (!game && params.id) loadGame(params.id as string);
  }, [game, params.id, loadGame]);

  if (!game) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-6xl mx-auto p-6">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">打球分析</h1>
          <Link
            href={`/game/${id}`}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
          >
            ダッシュボードに戻る
          </Link>
        </div>

        {/* タブ */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setTab("season")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === "season"
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            シーズンデータ
          </button>
          <button
            onClick={() => setTab("diagnostic")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === "diagnostic"
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            診断シミュレーション
          </button>
          <button
            onClick={() => setTab("runexp")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === "runexp"
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            得点期待値
          </button>
        </div>

        {/* タブ内容 */}
        {tab === "season" && <SeasonDataTab />}
        {tab === "diagnostic" && <DiagnosticTab />}
        {tab === "runexp" && <RunExpectancySection game={game} />}
      </div>
    </div>
  );
}
