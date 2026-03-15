# ゴロフォーメーション構造化データ

77パターンのゴロフォーメーション（全ランナー状況×捕球者）を構造化。
出典: https://baseball.fx-education.com/formation/

## 凡例
- FIELD: 捕球者
- cov1B/2B/3B/HM: ベースカバー
- bu打球: 打球処理のバックアップ（前進）
- bu1B送: 一塁送球の悪送球バックアップ
- bu2B送: 二塁送球の悪送球バックアップ
- bu3B送: 三塁送球のバックアップ
- 避送球: 送球ラインから避ける
- 特なし: 主だったカバーリングなし

## ランナーなし

| 捕球者 | P     | C     | 1B    | 2B    | 3B    | SS    | LF    | CF    | RF    |
|--------|------|------|------|------|------|------|------|------|------|
| P      | **捕球** | bu1B送 | cov1B | bu打球  | bu打球  | cov2B | bu1B送 | bu打球  | bu1B送 |
| C      | bu打球  | **捕球** | cov1B | bu1B送 | bu1B送 | cov2B | bu1B送 | bu1B送 | bu1B送 |
| 1B      | cov1B | bu1B送 | **捕球** | cov1B | 待機    | cov2B | bu1B送 | bu1B送 | bu打球  |
| 2B      | cov1B | bu1B送 | cov1B | **捕球** | 待機    | cov2B | bu1B送 | bu打球  | bu打球  |
| 3B      | bu打球  | bu1B送 | cov1B | cov2B | **捕球** | bu打球  | bu打球  | bu1B送 | bu1B送 |
| SS      | 特なし   | bu1B送 | cov1B | cov2B | bu打球  | **捕球** | bu打球  | bu打球  | bu1B送 |

## ランナー1塁

| 捕球者 | P     | C     | 1B    | 2B    | 3B    | SS    | LF    | CF    | RF    |
|--------|------|------|------|------|------|------|------|------|------|
| P      | **捕球** | bu1B送 | cov1B | bu2B送 | cov3B | cov2B | bu1B送 | bu打球  | bu1B送 |
| C      | bu打球  | **捕球** | cov1B | bu2B送 | cov3B | cov2B | bu1B送 | bu1B送 | bu1B送 |
| 1B      | cov1B | cov1B | **捕球** | cov1B | cov3B | cov2B | cov2B | cov2B | bu1B送 |
| 2B      | cov1B | cov1B | cov1B | **捕球** | cov3B | cov2B | cov2B | bu打球  | bu打球  |
| 3B      | 避送球   | bu1B送 | cov1B | cov2B | **捕球** | cov3B | bu打球  | bu2B送 | bu2B送 |
| SS      | 特なし   | cov1B | cov1B | cov2B | cov3B | **捕球** | bu打球  | bu打球  | cov2B |

## ランナー2塁

| 捕球者 | P     | C     | 1B    | 2B    | 3B    | SS    | LF    | CF    | RF    |
|--------|------|------|------|------|------|------|------|------|------|
| P(var) | **捕球** | bu1B送 | cov1B | cov2B | cov3B | cov2B | bu3B送 | bu打球  | bu1B送 |
| P(var) | **捕球** | その他   | cov1B | cov2B | cov3B | cov2B | bu3B送 | bu打球  | bu1B送 |
| C(var) | bu打球  | **捕球** | cov1B | buBU  | cov3B | cov2B | bu3B送 | buBU  | bu1B送 |
| C(var) | bu打球  | **捕球** | cov1B | buBU  | cov3B | cov2B | bu3B送 | buBU  | bu1B送 |
| 1B      | cov1B | bu1B送 | **捕球** | cov1B | cov3B | cov2B | bu3B送 | bu1B送 | bu打球  |
| 2B      | cov1B | bu1B送 | cov1B | **捕球** | cov3B | cov2B | bu3B送 | bu打球  | bu打球  |
| 3B      | cov3B | bu1B送 | cov1B | cov2B | **捕球** | cov3B | bu打球  | bu2B送 | bu1B送 |
| SS(var) | bu1B送 | bu1B送 | cov1B | cov2B | cov3B | **捕球** | bu打球  | bu打球  | bu1B送 |
| SS(var) | bu1B送 | bu1B送 | cov1B | cov2B | cov3B | **捕球** | bu打球  | bu打球  | bu1B送 |
| SS(var) | bu3B送 | bu3B送 | cov1B | cov2B | cov3B | **捕球** | cov3B | bu打球  | bu1B送 |

## ランナー3塁

