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

// コンタクトモデル定数
// Phase A: carry廃止・コンタクトモデル導入
export const CONTACT_PEAK_ANGLE = 10;          // 芯の打ち出し角度 (度)
export const CONTACT_ANGLE_SPREAD = 60;        // offset±1.0での角度振れ幅 (度)
export const CONTACT_DIRECTION_SPREAD = 30;    // timing±1.0での方向振れ幅 (度)
export const CONTACT_DIRECTION_NOISE_SIGMA = 8; // 打球方向のブレσ

// playerMaxEV計算用
// carry廃止+ファウル率改善後の再調整: D50で163.5km/h, D80で174.0km/h
export const PLAYER_MAX_EV_BASE = 150;         // 基本最大初速 (km/h)
export const PLAYER_MAX_EV_POWER_SCALE = 35;   // パワー100での追加初速 (km/h)

// 効率曲線パラメータ
export const EFFICIENCY_PEAK_ANGLE = 10;       // 効率最大の角度 (度)
export const EFFICIENCY_ANGLE_RANGE = 70;      // 効率が最低になるまでの角度幅
// 設計書通り0.7を維持: angle=30°でeff=0.918、angle=50°でeff=0.673 (popup HR防止)
export const EFFICIENCY_DROP_FACTOR = 0.7;     // 効率の最大低下量

// contactOffset生成パラメータ
export const OFFSET_TRAJECTORY_SCALE = 0.08;  // 弾道によるオフセット補正
export const OFFSET_SIGMA_BASE = 0.40;         // オフセットσ基本値
export const OFFSET_SIGMA_CONTACT_SCALE = 0.15; // ミート依存σ調整量
export const OFFSET_SIGMA_PITCH_SCALE = 0.05; // 変化球依存σ調整量

// timing生成パラメータ
export const TIMING_SIGMA_BASE = 1.50;         // タイミングσ基本値 (D50でファウル率≈31%)
export const TIMING_SIGMA_CONTACT_SCALE = 0.15; // ミート依存σ調整量
export const TIMING_SIGMA_PITCH_SCALE = 0.05; // 変化球依存σ調整量

// 守備チャージ・バウンスペナルティ閾値
export const PITCHER_REACTION_PENALTY = 0.6; // 投手の投球後反応遅延(秒)
export const FIELDER_CATCH_RADIUS = 0.5;     // 捕球可能距離(m) ゴロ用
export const FLY_CATCH_RADIUS = 1.3;         // フライ/ライナーの確実捕球距離(m) 内野手用
// キャッチャーはポップフライ専門訓練で近距離(20m以内)の反応が速い
// 変更前: キャッチャーは一律ホーム待機(canReach=false)
// 変更後: 近距離フライは0.15秒で即反応(通常0.45秒)、走速8.5m/s+飛び込み3.5m半径
// fielding-ai.ts (旧守備AI) との互換性のために残す
export const CATCHER_POPUP_REACTION = 0.15;  // キャッチャーの近距離フライ反応時間(秒)
export const CATCHER_POPUP_RUN_SPEED = 8.5;  // キャッチャーの近距離フライ走速(m/s、通常6.5より速い)
export const CATCHER_POPUP_CATCH_RADIUS = 3.5; // キャッチャーの近距離フライ捕球半径(m、飛び込み込み)
export const TRANSFER_TIME_BASE = 0.25;      // 送球準備時間ベース(秒) ※旧0.55s
export const TRANSFER_TIME_ARM_SCALE = 0.15; // 肩力による送球準備時間変動(秒) ※旧0.25s
export const RUNNER_START_DELAY = 0.65;      // 打者走者のスタート遅延(秒)：スイング完了→走り出し

// 守備範囲計算（捕球リーチ）— 物理ベースモデル
export const CATCH_REACH_BASE = 0.45;          // 全ポジション共通基本捕球リーチ(m)
export const CATCH_REACH_SKILL_FACTOR = 0.70;  // fielding/100 あたりの追加リーチ(m)
// ポップフライ(50°以上)の初速上限
// 芯を外した不完全コンタクトで初速が大幅に低下する
// 80km/hで着地距離18-27m（NPB内野ポップフライの典型的な範囲）
export const POPUP_EV_CAP = 80;

// コールオフ
// 変更前: エージェント間距離 + ターゲット距離両方で判定(AGENT_CALLOFF_RADIUS=8m)
// 変更後: ターゲット距離のみで判定
export const CALLOFF_TARGET_THRESHOLD = 15;    // コールオフ判定ターゲット近接距離(m)

