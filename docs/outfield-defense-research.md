# 外野守備AI 実データ・知見まとめ

守備AIシミュレーション実装の参考資料。MLB Statcastデータ、学術研究、コーチング資料から収集。

---

## 1. 外野手の初動・ルート効率

### Statcast Jump メトリクス

Statcastは外野手の初動を「Jump」として3つのフェーズに分解して計測する:

| フェーズ | 時間窓 | 内容 |
|---|---|---|
| **Reaction** | 投球リリースから最初の1.5秒 | 打球への反応・最初の一歩。任意方向への移動距離(ft) |
| **Burst** | 次の1.5秒 (1.5〜3.0秒) | 加速フェーズ。任意方向への移動距離(ft) |
| **Route** | 全3.0秒 | 任意方向の移動距離 vs 正しい方向への移動距離の比率 |

**重要な知見:**
- **リアクション(初動)が最も重要**: ルート効率よりも初動の速さが守備力を決定づける
- ルート効率は年度間の相関が低く、スキルとしての再現性が低い
- トップスピードが難しいプレーでの最大の差別化要因

**具体例:**
- Enrique Hernandez: リアクション +4.3ft (リーグ平均比)で2位以下に1ft差をつけたが、ルート効率は104人中下位10位以内。それでも3秒間でリーグ最多の距離をカバー

### 初動の反応時間

| 打球方向 | 反応時間 | 備考 |
|---|---|---|
| 左右への打球 | 約0.5秒 | 軌道を認識するまでの時間 |
| 正面への打球 | 約2.0秒 | 浅いフライか深いフライかの判断に時間がかかる |
| 打球音による先読み | 約0.3秒 | 音がCFに届くまでの時間。1-2歩の差になりうる |

### ルート効率(Route Efficiency)

- **定義**: 野手の実移動距離 / 初期位置から捕球位置までの直線距離
- エリート外野手で95%以上
- ただしStatcastは現在、ルート効率よりもJumpメトリクスを重視している

---

## 2. フライボールの追球

### 学術研究: 外野手はどうやってフライの落下点を予測するか

3つの主要理論がある:

#### (a) LOT理論 (Linear Optical Trajectory)
- McBeath et al. (1995), Science誌
- 外野手はボールの「光学的軌跡」が直線になるように走る
- ボールの像が常にまっすぐ上昇するよう走路を調整する
- 距離や位置の知識は不要
- **横方向の追球**で最も支持されている

#### (b) OAC理論 (Optical Acceleration Cancellation)
- 外野手はボールの光学的加速度をゼロに保つように走る
- VR実験では前後方向の動きはOACに一致
- **前後方向の追球**で支持されている

#### (c) 実際のプロの動き
- 打球への「最初の一歩」の速さ(ジャンプ)が、ルートの正確さより圧倒的に重要
- 優秀な外野手は打球音や打者のスイングから先読みしている
- 良いルートよりも「すぐ動き出すこと」がキャッチ率を決める

### ドリフト vs 全力疾走

- **ルーティンフライ**(Catch Probability 90%+): 落下点に余裕を持って到着→最後はドリフト(微調整しながら歩み寄る)
- **難しいフライ**(Catch Probability 50%以下): 全力疾走。ルートは二の次で、まずスピード
- **背走フライ**: 最も難易度が高い。まず背中を向けて全力疾走→最後に振り返って位置調整

---

## 3. 外野手のスプリント速度

### MLB Statcast Sprint Speed

Statcastの「Sprint Speed」は、競争的なプレーにおける最速1秒間の速度(ft/s)を計測する。

| カテゴリ | 速度 (ft/s) | 備考 |
|---|---|---|
| **エリート (Bolt)** | 30.0+ | Boltは30ft/s以上の走塁を指す |
| **トップクラス** | 29.0〜30.0 | Byron Buxton (29.7), Billy Hamilton (29.8) |
| **リーグ平均** | **27.0** | 全MLB選手の平均 |
| **遅い** | 23.0〜25.0 | 一塁手・捕手レベル |

### シミュレーション用換算

| ft/s | m/s | 100m換算 | 備考 |
|---|---|---|---|
| 30.0 | 9.14 | 10.9秒 | MLB最速クラス |
| 27.0 | 8.23 | 12.1秒 | MLB平均 |
| 24.0 | 7.32 | 13.7秒 | 遅い選手 |

