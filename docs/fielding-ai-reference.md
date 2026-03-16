# 守備AIシミュレーション参考資料: 実データ・知見まとめ

## 1. 投手のフィールディング (PFP: Pitcher Fielding Practice)

### バント処理・ゴロ処理の頻度
- 投手の守備機会はMLB全体のプットアウトの約**2.0%**（2012年: 2,580プットアウト）
- Range Factor（(刺殺+補殺)×9/イニング）で見ると、投手は他ポジションに比べ機会が少ない
- グラウンドボール投手がマウンドにいると、内野手の守備機会が増加する（投手自身の機会も若干増）
- GO/AO（ゴロアウト/フライアウト比）の計算にはバントは含まれない

### PFPで訓練される主な守備プレー
1. **バント処理**: ランナー状況別（無走者、一塁、三塁/スクイズ）
2. **ゴロ処理**: マウンド付近のゴロを捕球→一塁送球
3. **一塁カバー**: 一塁手が打球処理に出た際のカバー
4. **バックアップ**: 各状況に応じた三塁/本塁バックアップ
5. **コミュニケーション**: 誰が捕るかの声出し（特にバント時の判断）

出典:
- [Dead Cow Baseball - PFPs](http://deadcowbaseball.com/pitcher-fielding-practice-pfps.html)
- [GoRout - Baseball PFP Guide](https://gorout.com/baseball-pfp-pitcher-fielding-practice/)
- [Baseball-Reference - 2025 Standard Fielding](https://www.baseball-reference.com/leagues/majors/2025-standard-fielding.shtml)

---

## 2. 投手の一塁カバー

### いつカバーに走るか
- **一塁手の右方向（二塁寄り）へのゴロ**で、一塁手がベースから離れた時
- **バント処理**で一塁手が前に出た時
- 原則: **打球が右方向に飛んだ瞬間に即座にスタート**。待って確認してはいけない

### 走るルート（バナナルート）
- 一塁に直線で走るのではなく、**ファウルライン上の約2/3地点をまず目指す**
- そこから**ライン沿いに並行して走り、一塁ベース内側を右足で踏む**
- 直線で走ると:
  - ランナーとの衝突リスク
  - 一塁手からの送球を背中側で見ることになり捕球困難
- ベース踏み後はフェア地域（内野側）に逸れて安全確保

### 実行のポイント
- 打球が打たれた瞬間に走り出す（誰が処理するか確認せずスタート）
- ベースの内側半分を踏む（右足が望ましい）
- 一塁手からのトスを受ける際は走りながらキャッチ

出典:
- [Plate Crate - When Does Pitcher Cover First](https://www.platecrate.com/blogs/baseball-101/when-does-the-pitcher-cover-first-base)
- [Active.com - Pitcher's Guide to Covering First](https://www.active.com/baseball/articles/pitcher-s-guide-to-covering-first-base)
- [JES Baseball - Pitcher Covering First](https://www.jes-baseball.com/baseball/plapitchercoveringfirst.html)

---

## 3. 投手のバックアップ

### 基本原則
- バックアップ位置は**ベースの後方深く、送球の延長線上**に立つ
- 悪送球を視野に入れてキャッチできる距離を確保

### 本塁バックアップ
- **二塁走者がいて外野ヒット**（特に右中間・右翼方向）の場合
- ホームプレートの後方、**送球の直線延長線上**にポジション
- 十分な距離を取り、プレーを正面に見られる位置

### 三塁バックアップ
- 外野ヒットでランナーが三塁を狙う場合
- ファウル地域（三塁後方）に位置

### 判断の分岐点
- 投手は打球が飛んだ瞬間、**三塁線と本塁の中間（ファウル地域）**に移動
- プレーの展開を見て、**送球先が三塁なら三塁後方、本塁なら本塁後方**に移動
- つまり最初は「どちらにも行ける中間位置」で待機→展開を見て判断

出典:
- [Spiders Elite - Cutoff and Backup: Pitchers](https://spiderselite.com/2016/02/24/baseball-cutoff-and-backup-pitchers/)
- [Full Windup - Backing Up Bases](https://www.fullwindup.com/2012/02/backing-up-bases/)
- [Baseball Excellence - Pitchers Back Up Bases](https://baseball-excellence.com/pitchers-back-up-bases/)
- [Defensive Situations and Strategies (PDF)](https://cdn1.sportngin.com/attachments/document/0098/4522/Defensive_Situations_and_Strategies.pdf)

---

## 4. 捕手のフレーミング（参考）
- フレーミングとは、ストライクゾーン際のボールをストライクに見せる技術
- Statcastでは「Strike Zone Plus/Minus」として追跡
- シミュレーションでは、捕手の守備力が高いほどストライクゾーン判定がわずかに有利になるパラメータとして表現可能

---

## 5. 捕手のバント処理

### 判断基準
- **自分が一番早く到達できるなら積極的に処理する**
- 投手・一塁手・三塁手と同時に到達する場合:
  - 捕手は勢い（モメンタム）がフィールド方向に向くので送球しやすい
  - 三塁手のほうが角度的に一塁送球がしやすい場合は譲る
- **迷った場合は「一塁で確実にアウト」を優先**（リード走者への送球は確信がある時のみ）

### コミュニケーション
- 捕手がフィールドの「司令塔」として送球先を声で指示
- 「ファースト!」（一塁送球）や「サード!」（三塁送球）を叫ぶ
- 自分が処理しない場合は、処理する野手の邪魔にならないよう退避

出典:
- [Encyclopedia of Baseball Catchers - Fielding Bunts](https://members.tripod.com/bb_catchers/catchers/skills_bunt.htm)
- [QC Baseball - Sacrifice Bunt Defense](http://www.qcbaseball.com/situations/sacrifice-bunt-runner-on-first.aspx)
- [WRSSBA - Catcher Fundamentals](https://wrssba.com/coaches/skills-and-drills/catcher-fundamentals/)

---

## 6. 捕手の送球

### ポップタイム（Pop Time）: 二塁盗塁阻止
| 指標 | 数値 |
|------|------|
| **MLB平均ポップタイム** | **2.01秒** (2022年: 1.98秒) |
| エリート | 1.89秒以下 |
| 平均的 | 1.95〜2.05秒 |
| 劣る | 2.14秒以上 |
| 歴代最速級 | J.T. Realmuto: 1.82秒 |

### ポップタイムの内訳
| 構成要素 | MLB平均 | エリート | 劣る |
|----------|---------|---------|------|
| **エクスチェンジ（捕球→リリース）** | **0.73秒** | 0.64秒 | 0.85秒 |
| **ボール飛行時間** | **約1.28秒** | - | - |

- エクスチェンジはポップタイムの約**36.6%**、ボール飛行時間が約**63.4%**
- ホームから二塁までの距離: 約**127フィート（38.7m）**
- 87mph(140km/h)の送球で約1.0秒のボール飛行時間

### 各塁への送球
- **二塁**: 盗塁阻止が最も多い。上記のポップタイムが指標
- **三塁**: 二塁走者の盗塁阻止。距離が短い分ポップタイムも短い
- **一塁**: 牽制球。一塁走者の離塁を抑制する目的

出典:
- [MLB.com - Pop Time Glossary](https://www.mlb.com/glossary/statcast/pop-time)
- [Baseball Savant - Catcher Pop Time Leaderboard](https://baseballsavant.mlb.com/leaderboard/poptime)
- [Driveline Baseball - Catcher Pop Time](https://www.drivelinebaseball.com/2018/10/catchers-voyage-towards-velocity/)
- [Catchers Home - Pop Time Overview](https://catchershome.com/pop-time-for-catchers/)

---

## 7. 捕手のバックアップ（一塁）

### いつ一塁バックアップに行くか
- **走者なし（または一塁走者のみ）で内野ゴロ**の場合
- 特に**右方向（一塁・二塁方向）のゴロ**で優先度が高い
- 他にプレーが発生しない（本塁でのプレーがない）場合

### 方法
- マスクをファウルライン付近の芝生に落とす
- 一塁の後方（ファウル地域側）に移動
- 悪送球や一塁手のファンブルに備える
- ランナーと競争するのではなく、適切な位置取りを優先

出典:
- [Ballparks of America - Catcher Defense Fundamentals](https://ballparksofamerica.com/baseball-basics-catcher-defense-fundamentals/)
- [The Catching Guy - 5 Responsibilities Often Forgotten](https://thecatchingguy.com/5-often-forgotten-andor-misunderstood-responsibilities-catcher)
- [HS Baseball Web - Catcher Back Up First](https://community.hsbaseballweb.com/topic/catcher-back-up-first-?nc=1)

---

## 8. 送球先の判断ロジック

### 基本原則: 「2つ先の塁に投げる」
| 走者状況 | 送球先 |
|----------|--------|
| 走者なし | 一塁（打者走者をアウト） |
| 一塁走者 | 二塁（併殺狙い）→ 一塁 |
| 二塁走者 | 本塁（得点阻止） |
| 一塁+二塁 | 二塁（併殺）or 本塁（得点阻止） |
| 満塁 | 本塁（フォースプレー）→ 一塁（併殺完成） |

### 修正要因
- **アウトカウント**:
  - 0アウト: 併殺優先（二塁→一塁のダブルプレー）
  - 1アウト: 状況次第（リード走者 or 併殺）
  - 2アウト: 最も確実なアウト（通常一塁）を優先
- **得点差**:
  - 大差リード: 確実なアウトを優先（リスク回避）
  - 僅差/同点: 得点阻止を最優先
- **イニング**: 終盤ほど得点阻止の重要度が上がる
- **走者の走力**: 足の速い走者には無理な送球をしない
- **打球の種類**: 深いゴロは一塁のみ、浅いゴロはリード走者を狙える

### 外野手の送球判断
- 基本: ランナーの「2つ先の塁」方向にカットマンへ送球
- ダブルプレーの可能性を維持するために慎重に判断
- 走者を進塁させないことを優先（得点圏に進めない）

出典:
- [Pro Baseball Insider - Outfield Strategy: Where to Throw](https://probaseballinsider.com/baseball-instruction/outfield/outfield-strategy-where-to-throw-the-ball/)
- [Defensive Situations and Strategies (PDF)](https://cdn1.sportngin.com/attachments/document/0098/4522/Defensive_Situations_and_Strategies.pdf)

---

## 9. カットオフ（中継）の判断

### カットマンのポジショニング
- 外野手と送球先のベースを結ぶ**直線上**に立つ
- 二塁ベースの三塁側約**15〜20フィート（4.5〜6m）**が基本位置
- ランナーとボールの両方を視野に入れる

### カットするかスルーするかの判断
| コール | 意味 |
|--------|------|
| (塁番号のみ) | スルー（送球をそのまま通す） |
| 「カット!」+ 塁番号 | カットして指定の塁に送球 |
| 「カット!」のみ | カットしてボールを保持 |

### 判断基準
- **送球の精度**: 送球がそれている場合 → カット
- **走者の位置**: リード走者がアウトにできない場合 → カットして他の走者を狙う
- **送球の強さ**: ベースまで届かない送球 → カット
- ベースカバーの選手がコールを出し、カットマンはそれに従いつつ自分でも判断する

出典:
- [Pro Baseball Insider - Cut-offs and Relays](https://probaseballinsider.com/shortstop-positioning-part-1-cut-offs-and-relays/)
- [Strike Zone Academy - Relays and Cutoffs](https://strikezoneacademy.com/baseball-relays-and-cutoffs/)
- [The Hardball Times - Physics of the Cutoff Part II](https://tht.fangraphs.com/the-physics-of-the-cutoff-part-ii/)
- [ABCA - Execution of the Cutoff and Relay System](https://www.abca.org/magazine/magazine/2020-4-July_August/The_Hot_Corner_Execution_of_the_Cutoff_and_Relay_System.aspx)

---

## 10. ランダウンプレー（挟殺プレー）

### 基本的な動き方
1. ボールを持った野手が**走者に向かって全力で走る**（走者を判断させる）
2. 走者がコミットした（逆方向に走り始めた）ら**即座にパートナーに送球**
3. パートナーはベース付近でスタンバイし、送球を受けてタッグ

### ポジショニングルール
- 2人の野手は**走者の同じ側（例: インフィールド草地側）**に位置する
  - 送球が走者に当たるのを防ぐ
  - 送球の見通しを確保
- ベースカバー役は**ベース手前**で待機（ベース上ではなくやや前で受ける）

### 成功のための鍵
- **最小限の送球回数**（理想は**2回以下**）で完了
  - 送球回数が増えるほどエラーリスクが増大
- ボールを受けたら即座に**投げる手に持ち替える**
- コミュニケーション: 「ナウ!」「ボール!」などシンプルなコール
- 走者を**元の塁に追い返す**のが基本（進塁させない）

出典:
- [Pro Baseball Insider - How to Do a Rundown](https://probaseballinsider.com/baseball-instruction/how-to-do-a-rundown-or-pickle/)
- [Baseball Monkey - Baseball Pickle: Rundown](https://www.baseballmonkey.com/learn/baseball-pickle-rundown)
- [Wikipedia - Rundown](https://en.wikipedia.org/wiki/Rundown)
- [Youth Baseball Edge - 3 Simple Rules for Rundowns](https://www.youthbaseballedge.com/rundowns-3-simple-rules/)

---

## 11. エラーの発生パターン

### MLB全体のエラー率
- 2023年: 1試合あたり平均**0.52エラー**（3年連続で過去最低を更新）
- インプレーの打球に対するエラー率: 約**2.25%**（過去は約3%が長年の基準）

### エラータイプ
| タイプ | 説明 |
|--------|------|
| **捕球エラー** | ゴロやフライの捕球ミス。処理すべき打球を逸らす |
| **送球エラー** | 送球が逸れて捕球者が捕れない。不要な送球も含む |

### ポジション別傾向
- **ショート・三塁手**が最もエラーが多い（難しいゴロ+長距離送球）
- 一塁手は捕球機会が多いが、比較的エラーは少ない
- 外野手のエラーは稀（主に送球エラー）
- 投手のエラーも少ない（守備機会自体が限られる）

### 状況別エラー率（ゴロアウト時）
| 状況 | エラー率 |
|------|---------|
| 一塁走者、2アウト | **3.41%**（最低） |
| 二三塁走者、1アウト | **9.54%**（最高） |
| 走者なし、0アウト | **1.4%** |
| 走者あり、0アウト | **2.1%** |

### フライアウト時のエラー率
- 全体的にゴロより大幅に低い
- 最低: **0.34%**（走者なし+二塁フォース）
- 最高: **0.62%**（二三塁走者、0アウト）

### エラーが起きやすい要因
- **走者がいる状況**: プレッシャー増 → エラー率上昇
- **緊迫した場面**: 二三塁走者+1アウトで最大（9.54%）
- **長距離送球**: ショート→一塁、三塁→一塁の送球エラー
- **難しい体勢での処理**: 逆シングル、背走キャッチなど
- ゴロのエラー率はフライの**約5〜15倍**

出典:
- [ESPN - MLB Errors Track Record Low in 2023](https://www.espn.com/mlb/story/_/id/38522247/mlb-errors-track-another-record-low-2023)
- [ResearchGate - Distribution of Error Rates by Outs and Men-on-base](https://www.researchgate.net/figure/Distribution-of-Error-Rates-by-Outs-and-Men-on-base_tbl5_228809348)
- [Pinstripe Alley - MLB Errors and Frequency Trend](https://www.pinstripealley.com/2013/8/16/4623050/mlb-errors-trends-statistics)
- [Wikipedia - Fielding Error](https://en.wikipedia.org/wiki/Fielding_error)

---

## 12. Statcastの打球データ

### 打球速度（Exit Velocity）の分布
| 指標 | 数値 |
|------|------|
| **MLB平均打球速度** | **約88〜89 mph（141〜143 km/h）** |
| ハードヒット閾値 | 95 mph（153 km/h）以上 |
| MLB選手EV90（90パーセンタイル）中央値 | 104 mph（167 km/h） |
| エリートパワーヒッター | 111〜112 mph |
| パワーのない打者 | 96〜97 mph |

### 打球速度と打率の関係
| 打球速度 | リーグ打率 | 長打率 |
|----------|-----------|--------|
| 95 mph以上（ハードヒット） | **.506** | 1.008 |
| 95 mph未満 | **.221** | .261 |

### ゴロの打球速度閾値
- **75 mph**がゴロが内野を抜ける分岐点
- **95 mph以上**でMLBレベルでもエラー率が上昇

### 打球角度（Launch Angle）の分類
| 打球タイプ | 角度範囲 |
|-----------|---------|
| ゴロ（Ground Ball） | **10度未満** |
| ライナー（Line Drive） | **10〜25度** |
| フライ（Fly Ball） | **25〜50度** |
| ポップフライ（Pop Up） | **50度以上** |

- Statcastの「スウィートスポット」: **8〜32度**
- ホームランが多い角度: **20〜25度**（十分なEVが前提）

### 打球方向の分布（Pull/Center/Oppo）
| 方向 | MLB平均（全打球） |
|------|-------------------|
| プル（引っ張り） | **約40〜41%** |
| センター（中央） | **約35%** |
| オポジット（逆方向） | **約24〜25%** |

- **ゴロのプル率**: 約**51.6%**（ゴロは引っ張りが多い）
- **フライのプル率**: 約**22.7%**（フライは逆方向も多い）
- 長打の52.7%はプル方向（2018年以降）
- バランス型打者例（イチロー）: プル31.3% / センター35.3% / オポジット33.4%

### 打球タイプの分布（リーグ平均）
| タイプ | 割合 |
|--------|------|
| ゴロ（GB%） | **約43%** |
| フライ（FB%） | **約36%** |
| ライナー（LD%） | **約21%** |

出典:
- [MLB.com - Launch Angle Glossary](https://www.mlb.com/glossary/statcast/launch-angle)
- [MLB.com - Exit Velocity Glossary](https://www.mlb.com/glossary/statcast/exit-velocity)
- [Baseball Savant - Exit Velocity & Launch Angle](https://baseballsavant.mlb.com/statcast_field)
- [Baseball America - What's a Good Exit Velocity](https://www.baseballamerica.com/stories/whats-a-good-exit-velocity/)
- [FanGraphs - Batted Ball Direction](https://library.fangraphs.com/offense/batted-ball-direction/)
- [FanGraphs - GB%, LD%, FB%](https://library.fangraphs.com/offense/batted-ball/)
- [Dynasty Dugout - Exit Velocities and Hard-Hit Rates](https://www.thedynastydugout.com/p/statcast-101-exit-velocities-and)

---

## 13. 打球種類別のアウト率

### BABIP（インプレー打球の打率）= 1 - アウト率
| 打球タイプ | BABIP | アウト率 |
|-----------|-------|---------|
| **ゴロ（Ground Ball）** | .236 | **約76.4%** |
| **フライ（Fly Ball）** | .118 | **約88.2%** |
| **ライナー（Line Drive）** | .678 | **約32.2%** |

### アウト率の別ソース
| 打球タイプ | アウト率 |
|-----------|---------|
| ゴロ | **72%** |
| フライ | **79%** |
| ライナー | **26%** |

※ソースによりフライのアウト率に差がある（.118 BABIPから計算すると88%、別ソースでは79%）。フライにはインフィールドフライ（ほぼ100%アウト）を含むかどうかで変動する。

### 重要な示唆
- ライナーが最もヒットになりやすい（BABIP .678）
- フライはアウトになりやすいが、ヒット時は長打（二塁打・HR）が多い
- ゴロはフライよりヒットになりやすいが、長打は少ない
- FB%とLD%はBABIPへの影響がGB%の**2倍以上**

出典:
- [FanGraphs - GB%, LD%, FB%](https://library.fangraphs.com/pitching/batted-ball/)
- [Pitcher List - An Exposition on BABIP](https://pitcherlist.com/going-deep-an-exposition-on-babip/)
- [The Hardball Times - Groundballs, Flyballs and Line Drives](https://tht.fangraphs.com/groundballs-flyballs-and-line-drives/)

---

## 14. 内野安打の発生条件

### 打球速度と打者走力の関係
- **打球速度75 mph**がゴロが内野を抜けるかどうかの分岐点
- 95 mph以上でMLBレベルでもエラー率が有意に上昇

### 打者の走力（Sprint Speed）の影響
| 走力ティア | 打率への影響 |
|-----------|------------|
| MLB平均（27 ft/s） | 基準 |
| 平均以上（各ティア） | 打率+5〜16ポイント |
| 平均以下（各ティア） | 打率-5〜16ポイント |

- 足の速い打者は三塁打が**1.27〜2.67倍**多い
- 内野安打率への影響は、走力が最も支配的な要因
- 左打者は一塁までの距離が短いため、内野安打率が右打者より高い
- 右打者の場合、走力以外に打球速度やシフトの影響も大きい

### xBA（期待打率）モデル
- Statcastは各打球に対し、**打球速度 + 打球角度 + （特定打球では）Sprint Speed**からxBAを算出
- ゴロの場合、Sprint Speedが加味されることで内野安打の確率を反映

出典:
- [Dynasty Dugout - Sprint Speed and Impact on Hitting](https://www.thedynastydugout.com/p/sprint-speed-and-the-impact-on-hitting)
- [Baseball Savant - Hit Probability](https://baseballsavant.mlb.com/statcast_hit_probability)
- [MLB.com - Exit Velocity Glossary](https://www.mlb.com/glossary/statcast/exit-velocity)

---

## シミュレーション実装への示唆

### 投手AI
- 一塁カバー: 右方向のゴロで自動的にバナナルートで一塁へ
- バックアップ: 三塁線と本塁の中間をデフォルト位置とし、送球先に応じて移動
- バント処理: 投手前方のバントは積極的に処理

### 捕手AI
- バント処理: 到達順で判断、迷ったら一塁送球を指示
- 一塁バックアップ: 走者なし+内野ゴロで一塁後方へ
- 送球: ポップタイム2.0秒を基準に捕手能力でスケール

### 送球判断
- 基本は「2つ先の塁」ルール + アウトカウント・得点差で修正
- 2アウトは確実なアウト優先、0アウトは併殺優先

### エラーモデル
- ゴロ基本エラー率: 約2〜3%（走者状況で3.4%〜9.5%に変動）
- フライ基本エラー率: 約0.3〜0.6%
- ポジション別補正: ショート・三塁手は高め、一塁手は低め
- プレッシャー補正: 走者がいる+緊迫場面で上昇

### 打球生成
- 角度: ゴロ(<10度)43%、ライナー(10-25度)21%、フライ(25-50度)36%
- 速度: 平均89mph、ハードヒット(95+)は打者能力依存
- 方向: プル41%、センター35%、オポ24%（ゴロはプル寄り、フライは均等寄り）