// 近接野手判定（closerPursuer）
// 自分より十分近い野手が追跡中なら、カバーに回る判定の比率
export const CLOSER_PURSUER_INTERCEPT_RATIO = 0.7; // インターセプト時（70%以内なら譲る）
export const CLOSER_PURSUER_CHASE_RATIO = 0.6;     // チェーシング/フライ時（60%以内なら譲る）

// 併殺(DP)成功率
// DP試行時（2塁送球後ピボット→1塁送球）の成功率
// NPB準拠: ゴロ併殺は「DP試行の60%」×「ピボット成功65-80%」×「タイミング判定」で30-50%
// 内野安打確率（マージンベース）
// NPB準拠: ゴロヒット率23-25%のうち、約3-5%が内野安打
// 防御時間マージンが小さいほど内野安打の確率が上がる
export const INFIELD_HIT_PROB = 0.20;               // マージン0時の内野安打基本確率
export const INFIELD_HIT_MARGIN_SCALE = 0.65;       // この秒数マージンで確率0に漸減
export const INFIELD_HIT_SPEED_BONUS = 0.10;        // speed=100で+10%のボーナス（marginFactorでスケール）
// ゴロ捕球失敗 → ヒット判定の閾値（強い打球は捕れなくてもヒット扱い）
export const GROUND_BALL_HARD_HIT_SPEED = 20;       // この速度(m/s)以上の捕球失敗はヒット扱い
// ゴロ捕球率の調整
export const GROUND_BALL_CATCH_SPEED_PENALTY = 0.012; // ボール速度(>20m/s)による捕球率低下係数
export const GROUND_BALL_CATCH_FLOOR = 0.80;          // 捕球率の下限
export const GROUND_BALL_REACH_PENALTY = 0.08;        // リーチ端での捕球率低下（最大8%）
// ゴロ「ギャップ抜け」は廃止: エージェントの物理シミュレーションが直接判定する

// 犠飛(SF)タイミング判定
// 外野手の捕球→送球体勢(0.8-1.0s) + 捕手のタッグ(0.3s) のオーバーヘッド
export const SF_CATCH_TO_THROW_OVERHEAD = 1.5;     // 外野手捕球→送球→捕手タッグのオーバーヘッド(s)

export const DP_PIVOT_SUCCESS_BASE = 0.65;          // ピボット送球の基本成功率
export const DP_PIVOT_SUCCESS_SPEED_FACTOR = 0.15;  // 遅い打者ほどDP成功率上昇(最大+15%)
// SS/2Bが2塁ベース付近で処理→踏んで投げる場合の成功率
export const DP_STEP_ON_BASE_SUCCESS = 0.80;        // ベース踏み→1塁送球の基本成功率
export const DP_STEP_ON_BASE_SPEED_FACTOR = 0.10;   // 遅い打者ほど成功率上昇(最大+10%)

export const BOUNCE_CLOSE_THRESHOLD = 3;     // 近距離(m)
export const BOUNCE_NEAR_THRESHOLD = 8;      // 中距離(m)
export const BOUNCE_MID_THRESHOLD = 15;      // 遠距離(m)

// 盗塁定数
// NPB準拠: 企図0.5-0.8回/試合、成功率65-70%
// 変更前: 試行率が高すぎ1.56企図/試合、成功率73.8%
// 変更後: 試行率を約半減→目標0.6-0.8企図/試合、成功率65-70%
// 2塁盗塁試行率 (speed閾値→試行率)
export const SB_ATTEMPT_80 = 0.10;  // speed>=80: 変更前0.20→0.10
export const SB_ATTEMPT_70 = 0.06;  // speed>=70: 変更前0.12→0.06
export const SB_ATTEMPT_60 = 0.025; // speed>=60: 変更前0.05→0.025
export const SB_ATTEMPT_50 = 0.008; // speed>=50: 変更前0.02→0.008
// 3塁盗塁試行率
export const SB3_ATTEMPT_85 = 0.04; // speed>=85: 変更前0.08→0.04
export const SB3_ATTEMPT_75 = 0.02; // speed>=75: 変更前0.04→0.02
export const SB3_ATTEMPT_65 = 0.006; // speed>=65: 変更前0.01→0.006
// 成功率計算定数
// baseRate 0.65→0.60に変更（成功率を73.8%→約67%に調整）
export const SB_BASE_SUCCESS_RATE = 0.60;    // 2塁盗塁基本成功率 変更前0.65
export const SB3_BASE_SUCCESS_RATE = 0.55;   // 3塁盗塁基本成功率 変更前0.60
export const SB_SPEED_BONUS = 0.005;         // speed1ポイントあたりの成功率上乗せ
export const SB_ARM_PENALTY = 0.004;         // 捕手arm1ポイントあたりの成功率低下(2塁)
export const SB3_ARM_PENALTY = 0.005;        // 捕手arm1ポイントあたりの成功率低下(3塁)
export const SB_MAX_SUCCESS = 0.90;          // 最大成功率上限
export const SB_MIN_SUCCESS = 0.25;          // 最低成功率下限
// 2アウト時の試行率係数
// 変更前: 0.3（2アウト時に試行率を抑制）
// 変更後: 1.3（2アウト時はアウトになってもチェンジだけなのでリスクが低く、試行率を促進）
export const SB_TWO_OUTS_FACTOR = 1.3;