**注意**: Sprint Speedは最速1秒間の瞬間速度であり、静止状態からの加速は含まない。実際の守備では初動0.5秒のリアクション + 加速フェーズが必要。

---

## 4. 外野からの送球

### 送球速度 (Arm Strength)

Statcastは外野手の上位10%の送球速度の平均を「Arm Strength」として計測する(最低50送球で資格)。

| カテゴリ | 速度 (mph) | 速度 (km/h) | 備考 |
|---|---|---|---|
| **エリート** | 95〜100+ | 153〜161+ | Acuna Jr. (97.9avg, 101.5max) |
| **リーグ平均** | **約85** | 約137 | 全外野手の平均 |
| **弱い腕** | 75〜80 | 121〜129 | LF配置が多い |

### ポジション別の傾向

| ポジション | 肩の強さ | 理由 |
|---|---|---|
| **RF (右翼)** | 最も強い | 三塁・本塁への長い送球が多い |
| **CF (中堅)** | 強い | 広範囲カバーが優先だが、肩も重要 |
| **LF (左翼)** | 最も弱くてよい | 三塁への距離が近い |

### 送球距離の目安

| ルート | 距離 (ft) | 距離 (m) | 備考 |
|---|---|---|---|
| CF → ホーム | 約300〜330 | 91〜100 | 最長の送球ルート |
| RF → 三塁 | 約250〜280 | 76〜85 | タッチアップ阻止 |
| LF → 三塁 | 約150〜180 | 46〜55 | 比較的短い |
| CF → 二塁 | 約150〜180 | 46〜55 | シングルヒットでの送球 |
| 外野 → カットオフ | 約150〜200 | 46〜61 | 中継プレー |

### 中継(リレー)プレーの物理

The Hardball Times の研究による:

- **同じ腕の強さの場合**: 距離を等分(各200ft)するのが最適
- **腕の強さが違う場合**: 強い腕が長い距離を投げるべき
- **中継の方が有利な理由**: ボールは空気抵抗で減速するため、2回に分けた方がトータル時間が短い
- **高校レベル**: 中継プレーの方が3/4のケースで直接送球より速く正確
- **MLB**: エリート選手は中継のアドバンテージを縮めるが、完全には消えない
- **中継の精度目標**: 約3ft x 3ftの範囲(胸から頭の高さ)

---

## 5. 外野手のポジショニング

### デフォルト位置

| ポジション | ホームからの距離 (ft) | 角度 | 備考 |
|---|---|---|---|
| **LF** | 270〜280 | -33度〜-21度 | 0度 = 二塁方向 |
| **CF** | 300〜320 | -10度〜+10度 | 最も深い |
| **RF** | 270〜280 | +21度〜+33度 | LFとほぼ対称 |

**注**: フェンスまでの距離はLF/RF線で325ft以上、CFで400ft以上(1958年以降建設の球場)。外野手はフェンスとインフィールドの概ね中間に位置する。

### 状況による調整

| 状況 | 調整 |
|---|---|
| 強打者・長打警戒 | 5〜15ft 深め |
| 弱打者・バントの可能性 | 10〜20ft 浅め |
| 2アウト・ランナーなし | やや深め(長打警戒) |
| ランナー三塁・1アウト未満 | やや浅め(犠牲フライ阻止) |
| 左打者 vs 右打者 | 引っ張り方向にシフト |

---

## 6. ダイビングキャッチ

### 発生頻度と成功率

- 全打球のうちダイビングが必要な打球は約10%
- エリート外野手のダイビングキャッチ成功率: 約90%(10回ダイブして9回成功)
- Statcastはダイビング自体を個別に追跡しない。Catch Probabilityで統合的に評価

### Catch Probability スター評価

| スター | Catch Probability | 難易度 |
|---|---|---|
| 5 | 0〜25% | 超高難度(ダイビング・全力疾走が必須) |
| 4 | 26〜50% | 高難度 |
| 3 | 51〜75% | 中難度 |
| 2 | 76〜90% | やや難 |
| 1 | 91〜95% | ルーティンに近い |
| (評価なし) | 95%+ | 完全なルーティン |

**5スターの実態**: 2025年シーズンで5スター機会は2,688回あり、そのうち捕球されたのはわずか192回(7.1%)。

### ダイビングの判断基準(シミュレーション用)