| 捕球者 | P     | C     | 1B    | 2B    | 3B    | SS    | LF    | CF    | RF    |
|--------|------|------|------|------|------|------|------|------|------|
| P(for) | **捕球** | covHM | cov1B | cov2B | cov3B | bu打球  | bu3B送 | bu打球  | bu1B送 |
| P(mid) | **捕球** | covHM | cov1B | bu打球  | cov3B | cov2B | bu3B送 | bu打球  | bu1B送 |
| C(for) | その他   | **捕球** | cov1B | cov2B | cov3B | bu3B送 | bu3B送 | cov2B | bu1B送 |
| C(mid) | その他   | **捕球** | cov1B | bu1B送 | cov3B | cov2B | bu3B送 | bu1B送 | bu1B送 |
| 1B(for) | cov1B | covHM | **捕球** | cov1B | cov3B | cov2B | bu3B送 | cov2B | bu打球  |
| 1B(mid) | cov1B | covHM | **捕球** | cov1B | cov3B | cov2B | bu3B送 | bu1B送 | bu打球  |
| 2B(for) | bu打球  | covHM | cov1B | **捕球** | cov3B | cov2B | bu3B送 | bu打球  | bu打球  |
| 2B(mid) | cov1B | bu1B送 | cov1B | **捕球** | bu打球  | cov2B | bu1B送 | bu打球  | bu打球  |
| 3B(for) | bu打球  | covHM | cov1B | cov2B | **捕球** | cov3B | bu打球  | buBU  | bu1B送 |
| 3B(mid) | 避送球   | bu1B送 | cov1B | cov2B | **捕球** | cov3B | bu3B送 | buBU  | bu1B送 |
| SS(for) | bu打球  | covHM | cov1B | cov2B | cov3B | **捕球** | bu打球  | bu打球  | bu1B送 |
| SS(mid) | bu打球  | bu1B送 | cov1B | cov2B | その他   | **捕球** | bu打球  | bu打球  | bu1B送 |

## ランナー1,2塁

| 捕球者 | P     | C     | 1B    | 2B    | 3B    | SS    | LF    | CF    | RF    |
|--------|------|------|------|------|------|------|------|------|------|
| P      | **捕球** | bu1B送 | cov1B | bu2B送 | cov3B | cov2B | bu3B送 | bu打球  | bu1B送 |
| C      | bu打球  | **捕球** | cov1B | cov2B | cov3B | cov1B | bu1B送 | buBU  | bu1B送 |
| 1B      | cov1B | bu1B送 | **捕球** | cov1B | cov3B | cov2B | cov2B | cov2B | bu打球  |
| 2B      | cov1B | bu1B送 | cov1B | **捕球** | cov3B | cov2B | cov2B | bu打球  | bu打球  |
| 3B(var) | 避送球   | bu1B送 | cov1B | cov2B | **捕球** | cov3B | bu打球  | bu2B送 | bu1B送 |
| 3B(var) | cov3B | bu1B送 | cov1B | cov2B | **捕球** | cov3B | bu打球  | bu2B送 | bu1B送 |
| SS      | その他   | bu1B送 | cov1B | cov2B | cov3B | **捕球** | bu打球  | bu打球  | cov2B |

## ランナー1,3塁

| 捕球者 | P     | C     | 1B    | 2B    | 3B    | SS    | LF    | CF    | RF    |
|--------|------|------|------|------|------|------|------|------|------|
| P(for) | **捕球** | covHM | cov1B | cov2B | cov3B | その他   | bu3B送 | bu打球  | bu1B送 |
| P(mid) | **捕球** | その他   | cov1B | bu打球  | cov3B | cov2B | bu1B送 | bu打球  | bu1B送 |
| C(for) | その他   | **捕球** | cov1B | cov2B | cov3B | bu3B送 | bu3B送 | cov2B | bu1B送 |
| C(mid) | その他   | **捕球** | cov1B | bu1B送 | cov3B | cov2B | bu3B送 | bu1B送 | bu1B送 |
| 1B(for) | cov1B | covHM | **捕球** | cov1B | cov3B | cov2B | bu3B送 | buBU  | bu打球  |
| 1B(mid) | cov1B | その他   | **捕球** | cov1B | cov3B | cov2B | cov2B | cov2B | bu打球  |
| 2B(for) | bu打球  | covHM | cov1B | **捕球** | cov3B | cov2B | bu3B送 | bu打球  | bu打球  |
| 2B(mid) | cov1B | その他   | cov1B | **捕球** | cov3B | cov2B | cov2B | bu打球  | bu打球  |
| 3B(for) | bu打球  | covHM | cov1B | cov2B | **捕球** | cov3B | bu打球  | buBU  | bu1B送 |
| 3B(mid) | bu1B送 | その他   | cov1B | cov2B | **捕球** | cov3B | bu打球  | buBU  | bu1B送 |
| SS(for) | bu打球  | covHM | cov1B | cov2B | cov3B | **捕球** | bu打球  | bu打球  | bu1B送 |
| SS(mid) | bu1B送 | その他   | cov1B | cov2B | cov3B | **捕球** | bu打球  | bu打球  | cov2B |