// 牽制球パラメータ
export const PICKOFF_ATTEMPT_RATE = 0.04;     // 走者ありの打席で牽制を試みる確率
export const PICKOFF_SUCCESS_RATE = 0.08;     // 牽制成功率（走者速度で補正）

// ワイルドピッチ(WP) / パスボール(PB) 確率定数
// NPB準拠: WP約0.3回/試合、PB約0.1回/試合（1試合約270投球ベース）
// 変更前: 実装なし
// 変更後: WP基本確率0.0008/投球（control=50想定、低制球で上昇）、PB基本確率0.0003/投球（catching=50想定）
export const WP_BASE_RATE = 0.0008;          // WP基本発生率(/投球)
export const WP_CONTROL_FACTOR = 0.000012;   // control1ポイントごとのWP発生率変化（低controlで上昇）
export const PB_BASE_RATE = 0.0003;          // PB基本発生率(/投球)
export const PB_CATCHING_FACTOR = 0.000004;  // catching1ポイントごとのPB発生率変化（低catchingで上昇）

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
export const AGENT_BASE_REACTION = 0.50;         // 全ポジション共通基本反応時間(秒)
export const AGENT_AWARENESS_REACTION_SCALE = 0.004; // awareness 1ポイントあたりの反応時間短縮(秒)
export const AGENT_REACTING_SPEED_RATIO = 0.20;      // REACTING中の移動速度割合（初動フェーズ）

// ダイビングキャッチ
export const AGENT_DIVE_MIN_DIST = 1.5;          // ダイビング可能最小距離(m)
export const AGENT_DIVE_MAX_DIST = 3.0;          // ダイビング可能最大距離(m)
export const AGENT_DIVE_BASE_RATE = 0.15;        // ダイビング基本成功率
export const AGENT_DIVE_SKILL_FACTOR = 0.003;    // 守備力1あたりのダイビング成功率上昇

// ランニングキャッチ
export const AGENT_RUNNING_CATCH_BASE = 0.65;    // ランニングキャッチ基本成功率
export const AGENT_RUNNING_CATCH_SKILL = 0.003;  // 守備力1あたりの成功率上昇

// 知覚ノイズ
export const AGENT_PERCEPTION_BASE_NOISE = 12;   // 基本ノイズσ(m)
// 打球高さによる知覚ノイズ減衰率
// 旧: launchAngle(0-60°範囲, 0.03/度) → 新: maxHeight(0-25m範囲, 0.07/m)
// 低い打球=高ノイズ(読みにくいライナー)、高い打球=低ノイズ(放物線が読めるフライ/ポップ)
export const PERCEPTION_ANGLE_DECAY_RATE = 0.09;

// 移動
export const AGENT_ACCELERATION_TIME = 0.5;      // 0→最高速に達するまでの時間(秒)
export const AGENT_BASE_SPEED = 6.5;             // 全ポジション共通基本走速(m/s)
export const AGENT_SPEED_SKILL_FACTOR = 2.25;    // speed/100 あたりの走速追加(m/s)
export const BACKUP_DRIFT_THRESHOLD = 40;        // バックアップ判定距離(m) — これ以上は「遠い」
export const DRIFT_RATIO_MIN = 0.10;             // 遠方ドリフト最小割合 (fielding=0)
export const DRIFT_RATIO_MAX = 0.25;             // 遠方ドリフト最大割合 (fielding=100)