- Catch Probability 25〜50%の打球でダイビングが発生しやすい
- 外野手の走力・反応速度・ルート効率が複合的に影響
- ダイビングは「走っても間に合わないが、飛べば届く」距離で発生

---

## 7. 壁際のプレー

### ウォーニングトラック

- **幅**: MLB球場で通常約16ft (約5m)
- **素材**: 土またはゴム(芝との違いが足で感じられる)
- **1949年にMLBが正式に義務化**

### 壁際の技術

| テクニック | 内容 |
|---|---|
| **ステップカウント** | ウォーニングトラックに入ってから壁まで何歩かを体で覚える |
| **ウォーニングトラックシャッフル** | トラックに入ったら歩幅を短くし、壁への衝突に備える |
| **壁の確認** | 片手を伸ばして壁の位置を確認しながらキャッチ |
| **内部時計** | 練習でトラック踏み込みからの歩数感覚を養う |

### シミュレーションへの示唆

- フェンスから16ft以内に入ったら減速開始
- フェンスから5ft以内ではジャンプキャッチまたは諦め判断
- 壁際での捕球成功率は通常より大幅に低下

---

## 8. 外野手間の連携

### フライボール優先ルール

| 優先順位 | ルール |
|---|---|
| **1. CF (中堅手)** | 全外野手の中で最高優先。CFが呼んだら全員が引く |
| **2. コーナーOF** | LF・RFは内野手より優先 |
| **3. 内野手** | 外野手がコールしたら必ず譲る |

### コミュニケーション

| コール | 意味 | 使う場面 |
|---|---|---|
| "I got it!" / "Mine!" | 自分が捕る | 捕球を宣言 |
| "You, you, you!" | 相手が捕って | 譲りの確認 |
| "Ball, Ball, Ball!" | (内野手が)自分が捕る | 内野手の宣言 |

### 2人が追う場合

- **原則**: 打球に向かって前進する選手が優先(前に来る選手の方がキャッチしやすい)
- **CF優先**: CF vs LF/RFの場合は常にCFが優先
- **LF vs RF**: ほぼ起きないが、打球に近い方が優先
- **衝突防止**: コールが聞こえなかった場合が最も危険。声掛けの習慣が重要

---

## 9. タッチアップへの対応

### 捕球から送球までの流れ

1. **捕球体勢**: モメンタムを送球方向に残して捕球(投げる側の足を後ろに)
2. **ステップ**: 捕球後1〜2歩でクロウホップ(助走ステップ)
3. **送球**: フルスローで中継マンまたは直接ベースへ

### タイミングの目安

| 要素 | 時間 | 備考 |
|---|---|---|
| フライの滞空時間 | 4.0〜5.5秒 | 通常の外野フライ |
| 捕球→リリース | 0.8〜1.5秒 | クロウホップ含む |
| 送球の飛行時間 (300ft, 85mph) | 約2.4秒 | 物理計算。空気抵抗で増加 |
| ランナーの三塁→本塁 | 約3.5〜4.0秒 | 90ftを走る時間 |

### シミュレーション用の判断ロジック

- 「捕球→リリース時間 + 送球飛行時間」vs「ランナーの走塁時間」で判定
- 外野手の肩の強さ・捕球位置からの距離が決定的
- 浅いフライほど送球が速いが、ランナーも迷いやすい

---

## 10. 打球落下点の予測

### プロ外野手の知覚戦略

研究者McBeath (1995, Science) による主要な発見:

1. **外野手は落下点を「計算」しない**: 物理的な放物線を予測するのではなく、知覚的なフィードバックループで走路を調整する
2. **LOT戦略**: ボールの見かけの軌跡を直線に保つように走る。これにより落下点に自動的に到達する
3. **前後判断と左右判断は別**: 前後方向はOAC(光学的加速度キャンセル)、左右方向はLOT(線形光学軌跡)を使い分ける可能性がある
4. **経験の役割**: 打球音・スイング角度・打球の初速から瞬時に大まかな方向を判断(先読み)

### シミュレーションへの変換

シミュレーションでは外野手は打球の正確な軌道データにアクセスできるため、人間の知覚モデルを直接再現する必要はない。代わりに:

