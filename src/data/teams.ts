/**
 * 初期チーム定義 (NPB風の架空12球団)
 * ※実在の球団名は使わず、架空の名前を使用
 */

export interface TeamTemplate {
  id: string;
  name: string;
  shortName: string;
  color: string;
  homeBallpark: string;
  league: "central" | "pacific";
}

export const TEAM_TEMPLATES: TeamTemplate[] = [
  // セントラル・リーグ
  {
    id: "tokyo-eagles",
    name: "東京イーグルス",
    shortName: "東京",
    color: "#DC2626",
    homeBallpark: "東京ドーム",
    league: "central",
  },
  {
    id: "yokohama-stars",
    name: "横浜スターズ",
    shortName: "横浜",
    color: "#2563EB",
    homeBallpark: "横浜スタジアム",
    league: "central",
  },
  {
    id: "nagoya-dragons",
    name: "名古屋ドラゴンズ",
    shortName: "名古屋",
    color: "#1D4ED8",
    homeBallpark: "ナゴヤドーム",
    league: "central",
  },
  {
    id: "osaka-tigers",
    name: "大阪タイガース",
    shortName: "大阪",
    color: "#FBBF24",
    homeBallpark: "甲子園球場",
    league: "central",
  },
  {
    id: "hiroshima-reds",
    name: "広島レッズ",
    shortName: "広島",
    color: "#EF4444",
    homeBallpark: "マツダスタジアム",
    league: "central",
  },
  {
    id: "sendai-swallows",
    name: "仙台スワローズ",
    shortName: "仙台",
    color: "#059669",
    homeBallpark: "仙台球場",
    league: "central",
  },
  // パシフィック・リーグ
  {
    id: "fukuoka-hawks",
    name: "福岡ホークス",
    shortName: "福岡",
    color: "#F59E0B",
    homeBallpark: "福岡PayPayドーム",
    league: "pacific",
  },
  {
    id: "sapporo-fighters",
    name: "札幌ファイターズ",
    shortName: "札幌",
    color: "#1E3A5F",
    homeBallpark: "エスコンフィールド",
    league: "pacific",
  },
  {
    id: "chiba-marines",
    name: "千葉マリーンズ",
    shortName: "千葉",
    color: "#000000",
    homeBallpark: "ZOZOマリンスタジアム",
    league: "pacific",
  },
  {
    id: "saitama-lions",
    name: "埼玉ライオンズ",
    shortName: "埼玉",
    color: "#1E40AF",
    homeBallpark: "ベルーナドーム",
    league: "pacific",
  },
  {
    id: "kobe-buffaloes",
    name: "神戸バファローズ",
    shortName: "神戸",
    color: "#7C3AED",
    homeBallpark: "京セラドーム",
    league: "pacific",
  },
  {
    id: "tohoku-golden",
    name: "東北ゴールデンズ",
    shortName: "東北",
    color: "#B91C1C",
    homeBallpark: "楽天モバイルパーク",
    league: "pacific",
  },
];