// 打球高さベースの行動分岐閾値（isGroundBall/ballType分岐の物理置換）
export const HIGH_BALL_THRESHOLD = 3.0;          // この高さ以上の打球はフライ系の挙動(m)
export const CONCURRENT_PURSUIT_HEIGHT = 5.0;    // この高さ未満は2人追跡可、以上は1人(m)

// Phase 5: 結果解決フェーズ用（レガシー: Phase 2 ティックループ移行後に削除予定）
export const OUTFIELD_DEPTH_THRESHOLD = 45;     // 外野域判定の距離閾値(m)
export const SECOND_BASE_PROXIMITY = 5.0;        // 2塁ベース踏み判定距離(m)
export const FIRST_BASE_PROXIMITY = 8.0;         // 1塁自己処理判定距離(m)

// ============================================================
// Phase 2 ティックループ用定数（捕球後の送球・走塁シミュレーション）
// ============================================================

export const PHASE2_DT = 0.05;                   // Phase 2 タイムステップ(秒) — 送球判定の精度のため細かめ
export const MAX_PHASE2_TIME = 15.0;             // Phase 2 最大シミュレーション時間(秒) ※三塁打到達に~12s必要
export const SECURING_TIME_BASE = 0.25;          // 捕球→送球準備の基本時間(秒)
export const SECURING_TIME_SKILL_SCALE = 0.15;   // fielding/100 あたりの準備時間短縮(秒)
export const PIVOT_TIME = 0.35;                  // DP ピボット時の追加準備時間(秒)
export const THROW_SPEED_BASE = 30;              // 送球速度の基本値(m/s)
export const THROW_SPEED_ARM_SCALE = 20;         // arm/100 あたりの送球速度追加(m/s)
export const RUNNER_SPEED_BASE = 6.5;            // 走者の基本走速(m/s)
export const RUNNER_SPEED_SCALE = 2.5;           // speed/100 あたりの走速追加(m/s)
export const BATTER_START_DELAY = 0.65;          // 打者走者のスタート遅延(秒)
export const TAGUP_DELAY = 0.3;                  // タッチアップ反応遅延(秒)
export const BASE_TAG_TIME = 0.15;               // ベースタッチ所要時間(秒)

// ============================================================
// ランナーエージェント自律走塁判断用定数
// ============================================================

// ボール回収モデル
export const RETRIEVER_APPROACH_FACTOR = 0.6;    // 回収時の走速低下率(減速+ボール読み)
export const RETRIEVER_PICKUP_TIME = 1.5;        // ボール拾い上げ+送球体勢までの時間(秒)
export const DEEP_HIT_PENALTY_THRESHOLD = 65;    // この着弾距離(m)以上でボール回収ペナルティ発生
export const DEEP_HIT_PENALTY_SCALE = 40;        // ペナルティが最大になるまでの距離レンジ(m)
export const DEEP_HIT_PENALTY_MAX = 3.5;         // 深い外野ヒット時の最大追加回収時間(秒)

// エキストラベース（ヒット時の進塁判断）
export const EXTRA_BASE_ROUNDING_TIME = 0.3;     // 塁を回る基本所要時間(秒)
export const EXTRA_BASE_ROUNDING_FATIGUE = 1.5;  // 塁を回るごとの疲労加算(秒): 2→3で+1.5, 3→4で+3.0
export const EXTRA_BASE_GO_THRESHOLD = -0.2;     // 進塁GO閾値(負=やや積極的に走る)
export const EXTRA_BASE_DECISION_NOISE = 0.4;    // 判断ノイズσ(baseRunning=0時)

// タッチアップ判断
export const TAGUP_ARM_PERCEPTION_NOISE = 20;    // 肩力知覚ノイズσ(baseRunning=0時)
export const TAGUP_GO_THRESHOLD = -0.5;          // タッチアップGO閾値(負=積極的にタッチアップ)
export const TAGUP_DECISION_NOISE = 0.3;         // 判断ノイズσ(baseRunning=0時)

// ゴロ時非フォース走者の進塁判断
export const GROUND_ADVANCE_GO_THRESHOLD = 1.0;  // ゴロ進塁GO閾値(高め=保守的)
export const GROUND_ADVANCE_DECISION_NOISE = 0.3; // 判断ノイズσ(baseRunning=0時)

// 外野手タッチアップ送球判断
export const TAGUP_THROW_MARGIN_BASE = 0.8;      // 送球判断基本マージン(秒)
export const TAGUP_THROW_MARGIN_AWARENESS_SCALE = 0.6; // awareness依存の送球断念スケール