| 人間の行動 | シミュレーションでの表現 |
|---|---|
| 反応遅延 (0.5秒) | tick 0で打球情報を取得するが、動き出しに遅延を入れる |
| 不完全なルート | ルート効率パラメータ(95〜98%)で直線からのずれを表現 |
| 全力疾走 vs ドリフト | Catch Probabilityに応じて走行速度を切り替え |
| 背走の難しさ | 背走時に速度ペナルティ(通常の85〜90%) |
| ダイビング | 距離が1〜3ft足りない時にダイブ判定。成功率は能力依存 |
| 壁際の減速 | フェンスから16ft以内で最高速度を制限 |

---

## 出典・参考URL

### Statcast公式
- [Sprint Speed 定義](https://www.mlb.com/glossary/statcast/sprint-speed)
- [Arm Strength 定義](https://www.mlb.com/glossary/statcast/arm-strength)
- [Catch Probability 定義](https://www.mlb.com/glossary/statcast/catch-probability)
- [Jump 定義](https://www.mlb.com/glossary/statcast/jump)
- [Route Efficiency 定義](http://m.mlb.com/glossary/statcast/route-efficiency)
- [Outfielder Jump Leaderboard](https://baseballsavant.mlb.com/leaderboard/outfield_jump)
- [Sprint Speed Leaderboard](https://baseballsavant.mlb.com/leaderboard/sprint_speed)
- [Arm Strength Leaderboard](https://baseballsavant.mlb.com/leaderboard/arm-strength)
- [Catch Probability Leaderboard](https://baseballsavant.mlb.com/leaderboard/catch_probability)
- [Fielder Positioning Visual](https://baseballsavant.mlb.com/visuals/fielder-positioning)

### 学術研究
- [How Baseball Outfielders Determine Where to Run to Catch Fly Balls (McBeath 1995, Science)](https://www.science.org/doi/10.1126/science.7725104)
- [LOT: A Linear Optical Trajectory Informs the Fielder (McBeath 2003)](https://www.researchgate.net/publication/8988785)
- [Catching fly balls in virtual reality (Fink 2009)](https://pmc.ncbi.nlm.nih.gov/articles/PMC3816735/)
- [Pulled fly balls are harder to catch (Springer 2022)](https://link.springer.com/article/10.1007/s12283-022-00373-6)

### 分析記事
- [Learning From Statcast's Outfield Jump Metrics (FanGraphs)](https://blogs.fangraphs.com/learning-from-statcasts-outfield-jump-metrics/)
- [Early Insights From Statcast's Outfield Catch Probability Metrics (FanGraphs)](https://blogs.fangraphs.com/early-insights-from-statcasts-outfield-catch-probability-metrics/)
- [The Physics of the Cutoff (The Hardball Times)](https://tht.fangraphs.com/tht-live/the-physics-of-the-cutoff/)
- [The Physics of the Cutoff: Part II (The Hardball Times)](https://tht.fangraphs.com/the-physics-of-the-cutoff-part-ii/)
- [The Physics and Timing of the Outfield Bounce Throw (The Hardball Times)](https://tht.fangraphs.com/the-physics-and-timing-of-the-outfield-bounce-throw/)
- [Let's Admire Some of the Strongest Arms in Baseball (FanGraphs)](https://blogs.fangraphs.com/lets-admire-some-of-the-strongest-arms-in-baseball/)
- [Most Valuable Outfielder Throwing Arms of 2023 (MLB.com)](https://www.mlb.com/news/most-valuable-outfielder-throwing-arms-of-2023)
- [Optimizing Outfield Positioning (SABR)](https://sabr.org/journal/article/optimizing-outfield-positioning-creating-an-area-based-alignment-using-outfielder-ability-and-hitter-tendencies/)

### コーチング資料
- [Outfield Basics (Pro Baseball Insider)](https://probaseballinsider.com/baseball-instruction/outfield/outfield-1-the-basics/)
- [Tracking Fly Balls (Pro Baseball Insider)](https://probaseballinsider.com/baseball-instruction/outfield/outfield-2-tracking-fly-balls/)
- [Outfield Wall Awareness Techniques](https://baseballtips.com/outfield-wall-awareness-techniques/)
- [Pop-Up and Fly Ball Priority](https://spiderselite.com/2018/07/01/pop-up-and-fly-ball-priority/)
- [Pop Fly Priorities (Pro Baseball Insider)](https://probaseballinsider.com/baseball-instruction/pop-fly-priorities/)
- [How the Physics of Baseball Works (HowStuffWorks)](https://entertainment.howstuffworks.com/physics-of-baseball9.htm)
