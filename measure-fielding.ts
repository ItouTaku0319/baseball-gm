import { simulateGame } from "./src/engine/simulation";
import type { Player } from "./src/models/player";

function createTestPlayer(id: string, position: Player["position"], isPitcher: boolean): Player {
  return {
    id, name: `テスト${position}`, age: 25, position, isPitcher,
    throwHand: "R", batSide: "R",
    batting: { contact: 50, power: 50, trajectory: 2, speed: 50, arm: 50, fielding: 50, catching: 50, eye: 50 },
    pitching: isPitcher ? { velocity: 145, control: 50, pitches: [{ type: "slider", level: 4 }], stamina: 60, mentalToughness: 50, arm: 50, fielding: 50, catching: 50 } : null,
    potential: { overall: "C" }, salary: 500, contractYears: 1,
    careerBattingStats: {}, careerPitchingStats: {},
  };
}

function createTestTeam(id: string) {
  const positions: Player["position"][] = ["P","C","1B","2B","3B","SS","LF","CF","RF"];
  const roster = positions.map((pos, i) => createTestPlayer(`${id}-${pos}-${i}`, pos, pos === "P"));
  for (let i = 1; i <= 5; i++) roster.push(createTestPlayer(`${id}-SP${i}`, "P", true));
  return { id, name: `T${id}`, shortName: `T${id}`, color: "#000", roster, budget: 50000, fanBase: 50, homeBallpark: "テスト球場" };
}

const N = 2000;
const teamA = createTestTeam("A");
const teamB = createTestTeam("B");

const positions = ["P","C","1B","2B","3B","SS","LF","CF","RF"];
// チームA(ホーム)とチームB(アウェイ)両方の守備データを集める
const totalsA: Record<string, {po:number,a:number,e:number}> = {};
const totalsB: Record<string, {po:number,a:number,e:number}> = {};
positions.forEach(pos => { totalsA[pos] = {po:0,a:0,e:0}; totalsB[pos] = {po:0,a:0,e:0}; });

const posIdsA: Record<string,string> = {};
const posIdsB: Record<string,string> = {};
positions.forEach((pos,i) => { posIdsA[pos] = `A-${pos}-${i}`; posIdsB[pos] = `B-${pos}-${i}`; });

for (let i = 0; i < N; i++) {
  const result = simulateGame(teamA, teamB);
  for (const pos of positions) {
    const sA = result.playerStats.find(s => s.playerId === posIdsA[pos]);
    if (sA) { totalsA[pos].po += sA.putOuts ?? 0; totalsA[pos].a += sA.assists ?? 0; totalsA[pos].e += sA.errors ?? 0; }
    const sB = result.playerStats.find(s => s.playerId === posIdsB[pos]);
    if (sB) { totalsB[pos].po += sB.putOuts ?? 0; totalsB[pos].a += sB.assists ?? 0; totalsB[pos].e += sB.errors ?? 0; }
  }
}

// 両チーム合計の平均(1チーム1試合あたり)
console.log("\n=== 現シミュレーション: ポジション別守備機会 (1チーム1試合平均, N=" + N + ") ===");
console.log("Pos\tPO\tA\tE\tTC");
let tPO=0, tA=0, tE=0;
for (const pos of positions) {
  const po = (totalsA[pos].po + totalsB[pos].po) / (N*2);
  const a = (totalsA[pos].a + totalsB[pos].a) / (N*2);
  const e = (totalsA[pos].e + totalsB[pos].e) / (N*2);
  const tc = po+a+e;
  tPO+=po; tA+=a; tE+=e;
  console.log(`${pos}\t${po.toFixed(2)}\t${a.toFixed(2)}\t${e.toFixed(2)}\t${tc.toFixed(2)}`);
}
console.log(`合計\t${tPO.toFixed(2)}\t${tA.toFixed(2)}\t${tE.toFixed(2)}\t${(tPO+tA+tE).toFixed(2)}`);

// === 65人ロスター + rosterLevels のリアルなテスト ===
import { generateRoster } from "./src/engine/player-generator";
import { autoAssignRosterLevels, autoConfigureLineup } from "./src/engine/lineup";
import type { Team } from "./src/models/team";

function createRealisticTeam(id: string): Team {
  const roster = generateRoster(65);
  const team: Team = {
    id, name: `Real${id}`, shortName: `R${id}`, color: "#000",
    roster, budget: 50000, fanBase: 50, homeBallpark: "テスト球場",
  };
  const rosterLevels = autoAssignRosterLevels(team);
  const teamWithLevels = { ...team, rosterLevels };
  const lineupConfig = autoConfigureLineup(teamWithLevels);
  return { ...teamWithLevels, lineupConfig };
}

