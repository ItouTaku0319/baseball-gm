// 打球物理の共通定数
export const GRAVITY = 9.8;                // 重力加速度 (m/s²)
export const BAT_HEIGHT = 1.2;             // 打点高さ (m)
export const DRAG_FACTOR = 0.63;           // 空気抵抗による飛距離減衰
export const FLIGHT_TIME_FACTOR = 0.85;    // 空気抵抗による飛行時間短縮

// フェンス距離・高さ（甲子園球場準拠）
export const FENCE_BASE = 100;             // 両翼フェンス距離 (m) NPB標準
export const FENCE_CENTER_EXTRA = 22;      // 中堅との追加距離 (m) → 中堅122m
export const FENCE_HEIGHT = 4.0;           // フェンス高さ (m)、NPB平均的な値

// ゴロ物理
export const GROUND_BALL_ANGLE_THRESHOLD = 10; // ゴロ判定角度上限 (度)
export const GROUND_BALL_MAX_DISTANCE = 55;    // ゴロ最大到達距離 (m)
export const GROUND_BALL_SPEED_FACTOR = 1.2;   // ゴロ距離変換係数
export const GROUND_BALL_AVG_SPEED_RATIO = 0.5; // ゴロ平均速度比（等減速モデル: 平均=初速/2）
export const GROUND_BALL_BOUNCE_ANGLE_SCALE = 30; // 叩きつけ減衰スケール (度, この角度で全エネルギー損失)

// 弾道キャリーファクター (弾道1-4)
// FLIGHT_TIME_FACTOR統一による飛距離短縮(×0.85)を補正
export const TRAJECTORY_CARRY_FACTORS = [1.02, 1.12, 1.17, 1.22] as const;

// 守備チャージ・バウンスペナルティ閾値
export const PITCHER_REACTION_PENALTY = 0.6; // 投手の投球後反応遅延(秒)
export const FIELDER_CATCH_RADIUS = 0.5;     // 捕球可能距離(m) ゴロ用
export const FLY_CATCH_RADIUS = 1.3;         // フライ/ライナーの確実捕球距離(m) 内野手用
// キャッチャーはポップフライ専門訓練で近距離(20m以内)の反応が速い
// 変更前: キャッチャーは一律ホーム待機(canReach=false)
// 変更後: 近距離フライは0.15秒で即反応(通常0.45秒)、走速8.5m/s+飛び込み3.5m半径
export const CATCHER_POPUP_REACTION = 0.15;  // キャッチャーの近距離フライ反応時間(秒)
export const CATCHER_POPUP_RUN_SPEED = 8.5;  // キャッチャーの近距離フライ走速(m/s、通常6.5より速い)
export const CATCHER_POPUP_CATCH_RADIUS = 3.5; // キャッチャーの近距離フライ捕球半径(m、飛び込み込み)
export const BOUNCE_CLOSE_THRESHOLD = 3;     // 近距離(m)
export const BOUNCE_NEAR_THRESHOLD = 8;      // 中距離(m)
export const BOUNCE_MID_THRESHOLD = 15;      // 遠距離(m)

// 精神力(mentalToughness)による能力補正の定数
// 基準値50が補正なし、最大値100で上限効果、最小値0で下限効果
// 疲労ペナルティ軽減: 精神力100で疲労ペナルティを30%軽減（精神力0で軽減なし）
export const MENTAL_FATIGUE_RESISTANCE = 0.30;
// ピンチ時の制球ボーナス: 得点圏走者あり時、mentalToughness 50基準で±5ポイント
// control 0-100スケール上での補正量 (mentalToughness - 50) * 0.10
export const MENTAL_PINCH_CONTROL_FACTOR = 0.10;
