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

// 打球方向拡張（フェア/ファウル連続分布）
export const DIRECTION_MIN = -45;              // 方向角の下限（左ファウル奥）
export const DIRECTION_MAX = 135;              // 方向角の上限（右ファウル奥）
export const DIRECTION_SIGMA_BASE = 38;        // ファウル判定用σの基本値
export const DIRECTION_SIGMA_CONTACT = 0.20;   // ミート依存σ調整
export const DIRECTION_SIGMA_FAIR = 18;        // フェア打球の方向σ（守備バランス維持）
export const FAIR_ZONE_MIN = 0;                // フェアゾーン下限
export const FAIR_ZONE_MAX = 90;               // フェアゾーン上限

// ファウルフライアウト
export const FOUL_FLY_MIN_LAUNCH_ANGLE = 25;   // ファウルフライの最低打球角度
export const FOUL_FLY_CATCHABLE_ANGLE = 20;    // ファウルラインからの捕球可能角度幅
export const FOUL_FLY_BASE_CATCH_RATE = 0.70;  // 基本捕球成功率

// ファウルチップ三振
export const FOUL_TIP_DIRECTION_THRESHOLD = 5; // ファウルライン外の角度閾値
export const FOUL_TIP_MAX_LAUNCH_ANGLE = 10;   // 低角度のみ
export const FOUL_TIP_MIN_VELOCITY = 100;      // 一定以上の速度 (km/h)
export const FOUL_TIP_STRIKEOUT_RATE = 0.55;   // 捕手捕球成功率

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

// ============================================================
// エージェントベース守備AI用定数
// ============================================================

// シミュレーション刻み
export const AGENT_DT = 0.1;                    // タイムステップ(秒)
export const AGENT_MAX_TIME_GROUND = 8.0;        // ゴロの最大シミュレーション時間(秒)
export const AGENT_MAX_TIME_FLY = 12.0;          // フライの最大シミュレーション時間(秒)

// 反応時間
export const AGENT_BASE_REACTION_IF = 0.60;      // 内野手基本反応時間(秒)
export const AGENT_BASE_REACTION_OF = 0.45;      // 外野手基本反応時間(秒)
export const AGENT_PITCHER_REACTION = 0.60;      // 投手の反応遅延(秒)
export const AGENT_CATCHER_REACTION = 0.40;      // 捕手の反応時間(秒)

// 捕球半径
export const AGENT_CATCH_RADIUS_IF = 1.0;        // 内野手の標準捕球半径(m) フライ用
export const AGENT_CATCH_RADIUS_OF = 1.5;        // 外野手の標準捕球半径(m)
export const AGENT_GROUND_INTERCEPT_RADIUS = 0.7; // ゴロ経路インターセプト半径(m)

// ダイビングキャッチ
export const AGENT_DIVE_MIN_DIST = 1.5;          // ダイビング可能最小距離(m)
export const AGENT_DIVE_MAX_DIST = 3.5;          // ダイビング可能最大距離(m)
export const AGENT_DIVE_BASE_RATE = 0.20;        // ダイビング基本成功率
export const AGENT_DIVE_SKILL_FACTOR = 0.005;    // 守備力1あたりのダイビング成功率上昇

// ランニングキャッチ
export const AGENT_RUNNING_CATCH_BASE = 0.70;    // ランニングキャッチ基本成功率
export const AGENT_RUNNING_CATCH_SKILL = 0.003;  // 守備力1あたりの成功率上昇

// 知覚ノイズ
export const AGENT_PERCEPTION_BASE_NOISE = 12;   // 基本ノイズσ(m)
export const AGENT_PERCEPTION_LINE_DRIVE_MULT = 2.0; // ライナーのノイズ倍率
export const AGENT_PERCEPTION_POPUP_MULT = 0.3;  // ポップフライのノイズ倍率

// コールオフ
export const AGENT_CALLOFF_RADIUS = 8;           // コールオフ判定距離(m)

// 移動
export const AGENT_ACCELERATION_TIME = 0.3;      // 0→最高速に達するまでの時間(秒)
export const AGENT_BASE_SPEED_IF = 6.5;          // 内野手基本走速(m/s)
export const AGENT_BASE_SPEED_OF = 7.0;          // 外野手基本走速(m/s)
export const AGENT_SPEED_SKILL_FACTOR = 2.5;     // speed/100 あたりの走速追加(m/s)