// 12チームで3Bがichigunにいるか確認
console.log("\n=== 12チームの3B選手分布 ===");
for (let t = 0; t < 12; t++) {
  const team = createRealisticTeam(`team${t}`);
  const all3B = team.roster.filter(p => p.position === "3B");
  const ichiGun3B = all3B.filter(p => team.rosterLevels?.[p.id] === "ichi_gun");
  const inLineup = all3B.filter(p => team.lineupConfig?.battingOrder?.includes(p.id));
  console.log(`Team${t}: 3B合計=${all3B.length}, 1軍=${ichiGun3B.length}, 打順内=${inLineup.length}`);
}

// リアルなチームで5試合シミュレーション → 3B守備機会を確認
const realA = createRealisticTeam("RA");
const realB = createRealisticTeam("RB");
const posMapAnalytics: Record<string, number> = {
  P: 1, C: 2, "1B": 3, "2B": 4, "3B": 5, SS: 6, LF: 7, CF: 8, RF: 9,
};

const posNames: Record<number, string> = {1:"投",2:"捕",3:"一",4:"二",5:"三",6:"遊",7:"左",8:"中",9:"右"};

const realFielding: Record<number, {po:number,a:number,e:number}> = {};
for (let pos = 1; pos <= 9; pos++) realFielding[pos] = {po:0,a:0,e:0};

const REAL_N = 100;
const realPlayerMap = new Map<string, Player>();
for (const p of realA.roster) realPlayerMap.set(p.id, p);
for (const p of realB.roster) realPlayerMap.set(p.id, p);

let gamesWithNo3BStats = 0;
for (let i = 0; i < REAL_N; i++) {
  const r = simulateGame(realA, realB);
  let has3B = false;
  for (const ps of r.playerStats) {
    const player = realPlayerMap.get(ps.playerId);
    if (!player) continue;
    const posNum2 = posMapAnalytics[player.position];
    if (!posNum2) continue;
    realFielding[posNum2].po += ps.putOuts ?? 0;
    realFielding[posNum2].a += ps.assists ?? 0;
    realFielding[posNum2].e += ps.errors ?? 0;
    if (player.position === "3B" && ((ps.putOuts ?? 0) + (ps.assists ?? 0) + (ps.errors ?? 0) > 0)) has3B = true;
  }
  if (!has3B) gamesWithNo3BStats++;
}

console.log(`\n=== リアルチーム(${REAL_N}試合) 3B守備機会なし: ${gamesWithNo3BStats}/${REAL_N}試合 ===`);
console.log("Pos\tPO\tA\tE\tTC\t(per game)");
for (let pos = 1; pos <= 9; pos++) {
  const f = realFielding[pos];
  const tc = f.po + f.a + f.e;
  console.log(`${posNames[pos]}\t${f.po}\t${f.a}\t${f.e}\t${tc}\t${(tc/REAL_N).toFixed(2)}`);
}

// === analyticsページと同じロジックで集計 ===
// playerMap: playerId → Player (rosterから構築)
const allPlayers = [...teamA.roster, ...teamB.roster];
const playerMap = new Map<string, Player>();
for (const p of allPlayers) playerMap.set(p.id, p);

const analyticsFielding: Record<number, {po:number,a:number,e:number}> = {};
for (let pos = 1; pos <= 9; pos++) analyticsFielding[pos] = {po:0,a:0,e:0};

// 1試合分のresultでanalytics集計をテスト
const testResult = simulateGame(teamA, teamB);
console.log("\n=== 1試合のplayerStats数:", testResult.playerStats.length, "===");

let found3B = false;
for (const ps of testResult.playerStats) {
  const player = playerMap.get(ps.playerId);
  if (!player) {
    console.log("playerMap未登録:", ps.playerId, "po:", ps.putOuts, "a:", ps.assists, "e:", ps.errors);
    continue;
  }
  const posNum = posMapAnalytics[player.position];
  if (player.position === "3B") {
    found3B = true;
    console.log("3B選手発見:", ps.playerId, "position:", player.position, "posNum:", posNum,
      "po:", ps.putOuts, "a:", ps.assists, "e:", ps.errors);
  }
  if (posNum) {
    analyticsFielding[posNum].po += ps.putOuts ?? 0;
    analyticsFielding[posNum].a += ps.assists ?? 0;
    analyticsFielding[posNum].e += ps.errors ?? 0;
  }
}
if (!found3B) console.log("WARNING: 3B選手がplayerStatsに見つからない！");

console.log("\n=== analytics集計(1試合) ===");
console.log("Pos\tPO\tA\tE\tTC");
for (let pos = 1; pos <= 9; pos++) {
  const f = analyticsFielding[pos];
  console.log(`${posNames[pos]}\t${f.po}\t${f.a}\t${f.e}\t${f.po+f.a+f.e}`);
}
