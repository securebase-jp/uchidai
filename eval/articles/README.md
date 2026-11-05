# 実際の報道記事での評価

IPA 事例集の 5 事例（`eval/cases`）は読解の正解データだが、実際の報道記事は短く、入口が書かれていないことも多い。
ここでは国内の中小企業・中堅企業のサイバー被害の報道記事で、読解（`readCase`）→ 検証（`verifyCase`）→ 型紙への対応づけ（`evaluate`）が機能するかを測る。

## 構成

- `list.yaml`：記事の一覧。URL、媒体、日付、見出し、想定する被害の型（`expectedDamageType`）、想定する入口の手法 ID（`expectedEntry`。記事から分からなければ空）、一行の要約。**本文は入れない**
- `eval/.cache/articles/<id>.html` / `<id>.txt` / `<id>.meta.json`：取得した HTML と抽出した本文（git 管理外）
- `eval/recordings/articles/<id>.json`：Claude の応答の記録（検証前の `raw`、使用トークン、所要時間。リクエストヘッダは保存しない）。根拠文は記事からの短い抜粋（1〜2 文）で、出典は `source` に明記する
- `eval/results/articles-<日時>.json`、`eval/RESULTS.md`：結果の記録

## 記事の選び方

- ランサムウェアによる業務停止 4 本、なりすまし送金（ビジネスメール詐欺）2 本、メールアカウントの乗っ取り（取引先への踏み台）1 本、不正アクセス・設定ミスによる情報漏えい 3 本、対象外になるべき事故（誤送信、内部不正）2 本、長い本文の取り込み確認 1 本
- 有料・ログイン・JavaScript 必須のページは候補から外す（`fetchArticle` で本文が取れること）
- 媒体は Security NEXT（短く、入口の記述があればそれを書く）、ITmedia NEWS、piyolog（長いまとめ記事）

## 実行

```bash
pnpm eval:articles --fetch     # 記事を取得してキャッシュするだけ（Claude は呼ばない）
pnpm eval:articles             # キャッシュ → 読解（知見あり）→ 検証 → 判定（demo-seiko）。記録を作り、計測する
pnpm eval:articles --replay    # 記録の raw に現在の verifyCase と evaluate をかけ直して再計測（Claude は呼ばない）
pnpm eval:articles --re-extract --replay   # キャッシュした HTML から本文を抽出し直してから再計測（本文抽出の改善を測る）
pnpm eval:articles --id ransom-autome      # 対象を絞る
```

記事の取得には DNS の解決が要る。`--replay` と `--re-extract` はネットワークを使わない。

## 計測する項目

| 項目            | 内容                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| 型（想定→実際） | 被害の型が想定と一致したか                                                                                  |
| 明確さ          | `clarity`（clear / partial / unknown）                                                                      |
| 段階（出/入）   | 検証後の段階数 / Claude が出した段階数                                                                      |
| 破棄手法        | `verifyCase` が破棄した手法の数（内訳は結果ファイルに）                                                     |
| 対応づけ        | `matchCaseSteps` で型紙の段階に手法まで対応づいた数 / 型紙の段階数                                          |
| 入口            | 型紙の入口の段階に対応づいた手法と、想定（`expectedEntry`）との一致                                         |
| 判定            | `evaluate` の結論。「out_of_scope(未対応)」は記事の段階がどれも型紙の手法に対応づけられず判定しなかったもの |
| 秒              | Claude の応答までの所要時間                                                                                 |

## 出典

各記事の URL と媒体は `list.yaml` に記す。本文の著作権は各媒体にあり、リポジトリには短い抜粋（根拠文）だけを出典つきで置く。
