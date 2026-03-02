// フィールド座標変換・定数
// batted-ball-trajectory.tsx から抽出

// ---- ユーティリティ ----

export function lerp(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function clampNum(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function quadBezier(
  from: { x: number; y: number },
  via: { x: number; y: number },
  to: { x: number; y: number },
  t: number
): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * via.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * via.y + t * t * to.y,
  };
}

// ---- フィールド座標変換 ----

// direction: 0°=3B線(左), 45°=センター(上), 90°=1B線(右)
// SVG座標: homeX=150, homeY=280, センター=上方向 (300x300ビュー)
export function toFieldSvg(distM: number, dirDeg: number, scale = 1.8, homeX = 150, homeY = 280): { x: number; y: number } {
  const angleRad = (135 - dirDeg) * Math.PI / 180;
  return {
    x: homeX + distM * scale * Math.cos(angleRad),
    y: homeY - distM * scale * Math.sin(angleRad),
  };
}

// フィールド直交座標(m) → SVG座標 (x=正→1塁側=右, y=正→外野=上)
export function fieldXYtoSvg(fx: number, fy: number, scale = 1.8, homeX = 150, homeY = 280): { x: number; y: number } {
  return { x: homeX + fx * scale, y: homeY - fy * scale };
}

// ---- 塁座標 (300x300ビュー) ----

export const HOME_COORD = { x: 150, y: 280 };
export const FIRST_COORD = toFieldSvg(27.431, 90);
export const SECOND_COORD = toFieldSvg(27.431 * Math.SQRT2, 45);
export const THIRD_COORD = toFieldSvg(27.431, 0);

export const BASE_COORDS: Record<number, { x: number; y: number }> = {
  0: HOME_COORD,
  1: FIRST_COORD,
  2: SECOND_COORD,
  3: THIRD_COORD,
};

// ---- フライの制御点 ----

export function makeFlyVia(
  from: { x: number; y: number },
  to: { x: number; y: number },
  launchAngle: number
): { x: number; y: number } {
  const mid = lerp(from, to, 0.5);
  const heightOffset = Math.min(100, (launchAngle / 45) * 80);
  return { x: mid.x, y: mid.y - heightOffset };
}

// ---- 結果カラー ----

export const resultNamesJa: Record<string, string> = {
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

export function resultColor(result: string): string {
  switch (result) {
    case "homerun": return "text-red-500 font-bold";
    case "triple": return "text-orange-400 font-semibold";
    case "double": return "text-orange-300";
    case "single": case "infieldHit": return "text-yellow-300";
    case "walk": return "text-blue-400";
    case "hitByPitch": return "text-cyan-400";
    case "error": return "text-purple-400";
    default: return "text-gray-400";
  }
}

export function dotColor(result: string): string {
  switch (result) {
    case "homerun": return "#ef4444";
    case "double": case "triple": return "#fb923c";
    case "single": case "infieldHit": return "#eab308";
    case "walk": case "hitByPitch": return "#60a5fa";
    case "error": return "#a855f7";
    default: return "#6b7280";
  }
}