## ランナー2,3塁

| 捕球者 | P     | C     | 1B    | 2B    | 3B    | SS    | LF    | CF    | RF    |
|--------|------|------|------|------|------|------|------|------|------|
| P(for) | **捕球** | covHM | cov1B | cov2B | cov3B | その他   | bu3B送 | bu打球  | bu1B送 |
| P(mid) | **捕球** | covHM | cov1B | cov2B | cov3B | cov2B | bu3B送 | bu打球  | bu1B送 |
| C(for) | その他   | **捕球** | cov1B | cov2B | cov3B | bu3B送 | bu3B送 | cov2B | bu1B送 |
| C(mid) | その他   | **捕球** | cov1B | bu1B送 | cov3B | cov2B | bu3B送 | bu打球  | bu1B送 |
| 1B(for) | cov1B | covHM | **捕球** | cov1B | cov3B | cov2B | bu3B送 | cov2B | bu打球  |
| 1B(mid) | cov1B | covHM | **捕球** | cov1B | cov3B | cov2B | bu3B送 | buBU  | bu打球  |
| 2B(for) | bu打球  | covHM | cov1B | **捕球** | cov3B | cov2B | bu3B送 | bu打球  | bu打球  |
| 2B(mid) | cov1B | bu1B送 | cov1B | **捕球** | cov3B | cov2B | bu1B送 | bu打球  | bu打球  |
| 3B(for) | bu打球  | covHM | cov1B | cov2B | **捕球** | cov3B | bu打球  | その他   | bu1B送 |
| 3B(mid) | 避送球   | その他   | cov1B | cov2B | **捕球** | cov3B | bu打球  | buBU  | bu1B送 |
| SS(for) | bu打球  | covHM | cov1B | cov2B | cov3B | **捕球** | bu打球  | bu打球  | bu1B送 |
| SS(mid) | 避送球   | bu1B送 | cov1B | cov2B | cov3B | **捕球** | bu打球  | bu打球  | bu1B送 |

## 満塁

| 捕球者 | P     | C     | 1B    | 2B    | 3B    | SS    | LF    | CF    | RF    |
|--------|------|------|------|------|------|------|------|------|------|
| P(for) | **捕球** | covHM | cov1B | cov2B | cov3B | cov2B | bu3B送 | bu打球  | bu1B送 |
| P(mid) | **捕球** | covHM | cov1B | bu打球  | cov3B | cov2B | bu3B送 | bu打球  | bu1B送 |
| C(for) | 避送球   | **捕球** | cov1B | bu1B送 | cov3B | cov2B | bu3B送 | buBU  | bu1B送 |
| C(mid) | 避送球   | **捕球** | cov1B | bu1B送 | cov3B | cov2B | bu3B送 | buBU  | bu1B送 |
| 1B(for) | cov1B | covHM | **捕球** | cov1B | cov3B | cov2B | bu3B送 | buBU  | bu打球  |
| 1B(mid) | cov1B | covHM | **捕球** | cov1B | cov3B | cov2B | bu3B送 | buBU  | bu打球  |
| 2B(for) | 避送球   | covHM | cov1B | **捕球** | cov3B | cov2B | bu3B送 | bu打球  | bu打球  |
| 2B(mid) | cov1B | bu1B送 | cov1B | **捕球** | cov3B | cov2B | cov2B | bu打球  | bu打球  |
| 3B(for) | bu打球  | covHM | cov1B | cov2B | **捕球** | cov3B | bu打球  | その他   | bu1B送 |
| 3B(mid) | bu打球  | covHM | cov1B | cov2B | **捕球** | cov3B | bu打球  | その他   | bu1B送 |
| SS(for) | 避送球   | covHM | cov1B | cov2B | cov3B | **捕球** | bu打球  | bu打球  | bu1B送 |
| SS(mid) | その他   | bu1B送 | cov1B | cov2B | cov3B | **捕球** | bu打球  | bu打球  | cov2B |
