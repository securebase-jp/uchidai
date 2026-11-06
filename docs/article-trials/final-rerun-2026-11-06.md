# 最終の再実行（2026-11-06）：登録した全件を、凍結したコードで通し直した結果

> 注：この試験に使った補助スクリプトのうち、再実行に要るもの（`eval/trials/` の `run-*.ts`、`*-report.ts` など）だけを公開しています。取得や集計のための一時的なものは公開していないので、文中のコマンドには動かないものがあります（当時の手順の記録です）。期待ラベルの一覧（`eval/trials/articles/*.yaml`）は残しています。

ハッカソンの提出に合わせ、コードと知識ファイルを凍結した `main` で、登録済みのニュース記事・企業の公表（IR）・PHP2Shell の公表を、読解 → デモ精工と 5 問カルテの判定 → 一枚まで、もう一度すべて通した。**この記録の数字が、動画の終了画面と README に載る最終の数字である。** 見つかった課題は直していない（記録だけ）。

- 実施日：2026-11-06
- 実施者：Sonnet 5.5 のセッション（final-rerun）。PM（主セッション）の依頼
- 対象：`main` の 180ddb1（コード・知識ファイルは凍結。この再実行では一切変えていない）
- 環境：読解・言い換えのモデル `claude-sonnet-5-5`、ATT&CK Enterprise v20.0、型紙 6 本（ransomware、bec、bec-invoice、data-breach、data-breach-web、data-breach-intrusion。判定の `templateId` には account-takeover 系も現れる）。API は listen せず、Hono の `app.request()` で直接呼んだ（画面は通していない）
- 記事の一覧と期待ラベル：`eval/trials/articles/{ransom,breach,bec-ato,supply-oos,ir,php2shell}.yaml`

## 結論の要約

1. **登録 146 件のうち 136 件を通した。** 通せなかった 10 件はすべて、IR の本文を取得できなかったもの（403 が 4、404 が 3、本文が空 2、PDF のはずが HTML 1）。読解や判定の失敗は 0 件で、429（回数制限）も一度も出なかった。
2. **被害の種類は、許容込みで 126/136（92.6%）。** 一度も見ていない保留 25 件では 21/25（84%）。根拠文は 270 件中 269 件が本文と一字一句一致（残り 1 件は PDF の字形の違いで、正規化すれば一致）。対象外は 14/14 で断れ、実記事に対する指示文の誤検知は 0/136。
3. **弱い所は前回までと同じ場所に残っている。** 入口の種類の一致（IR で 4/20）、情報漏えいの型紙（顧客向け Web の事故が「アカウント乗っ取り（サービス）」の型紙に入る）、個別の事案でない記事の扱い。いずれも既知の課題（`docs/article-trials/triage.md`）で、今回は新たに直していない。
4. **新しい課題は 3 件（中 1、低 2）。** 最も影響が大きいのは、ScanNetSecurity の無料の範囲（約 130〜200 字）の記事 13 件が、URL からは 200 字未満として断られること（TRIAL-F-001）。

## 数字の数え方（読む前に）

- **登録件数**：記事 81（ransom 24、breach 21、bec-ato 19、supply-oos 17）、IR 59、PHP2Shell 6、合計 **146**。依頼の文では「記事 100 件」とあったが、`eval/trials/articles/*.yaml` に登録されている記事は 81 件である。初期の 7 件（`docs/real-article-trials.md`。石光商事ほか）は一覧に入っていない（期待ラベルが無い）ため、この再実行では通していない。81 + 7 = 88 でも 100 にならず、100 の内訳は再現できなかった。
- **ScanNetSecurity の 13 件**：ScanNetSecurity の無料の範囲は 130〜200 字ほどで、URL から読ませると「本文がほとんど取れませんでした」（422）で断られる（TRIAL-F-001）。この 13 件は、取得できた本文（`article.txt`）を**貼り付けの入力**として読ませた（`run-ir.ts`。判定・一枚は同じ流れ）。URL だけで数える場合の数字も併記する。**どちらの数字でも、凍結したコードそのままで、コードの変更は無い。**
- **種類の一致**：厳密は期待ラベル `kind` と一致、許容込みは `alsoAcceptable`／`alsoOk` に挙げた種類も含める。集計は機械的（ラベルとの突き合わせ）で、記事の中身の判断は入れていない。
- **判定できた**：期待が対象外でない記事（想定内）のうち、デモ精工の判定が対象外以外（侵入される／止まる／入口なし）になったもの。「入口なし」は、御社の資産に入口が見当たらないという正当な答えとして数えた。
- **型紙の一致**：判定の `templateId` が、期待の種類（と許容）の型紙の系統であるもの。
- **入口の一致**：期待の入口が `vpn / rdp / network-device / credential / web / mail / vendor` に当たる記事（ほか、breach と supply-oos の対応する語）で、読解の入口の種類（`entryKind`）が一致したもの。自由記述の BEC・乗っ取りと、対応しない語は数えていない。「入口が無い記事で入口を作らず」は、期待が `none`／`internet` の記事で、入口の種類を付けなかったもの。
- **根拠文の照合**：読解が付けた根拠文（quote）が、取得した本文か表題に、空白を除いて一字一句一致するか。
- **対象外を断れた**：期待が `out_of_scope` の記事で、読解も判定も対象外になったもの（`eval/trials/articles/*.yaml` で `kind: out_of_scope` の 14 件。記事 7、IR 3、PHP2Shell 4）。
- **注入の誤検知**：実記事（指示文を仕込んでいない）で、`suspiciousInstructions` が 1 件以上出たもの。
- 保留 25 件（`heldOut: true`）は、前回までの試験では通していない記事である（今回だけ解除して通した）。コードの修正の対象にもなっていない。

## 方法

1. `eval/trials/list-targets.ts` で全件の id・URL・保留の別を出した（146 件）。
2. **記事**：1 件ずつ `eval/trials/run-trial.ts --id <id> --url <URL>`（取得 → 読解 → デモ精工と 5 問カルテの判定 → 一枚）。IR・PHP2Shell は、`eval/trials/fetch-batch.ts` で各公表を 1 回だけ取得し、`eval/trials/run-ir.ts --id <id>`（PHP2Shell は `--file php2shell.yaml`）で、取得した本文を text として読ませた。カルテは前回までと同じ 2 種（デモ精工と、5 問から作ったカルテ。卸売・サービス、事務所のみ、メールはクラウド、ファイルと基幹は社内、RDP、バックアップは同じ網）。一枚の言い換えは、デモ精工だけ Claude を使う。
3. 記事は 3 並列、IR・PHP2Shell は 2 並列で動かした。失敗は 1 回だけやり直し、それでも失敗なら理由を記録して進んだ（失敗は 23 件。IR の取得できなかった 10 件と、ScanNetSecurity の 13 件で、やり直しても結果は同じだった）。429 の待ち直しは 0 回。
4. 保留 25 件は、通常の件と同じ方法で通した。実行前に、過去の出力（27 件）はスクラッチに退避し、各 id の出力を消してから実行したので、結果はすべて今回の実行のもの。
5. 集計は `eval/trials/certainty-report.ts`、`eval/trials/report-wording-report.ts` と、`read.json`・`*.evaluate.json`・`*.onepager.json` を期待ラベルと突き合わせる集計（一時的なスクリプト。公開していない）。`ir-report.ts`・`entry-report.ts` は前回までの記録用で、今回の表は上の定義で数え直した。
6. 記事の本文・PDF はリポジトリに入れていない（`eval/.cache/`、git 管理外）。

## 全体の表

登録 146 件のうち **136 件を通した**（ScanNetSecurity の 13 件は貼り付けで読解）。

| 区分          | 登録 | 通した | 種類（厳密）   | 種類（許容込み）     | 判定できた（想定内の記事。デモ精工／5 問） | 型紙の一致      | 入口の一致     | 入口が無い記事で入口を作らず | 根拠文の照合         | 対象外を断れた    | 注入の誤検知 |
| ------------- | ---- | ------ | -------------- | -------------------- | ------------------------------------------ | --------------- | -------------- | ---------------------------- | -------------------- | ----------------- | ------------ |
| **全体**      | 146  | 136    | 117/136（86%） | **126/136（92.6%）** | 112/122（91.8%）／112/122（91.8%）         | 90/122（73.8%） | 25/48（52.1%） | 40/43（93%）                 | **269/270（99.6%）** | **14/14（100%）** | 0/136        |
| 記事（81 件） | 81   | 81     | 69/81（85.2%） | 74/81（91.4%）       | 67/74（90.5%）／67/74（90.5%）             | 55/74（74.3%）  | 19/26（73.1%） | 14/14（100%）                | 173/173（100%）      | 7/7（100%）       | 0/81         |

**URL だけで数える場合**（ScanNetSecurity の 13 件を通せずに数える）：通した 123 件。種類（許容込み）113/123（91.9%）、厳密 104/123（84.6%）、判定できた 99/109（90.8%）、型紙 82/109（75.2%）、入口 21/43（48.8%）、根拠文 248/249（99.6%）、対象外 14/14、注入の誤検知 0/123。記事だけでは 68 件を通し、許容込み 61/68（89.7%）。

### 判定の内訳（デモ精工）

| 判定                   | 件数（通した 136 件） |
| ---------------------- | --------------------- |
| 侵入される（breached） | 66                    |
| 入口なし（no_entry）   | 45                    |
| 止まる（blocked）      | 1                     |
| 対象外（out_of_scope） | 24                    |

対象外 24 件のうち 14 件は期待どおり（期待が対象外）。残る 10 件は、期待が対象外でないのに対象外と答えたもの：個別の事案でない BEC・乗っ取りの記事 5 件、IR の 3 件（`ir-japanpost-html`、`ir-yamaichi-html`、`ir-zuken`）、ソフトウェアの供給網の 2 件（`supply-emeditor-site`、`supply-notepadpp-update`）。このうち `ir-zuken` と供給網の 2 件は、ラベルが対象外も許容している。5 問のカルテでも、判定できた件数はデモ精工と同じ（112/122）。評価と一枚は、どちらも 272 回（136 件 × 2 カルテ）すべて応答 200 で、エラーは 0。

## 種類別の表

| 区分           | 登録 | 通した | 種類（厳密）   | 種類（許容込み） | 判定できた（想定内の記事。デモ精工／5 問） | 型紙の一致     | 入口の一致     | 入口が無い記事で入口を作らず | 根拠文の照合   | 対象外を断れた | 注入の誤検知 |
| -------------- | ---- | ------ | -------------- | ---------------- | ------------------------------------------ | -------------- | -------------- | ---------------------------- | -------------- | -------------- | ------------ |
| ランサム       | 24   | 24     | 23/24（95.8%） | 23/24（95.8%）   | 24/24（100%）／24/24（100%）               | 23/24（95.8%） | 11/13（84.6%） | 11/11（100%）                | 69/69（100%）  | —              | 0/24         |
| 情報漏えい     | 21   | 21     | 20/21（95.2%） | 20/21（95.2%）   | 21/21（100%）／21/21（100%）               | 11/21（52.4%） | 6/8（75%）     | 3/3（100%）                  | 37/37（100%）  | —              | 0/21         |
| BEC・乗っ取り  | 19   | 19     | 11/19（57.9%） | 14/19（73.7%）   | 14/19（73.7%）／14/19（73.7%）             | 14/19（73.7%） | —              | —                            | 38/38（100%）  | —              | 0/19         |
| 取引先・対象外 | 17   | 17     | 15/17（88.2%） | 17/17（100%）    | 8/10（80%）／8/10（80%）                   | 7/10（70%）    | 2/5（40%）     | —                            | 29/29（100%）  | 7/7（100%）    | 0/17         |
| IR             | 59   | 49     | 42/49（85.7%） | 46/49（93.9%）   | 43/46（93.5%）／43/46（93.5%）             | 33/46（71.7%） | 4/20（20%）    | 26/29（89.7%）               | 90/91（98.9%） | 3/3（100%）    | 0/49         |
| PHP2Shell      | 6    | 6      | 6/6（100%）    | 6/6（100%）      | 2/2（100%）／2/2（100%）                   | 2/2（100%）    | 2/2（100%）    | —                            | 6/6（100%）    | 4/4（100%）    | 0/6          |

読み方：

- **BEC・乗っ取り**の不一致 5 件は、4 件が「個別の事案でない記事」（IPA の事例集の紹介、被害企業 190 社の調査、ニセ社長詐欺の解説、警察庁の注意喚起）を対象外と読んだもの。もう 1 件（`ato-proofpoint-rules`）も、セキュリティ企業のブログ（個別の被害ではない）で対象外。期待ラベル側も「境目」「out_of_scope も妥当」と書いてある記事で、これらの対象外を妥当と数えると、全体は 131/136（96.3%）、保留 25 件は 24/25（96%）になる。**終了画面には、ラベルどおりの厳しい数字（126/136、21/25）を使うことを勧める。**
- **型紙の一致**の低さ（情報漏えい 52.4%）は、顧客向け Web・EC・アプリの事故（`data_breach` と読まれた記事）が、判定では `account-takeover-service` の型紙に入る（デモ精工に当たる資産が無く「入口なし」になる）件が 17 件あるため（既知：TRIAL-D-009、TRIAL-I-008）。種類の読み自体は合っている。
- **入口の一致**：IR の 4/20 は、公表が「Web サイト」「提供元（vendor）」「ID／パスワード」とだけ書く事故で、読解が入口の種類を付けないことが多い。既知（TRIAL-I-008 の流れ）。記事（ランサム 11/13、情報漏えい 6/8）は高い。
- **入口が無い記事で入口を作らず**の不一致 3 件（`ir-sakata2`、`ir-sakata-final`、`ir-asahi-pii`）は、ラベル側の誤り。公表は「ネットワーク機器」と書いており（`ir-disclosures.md` の記録でも入口 network-device と読めている）、期待の `none` が合っていない。読解が正しい。

## 保留 25 件だけの表（一度も見ていない記事での成績）

保留 25 件は、前回までの試験では一度も通しておらず、課題の修正にも使っていない。**ここが、初見の記事に対する成績である。**

| 区分                    | 登録 | 通した | 種類（厳密）     | 種類（許容込み） | 判定できた（想定内の記事。デモ精工／5 問） | 型紙の一致     | 入口の一致     | 入口が無い記事で入口を作らず | 根拠文の照合      | 対象外を断れた  | 注入の誤検知 |
| ----------------------- | ---- | ------ | ---------------- | ---------------- | ------------------------------------------ | -------------- | -------------- | ---------------------------- | ----------------- | --------------- | ------------ |
| **保留 25 件**          | 25   | 25     | **21/25（84%）** | 21/25（84%）     | 20/23（87%）／20/23（87%）                 | 14/23（60.9%） | 6/7（85.7%）   | 4/4（100%）                  | **53/53（100%）** | **2/2（100%）** | 0/25         |
| 保留でない記事（56 件） | 56   | 56     | 48/56（85.7%）   | 53/56（94.6%）   | 47/51（92.2%）／47/51（92.2%）             | 41/51（80.4%） | 13/19（68.4%） | 10/10（100%）                | 120/120（100%）   | 5/5（100%）     | 0/56         |

URL だけで数える場合（保留のうち ScanNetSecurity の 5 件を通せずに数える）：通した 20 件、種類 16/20（80%）、根拠文 41/41、対象外 2/2。

保留 25 件の内訳は、ランサム 7、情報漏えい 7、BEC・乗っ取り 6、取引先・対象外 5（うち対象外 2）。ScanNetSecurity の 5 件（`breach-keds`、`breach-mitsubishi-mdm`、`breach-denso-sp`、`breach-campfire`、`ato-sakura`）は貼り付けで読解。種類が合わなかった 4 件は、`ransom-tokai-itmedia`（委託先のランサムを情報漏えいと読んだ。TRIAL-F-002）、`bec-ipa-2024`・`bec-fin-6oku`・`ato-proofpoint-rules`（個別の事案でない記事を対象外と読んだ。上記）。

★ は保留の記事。


## 種類が合わなかった 10 件

通した 136 件のうち、許容込みでも期待と合わなかった 10 件。

| ID                     | 期待 → 読解                                        | 判定                                | 区分                                                      |
| ---------------------- | -------------------------------------------------- | ----------------------------------- | --------------------------------------------------------- |
| ransom-tokai-itmedia ★ | ransomware → data_breach                           | 侵入される（data-breach-intrusion） | **新規**（TRIAL-F-002）                                   |
| breach-sophia          | data_breach → account_takeover                     | 入口なし                            | 既知（TRIAL-D-009。メール以外のアカウントの乗っ取り）     |
| bec-ipa-2024 ★         | bec → out_of_scope                                 | 対象外                              | ラベル側。個別の事案でない記事（IPA の事例集の紹介）      |
| bec-survey-2024        | bec → out_of_scope                                 | 対象外                              | ラベル側。調査の記事。ラベル自身が「out_of_scope も妥当」 |
| bec-fin-6oku ★         | bec → out_of_scope                                 | 対象外                              | ラベル側。ニセ社長詐欺の解説                              |
| bec-npa-nise           | bec → out_of_scope                                 | 対象外                              | ラベル側。警察庁の注意喚起                                |
| ato-proofpoint-rules ★ | account_takeover → out_of_scope                    | 対象外                              | ラベル側。セキュリティ企業のブログ（個別の被害ではない）  |
| ir-mitsui-park         | account_takeover → data_breach                     | 入口なし                            | 既知（`ir-disclosures.md`）                               |
| ir-japanpost-html      | account_takeover（許容 data_breach）→ out_of_scope | 対象外                              | 既知（`ir-disclosures.md`）                               |
| ir-yamaichi-html       | ransomware → out_of_scope                          | 対象外                              | 既知（`ir-disclosures.md`）                               |

## 取れなかった件

### IR の 10 件（取得できず。読解は未実施）

前回取得できなかった 10 件を、もう一度試した（各 URL につき 1 回だけ）。**10 件とも、前回と同じ理由で取れなかった。** 読解・判定は通していない。

| ID               | 会社                                | 理由                                                 |
| ---------------- | ----------------------------------- | ---------------------------------------------------- |
| ir-nec-vendor    | 日本電気                            | サイトが自動での取得を断った（403）                  |
| ir-nomura-vendor | 野村ホールディングス                | 403                                                  |
| ir-jal-cargo     | 日本航空                            | 403                                                  |
| ir-jal-pay       | 日本航空                            | 403                                                  |
| ir-oug-1         | オープンアップグループ              | 記事が見つからない（404）                            |
| ir-oug-2         | オープンアップグループ              | 404                                                  |
| ir-jrc-idcf-1    | 東海旅客鉄道                        | 404                                                  |
| ir-sagawa-2      | SG ホールディングス（佐川急便名義） | 本文を取り出せない（本文が空）                       |
| ir-sagawa-5      | SG ホールディングス（佐川急便名義） | 本文を取り出せない（本文が空）                       |
| ir-takeuchi      | 竹内製作所                          | PDF のはずが HTML が返った（同意の画面かもしれない） |

403 の 4 件は、サイト側が自動取得を断っている。PDF の版か本文の貼り付けなら読める可能性があるが、取得は登録済みの URL の 1 回に限るという約束なので、別の経路は試していない。

### ScanNetSecurity の 13 件（URL からは断られ、貼り付けの本文で読解）

`bec-sanshin`、`ato-sakura`、`breach-nagasaki-manabie`、`breach-keds`、`breach-shopchannel`、`breach-nishitetsu`、`breach-mitsubishi-mdm`、`breach-tokushima-hosp`、`breach-denso-sp`、`breach-fukuoka-edu`、`breach-campfire`、`breach-tabiq`、`ransom-medica`。URL からの読解は 422（本文 131〜199 字）で、1 回やり直しても同じ。TRIAL-F-001 を参照。取得できた本文は、貼り付けの入力として読ませ、読解・判定・一枚は通った。

## 新たに見つかった課題（直していない）

重大度の基準は前回までと同じ。高：誤った安心や誤判定・安全面、中：使えない場面が出る・誤解を招く、低：見た目・まれな場面。今回は **高 0、中 1、低 2**。

| ID          | 対象                                                                                                                                              | 区分                       | 重大度 | 再現                                                                                                                                                                                                                                                                                                                                                           | 原因                                                                                                                                                                                                                                                                                                                                                                                                                         | 案                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TRIAL-F-001 | `breach-keds` ほか ScanNetSecurity の 13 件（同媒体の 21 件中）                                                                                   | 取り込み（短い本文の拒否） | 中     | `node --disable-warning=ExperimentalWarning --env-file=<.env> eval/trials/run-trial.ts --id breach-keds --url https://scan.netsecurity.ne.jp/article/2024/01/25/50501.html` → `read failed 422`「本文がほとんど取れませんでした（185 字）」。他の 12 件も 131〜199 字で同じ。同じ本文を text で渡す（`run-ir.ts --id breach-keds --file breach.yaml`）と読める | ScanNetSecurity は、会員でない閲覧者には記事の冒頭（無料の範囲、130〜200 字ほど）だけを返す。TRIAL-I-002 の修正（本文が 200 字未満の HTML は 422 で取り直しの案内にする）より前は、この短い本文でも読めていた。修正後は、短いだけで本文として足りている記事も、同意の画面などと同じ案内で断られる。案内の文は「PDF の版か本文の貼り付け」を勧めるが、ScanNetSecurity には PDF が無い                                         | 本文が 200 字未満でも、同意文・著作権表示だけでなく記事の文（日付・主語・出来事）が含まれる場合は断らない判定にする。または、ScanNetSecurity の無料の範囲だと分かる場合は、「この媒体は無料の範囲が短く、全文は会員向けです。読める範囲を貼り付けてください」と案内する **対応済み（コミット 0edd27b、Issue #2）**：200 字未満でも事故の公表らしい語があり 80 字以上なら読み、「本文が短い」の注記を出す |
| TRIAL-F-002 | `ransom-tokai-itmedia`（保留。ITmedia、東海大の委託先）                                                                                           | 読解（種類）               | 低     | `run-trial.ts --id ransom-tokai-itmedia --url https://www.itmedia.co.jp/news/articles/2602/18/news129.html`→ `read.json` の `damageType` が `data_breach`（明確さ partial）。ランサムウェアで暗号化された段階（TA0040）は stated                                                                                                                               | 記事の表題は「東海大、ランサム被害で個人情報漏えい 最大19万人分 業務委託先がルール違反、データを持ち帰り」で、暗号化と脅迫文、持ち出しが同時にある。読解は被害の中心を個人情報の漏えいと取り、情報漏えいの型紙（data-breach-intrusion）で判定する。ランサムの型紙の「暗号化・業務停止」の観点は一枚に出ない。ラベルは `ransomware`（許容の `data_breach` なし）で、境目の記事                                                | 種類の選び方に、「暗号化と持ち出しが両方ある」場合の方針を足す。または、境目の記事として許容に `data_breach` を足す（ラベル側）                                                                                                                                                                                                                                                                          |
| TRIAL-F-003 | 一枚の言い換え（デモ精工）。`breach-tabiq`、`bec-sanshin`、`ir-nidec1`、`ir-nidec2`、`ir-kadokawa-0911` と、`ransom-ctc-subcontractor`（timeout） | 経営（一枚の言い換え）     | 低     | 該当 id を `run-trial.ts`／`run-ir.ts` で実行 → `demo-seiko.onepager.json` の `text.source` が `template`、`noteJa` に「Claude の文を検証で捨てました：…」                                                                                                                                                                                                     | 言い換えが、事実の無い出来事を「確認されています」と書く（tabiq）、御社の金額に「想定では」を付けない（sanshin）、第三者の事故を子会社と書く（nidec1）、攻撃者の主張を「主張」と書かない（nidec2）など。検証が捨ててテンプレート文に戻したので、**誤った文は出ていない**（ガードが働いた）。1 件は Claude の timeout。言い換えを試みた 67 件（成功 61、検証で捨てた 5、timeout 1）のうち、検証で捨てられたのは 5 件（約 7%） | 言い換えの指示に、捨てられた理由を例として足す（捨てた理由を再入力して 1 回だけ言い直す、など）。優先度は低い                                                                                                                                                                                                                                                                                            |

### 前回までの課題との関係

今回の結果で、前回までの主な課題は次のとおり**残っている**（コード・知識ファイルは凍結のため、直していない）。新しい課題ではないので、ID は振っていない。

- 顧客向け Web・アプリ・EC の事故が `account-takeover-service` の型紙に入る／入口の種類が付かない（TRIAL-D-009、TRIAL-I-008。型紙の一致が情報漏えいで 11/21、IR の入口の一致が 4/20 になる理由）。
- 個別の事案でない記事（注意喚起・調査・解説）は対象外と読まれる（期待ラベルが BEC・乗っ取りの 5 件。TRIAL-B-006、TRIAL-D-006 の流れ）。
- 「確認されています」が記事の事実に合っているか：一枚の「確認の文」は 80 件、そのうち試算（日数・金額・停止）に「確認されています」と付いた文は **0 件**（前回までは R-004 として多数）。「報告が不要」と読める文は 0、不自然な動詞の残りは 0（`report-wording-report.ts`、136 件）。

### ラベル側の注記（製品の問題ではない）

- `ir-sakata2`、`ir-sakata-final`、`ir-asahi-pii` は、期待の入口が `none` だが、公表は「ネットワーク機器」と書いており、読解が正しい。期待の更新が望ましい（今回は動画・README の凍結のため、`ir.yaml` の値は変えていない）。
- `bec-ato.yaml` の個別の事案でない 5 件は、期待が `bec`／`account_takeover` だが、対象外も妥当（上記）。
- `ir-iseki2` の根拠文 1 件が、本文と一字一句は一致しない。PDF の本文が「その⼀部」と書く（康熙部首の「⼀」）のに対し、読解の根拠文は通常の「一」で返した。NFKC 正規化では一致し、ウチダイ自身の検証（`droppedQuotes`）も 0 件。つまり、根拠文は 270/270 が本文に由来する（厳密な一字一句では 269/270）。

## 確度と一枚の文

- 段階の確度（136 件、440 段階）：記載（stated）179、推定（inferred）のうち「可能性」128・確度の付かない推定 42・「痕跡なし」10・「攻撃者の主張」7・「露出のみ」9、不明（unknown／not_stated）65。
- 一枚（デモ精工）の文を Claude の言い換えにしたのは 61 件、テンプレート文は 75 件（対象外 24 件を含む。判定が「入口なし」のときはテンプレート文。検証で捨てたのは上の 5 件と timeout 1 件）。
- 記事の事実と合わない「確認されています」（試算への付与）：0 件。

## 所要時間とトークン

読解・判定・一枚の応答まで（`summary.json`）。記事の取得時間を含む。並列で動かしたので、壁時計の時間は合計より短い。

| 区分           | 件数 | API 呼び出し | 入力    | 出力    | キャッシュ読み | キャッシュ書き | 処理時間の合計 | 読解の中央値／最大 |
| -------------- | ---- | ------------ | ------- | ------- | -------------- | -------------- | -------------- | ------------------ |
| 全体           | 136  | 202          | 369,435 | 118,998 | 3,653,108      | 54,524         | 1,031 秒       | 4.8 秒／19.8 秒    |
| ランサム       | 24   | 44           | 80,235  | 23,310  | 654,288        | 0              | 221 秒         | 5.2 秒／11.9 秒    |
| 情報漏えい     | 21   | 23           | 17,497  | 17,660  | 572,502        | 0              | 148 秒         | 4.8 秒／14.1 秒    |
| BEC・乗っ取り  | 19   | 26           | 48,089  | 13,861  | 517,978        | 0              | 135 秒         | 4.9 秒／13.3 秒    |
| 取引先・対象外 | 17   | 24           | 41,833  | 16,107  | 463,454        | 0              | 136 秒         | 4.5 秒／12.7 秒    |
| IR             | 49   | 79           | 174,477 | 46,269  | 1,281,314      | 54,524         | 372 秒         | 4.7 秒／19.8 秒    |
| PHP2Shell      | 6    | 6            | 7,304   | 1,791   | 163,572        | 0              | 19 秒          | 3.0 秒／5.3 秒     |

- 1 件あたり（136 件の平均）：API 呼び出し 約 1.5 回、処理時間 約 7.6 秒。
- 壁時計：記事 81 件と IR・PHP2Shell 55 件を並列で動かして約 8 分（11:51〜11:59）。取得（IR・PHP2Shell の 65 件、3 並列）は別に数分。
- 取得に失敗した件（IR 10 件、ScanNetSecurity の 13 件の URL 経由）は、API を呼ぶ前に止まったので、トークンは使っていない（ScanNetSecurity の 13 件は貼り付けで読解したので、上の表に入っている。この 13 件は取得時間が入らない）。
- 429（回数制限）は 0 回、待ち直しも 0 回。評価と一枚の応答はすべて 200。
- 集計できなかった分：失敗した実行の `summary.json` は、貼り付けでの読解に上書きされた。

## 再現の手順

```bash
# 一覧（id・URL・保留の別）
node --disable-warning=ExperimentalWarning eval/trials/list-targets.ts

# 記事（Claude を呼ぶので、.env を Node に渡す。値は表示しない）
node --disable-warning=ExperimentalWarning --env-file=.env eval/trials/run-trial.ts --id <id> --url <URL>

# IR・PHP2Shell：1 回だけ取得してから読ませる
node --disable-warning=ExperimentalWarning eval/trials/fetch-batch.ts <id>=<URL>
node --disable-warning=ExperimentalWarning --env-file=.env eval/trials/run-ir.ts --id <id> [--file php2shell.yaml]

# 集計
node --disable-warning=ExperimentalWarning eval/trials/certainty-report.ts <id>...
node --disable-warning=ExperimentalWarning eval/trials/report-wording-report.ts <id>...
```

## 保留 25 件の一件ごとの結果

★は保留の記事。「貼り付け」は ScanNetSecurity の 13 件のうち保留の 5 件。

| ID                                | 区分           | 期待の種類                           | 読解の種類       | 種類       | デモ精工の判定 | 入口（期待／読解）           | 根拠文 | 備考     |
| --------------------------------- | -------------- | ------------------------------------ | ---------------- | ---------- | -------------- | ---------------------------- | ------ | -------- |
| ransom-komai ★                    | ランサム       | ransomware                           | ransomware       | 厳密       | 入口なし       | rdp／rdp                     | 3/3    |          |
| ransom-japangas ★                 | ランサム       | ransomware                           | ransomware       | 厳密       | 入口なし       | rdp／rdp                     | 4/4    |          |
| ransom-tokiwa ★                   | ランサム       | ransomware                           | ransomware       | 厳密       | 侵入される     | none／—                      | 2/2    |          |
| ransom-uniden ★                   | ランサム       | ransomware                           | ransomware       | 厳密       | 侵入される     | vpn／vpn                     | 4/4    |          |
| ransom-tokai-itmedia ★            | ランサム       | ransomware                           | data_breach      | **不一致** | 侵入される     | vendor／vendor               | 3/3    |          |
| ransom-matsuyama ★                | ランサム       | ransomware                           | ransomware       | 厳密       | 侵入される     | none／—                      | 2/2    |          |
| ransom-rext ★                     | ランサム       | ransomware                           | ransomware       | 厳密       | 侵入される     | none／—                      | 2/2    |          |
| breach-proself ★                  | 情報漏えい     | data_breach                          | data_breach      | 厳密       | 入口なし       | vuln-exploit／web            | 4/4    |          |
| breach-keds ★                     | 情報漏えい     | data_breach                          | data_breach      | 厳密       | 入口なし       | credential-abuse／credential | 2/2    | 貼り付け |
| breach-pia ★                      | 情報漏えい     | data_breach                          | data_breach      | 厳密       | 入口なし       | cloud-misconfig／—           | 2/2    |          |
| breach-mitsubishi-mdm ★           | 情報漏えい     | data_breach                          | data_breach      | 厳密       | 入口なし       | vuln-exploit／web            | 2/2    | 貼り付け |
| breach-denso-sp ★                 | 情報漏えい     | data_breach                          | data_breach      | 厳密       | 入口なし       | cloud-misconfig／—           | 2/2    | 貼り付け |
| breach-campfire ★                 | 情報漏えい     | data_breach                          | data_breach      | 厳密       | 入口なし       | credential-abuse／credential | 3/3    | 貼り付け |
| breach-timescar ★                 | 情報漏えい     | data_breach                          | data_breach      | 厳密       | 入口なし       | none／—                      | 1/1    |          |
| bec-ipa-2024 ★                    | BEC・乗っ取り  | bec                                  | out_of_scope     | **不一致** | 対象外         | （自由記述）／—              | 0/0    |          |
| bec-fin-6oku ★                    | BEC・乗っ取り  | bec                                  | out_of_scope     | **不一致** | 対象外         | （自由記述）／—              | 0/0    |          |
| bec-oita ★                        | BEC・乗っ取り  | bec                                  | bec              | 厳密       | 侵入される     | （自由記述）／mail           | 4/4    |          |
| ato-sakura ★                      | BEC・乗っ取り  | account_takeover（許容 data_breach） | account_takeover | 厳密       | 入口なし       | （自由記述）／mail           | 3/3    | 貼り付け |
| ato-proofpoint-rules ★            | BEC・乗っ取り  | account_takeover                     | out_of_scope     | **不一致** | 対象外         | （自由記述）／—              | 0/0    |          |
| ato-hotel ★                       | BEC・乗っ取り  | account_takeover（許容 data_breach） | account_takeover | 厳密       | 入口なし       | （自由記述）／—              | 3/3    |          |
| supply-murata-subsidiary ★        | 取引先・対象外 | data_breach（許容 ransomware）       | data_breach      | 厳密       | 侵入される     | subsidiary_remote／vpn       | 3/3    |          |
| supply-fujikura-maintenance-vpn ★ | 取引先・対象外 | data_breach                          | data_breach      | 厳密       | 侵入される     | maintenance_vpn／vpn         | 3/3    |          |
| supply-corona-cloud ★             | 取引先・対象外 | data_breach                          | data_breach      | 厳密       | 入口なし       | cloud_vendor／—              | 1/1    |          |
| oos-ntt-insider ★                 | 取引先・対象外 | out_of_scope                         | out_of_scope     | 厳密       | 対象外         | none／—                      | 0/0    |          |
| oos-toyota-usb ★                  | 取引先・対象外 | out_of_scope                         | out_of_scope     | 厳密       | 対象外         | none／—                      | 0/0    |          |


## 全 146 件の一件ごとの結果

判定はデモ精工。「入口」は期待（`yaml` の値）と、読解が付けた入口の種類。IR の「通せず」は取得できなかった件。

| ID                                | 区分           | 期待の種類                                   | 読解の種類       | 種類       | デモ精工の判定 | 入口（期待／読解）                             | 根拠文 | 備考       |
| --------------------------------- | -------------- | -------------------------------------------- | ---------------- | ---------- | -------------- | ---------------------------------------------- | ------ | ---------- |
| ransom-suginami                   | ランサム       | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ransom-kyoto-hospital             | ランサム       | ransomware                                   | ransomware       | 厳密       | 侵入される     | vpn／vpn                                       | 3/3    |            |
| ransom-komai ★                    | ランサム       | ransomware                                   | ransomware       | 厳密       | 入口なし       | rdp／rdp                                       | 3/3    |            |
| ransom-tomoe                      | ランサム       | ransomware                                   | ransomware       | 厳密       | 入口なし       | rdp／rdp                                       | 3/3    |            |
| ransom-oiles                      | ランサム       | ransomware                                   | ransomware       | 厳密       | 侵入される     | vpn／vpn                                       | 2/2    |            |
| ransom-japangas ★                 | ランサム       | ransomware                                   | ransomware       | 厳密       | 入口なし       | rdp／rdp                                       | 4/4    |            |
| ransom-ikaruga                    | ランサム       | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ransom-ctc-subcontractor          | ランサム       | ransomware                                   | ransomware       | 厳密       | 侵入される     | vendor／credential                             | 4/4    |            |
| ransom-belldata                   | ランサム       | ransomware                                   | ransomware       | 厳密       | 侵入される     | vpn／vpn                                       | 4/4    |            |
| ransom-tokiwa ★                   | ランサム       | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ransom-senko                      | ランサム       | ransomware                                   | ransomware       | 厳密       | 侵入される     | vpn／vpn                                       | 3/3    |            |
| ransom-jikko                      | ランサム       | ransomware                                   | ransomware       | 厳密       | 侵入される     | internet／—                                    | 2/2    |            |
| ransom-uniden ★                   | ランサム       | ransomware                                   | ransomware       | 厳密       | 侵入される     | vpn／vpn                                       | 4/4    |            |
| ransom-npo                        | ランサム       | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ransom-cbys                       | ランサム       | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ransom-juntendo                   | ランサム       | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ransom-tokai-itmedia ★            | ランサム       | ransomware                                   | data_breach      | **不一致** | 侵入される     | vendor／vendor                                 | 3/3    |            |
| ransom-shizuoka-hospital          | ランサム       | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ransom-tein                       | ランサム       | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ransom-matsuyama ★                | ランサム       | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ransom-loss-adjuster              | ランサム       | ransomware                                   | ransomware       | 厳密       | 侵入される     | network-device／network-device                 | 7/7    |            |
| ransom-medica                     | ランサム       | ransomware                                   | ransomware       | 厳密       | 侵入される     | credential／—                                  | 1/1    | 貼り付け   |
| ransom-marutaka                   | ランサム       | ransomware                                   | ransomware       | 厳密       | 侵入される     | vpn／vpn                                       | 6/6    |            |
| ransom-rext ★                     | ランサム       | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| breach-nagasaki-manabie           | 情報漏えい     | data_breach                                  | data_breach      | 厳密       | 入口なし       | none／—                                        | 0/0    | 貼り付け   |
| breach-tokio-agency               | 情報漏えい     | data_breach                                  | data_breach      | 厳密       | 入口なし       | cloud-misconfig／—                             | 1/1    |            |
| breach-proself ★                  | 情報漏えい     | data_breach                                  | data_breach      | 厳密       | 入口なし       | vuln-exploit／web                              | 4/4    |            |
| breach-lineyahoo-vendor           | 情報漏えい     | data_breach                                  | data_breach      | 厳密       | 侵入される     | vendor／vendor                                 | 2/2    |            |
| breach-sophia                     | 情報漏えい     | data_breach                                  | account_takeover | **不一致** | 入口なし       | credential-abuse／—                            | 1/1    |            |
| breach-keds ★                     | 情報漏えい     | data_breach                                  | data_breach      | 厳密       | 入口なし       | credential-abuse／credential                   | 2/2    | 貼り付け   |
| breach-shopchannel                | 情報漏えい     | data_breach                                  | data_breach      | 厳密       | 入口なし       | credential-abuse／credential                   | 2/2    | 貼り付け   |
| breach-nishitetsu                 | 情報漏えい     | data_breach                                  | data_breach      | 厳密       | 入口なし       | web-app-flaw／web                              | 2/2    | 貼り付け   |
| breach-pia ★                      | 情報漏えい     | data_breach                                  | data_breach      | 厳密       | 入口なし       | cloud-misconfig／—                             | 2/2    |            |
| breach-tege                       | 情報漏えい     | data_breach                                  | data_breach      | 厳密       | 入口なし       | cloud-misconfig／—                             | 1/1    |            |
| breach-agc                        | 情報漏えい     | data_breach                                  | data_breach      | 厳密       | 入口なし       | vendor／—                                      | 1/1    |            |
| breach-mitsubishi-mdm ★           | 情報漏えい     | data_breach                                  | data_breach      | 厳密       | 入口なし       | vuln-exploit／web                              | 2/2    | 貼り付け   |
| breach-sasadango                  | 情報漏えい     | data_breach                                  | data_breach      | 厳密       | 入口なし       | web-app-flaw／web                              | 4/4    |            |
| breach-tokushima-hosp             | 情報漏えい     | data_breach                                  | data_breach      | 厳密       | 入口なし       | none／—                                        | 1/1    | 貼り付け   |
| breach-denso-sp ★                 | 情報漏えい     | data_breach                                  | data_breach      | 厳密       | 入口なし       | cloud-misconfig／—                             | 2/2    | 貼り付け   |
| breach-form-2026                  | 情報漏えい     | data_breach                                  | data_breach      | 厳密       | 入口なし       | cloud-misconfig／—                             | 1/1    |            |
| breach-fukuoka-edu                | 情報漏えい     | data_breach                                  | data_breach      | 厳密       | 入口なし       | cloud-misconfig／—                             | 1/1    | 貼り付け   |
| breach-campfire ★                 | 情報漏えい     | data_breach                                  | data_breach      | 厳密       | 入口なし       | credential-abuse／credential                   | 3/3    | 貼り付け   |
| breach-tabiq                      | 情報漏えい     | data_breach                                  | data_breach      | 厳密       | 止まる         | cloud-misconfig／—                             | 1/1    | 貼り付け   |
| breach-montbell                   | 情報漏えい     | data_breach                                  | data_breach      | 厳密       | 入口なし       | vuln-exploit／web                              | 3/3    |            |
| breach-timescar ★                 | 情報漏えい     | data_breach                                  | data_breach      | 厳密       | 入口なし       | none／—                                        | 1/1    |            |
| bec-ipa-2023                      | BEC・乗っ取り  | bec                                          | bec              | 厳密       | 侵入される     | （自由記述）／mail                             | 3/3    |            |
| bec-3dmatrix                      | BEC・乗っ取り  | bec                                          | bec              | 厳密       | 侵入される     | 取引先を装うメール（支払口座の変更依頼）／mail | 3/3    |            |
| bec-ipa-2024 ★                    | BEC・乗っ取り  | bec                                          | out_of_scope     | **不一致** | 対象外         | （自由記述）／—                                | 0/0    |            |
| bec-survey-2024                   | BEC・乗っ取り  | bec                                          | out_of_scope     | **不一致** | 対象外         | （自由記述）／—                                | 0/0    |            |
| bec-sanshin                       | BEC・乗っ取り  | bec                                          | bec              | 厳密       | 侵入される     | （自由記述）／—                                | 1/1    | 貼り付け   |
| bec-fin-6oku ★                    | BEC・乗っ取り  | bec                                          | out_of_scope     | **不一致** | 対象外         | （自由記述）／—                                | 0/0    |            |
| bec-npa-nise                      | BEC・乗っ取り  | bec                                          | out_of_scope     | **不一致** | 対象外         | （自由記述）／—                                | 0/0    |            |
| bec-kyoto-boeki                   | BEC・乗っ取り  | bec                                          | bec              | 厳密       | 侵入される     | （自由記述）／—                                | 4/4    |            |
| bec-oita ★                        | BEC・乗っ取り  | bec                                          | bec              | 厳密       | 侵入される     | （自由記述）／mail                             | 4/4    |            |
| bec-odawara                       | BEC・乗っ取り  | bec（許容 account_takeover）                 | account_takeover | 許容       | 入口なし       | （自由記述）／—                                | 2/2    |            |
| ato-nmr                           | BEC・乗っ取り  | account_takeover（許容 data_breach）         | account_takeover | 厳密       | 入口なし       | （自由記述）／mail                             | 4/4    |            |
| ato-kawai                         | BEC・乗っ取り  | account_takeover                             | account_takeover | 厳密       | 入口なし       | （自由記述）／—                                | 1/1    |            |
| ato-sakura ★                      | BEC・乗っ取り  | account_takeover（許容 data_breach）         | account_takeover | 厳密       | 入口なし       | （自由記述）／mail                             | 3/3    | 貼り付け   |
| ato-jems                          | BEC・乗っ取り  | account_takeover                             | account_takeover | 厳密       | 入口なし       | （自由記述）／—                                | 2/2    |            |
| ato-toho                          | BEC・乗っ取り  | account_takeover                             | account_takeover | 厳密       | 入口なし       | （自由記述）／—                                | 1/1    |            |
| ato-proofpoint-rules ★            | BEC・乗っ取り  | account_takeover                             | out_of_scope     | **不一致** | 対象外         | （自由記述）／—                                | 0/0    |            |
| ato-kodansha                      | BEC・乗っ取り  | account_takeover（許容 data_breach）         | data_breach      | 許容       | 侵入される     | （自由記述）／mail                             | 5/5    |            |
| ato-m365-mfa                      | BEC・乗っ取り  | account_takeover（許容 bec）                 | bec              | 許容       | 侵入される     | （自由記述）／—                                | 2/2    |            |
| ato-hotel ★                       | BEC・乗っ取り  | account_takeover（許容 data_breach）         | account_takeover | 厳密       | 入口なし       | （自由記述）／—                                | 3/3    |            |
| supply-sekisui-yamaguchi          | 取引先・対象外 | ransomware（許容 data_breach）               | ransomware       | 厳密       | 侵入される     | contractor_system／vendor                      | 3/3    |            |
| supply-murata-subsidiary ★        | 取引先・対象外 | data_breach（許容 ransomware）               | data_breach      | 厳密       | 侵入される     | subsidiary_remote／vpn                         | 3/3    |            |
| supply-mlit-subcontractor         | 取引先・対象外 | ransomware（許容 data_breach）               | ransomware       | 厳密       | 侵入される     | contractor_system／vpn                         | 4/4    |            |
| supply-fujikura-maintenance-vpn ★ | 取引先・対象外 | data_breach                                  | data_breach      | 厳密       | 侵入される     | maintenance_vpn／vpn                           | 3/3    |            |
| supply-itoki-subcontractor        | 取引先・対象外 | ransomware（許容 data_breach）               | ransomware       | 厳密       | 侵入される     | contractor_system／—                           | 2/2    |            |
| supply-askul-muji                 | 取引先・対象外 | ransomware                                   | ransomware       | 厳密       | 侵入される     | vendor_outage／—                               | 2/2    |            |
| supply-emeditor-site              | 取引先・対象外 | data_breach（許容 out_of_scope）             | out_of_scope     | 許容       | 対象外         | software_distribution／web                     | 3/3    |            |
| supply-notepadpp-update           | 取引先・対象外 | data_breach（許容 out_of_scope）             | out_of_scope     | 許容       | 対象外         | software_update／—                             | 3/3    |            |
| supply-corona-cloud ★             | 取引先・対象外 | data_breach                                  | data_breach      | 厳密       | 入口なし       | cloud_vendor／—                                | 1/1    |            |
| supply-nec-contractor             | 取引先・対象外 | ransomware（許容 data_breach）               | ransomware       | 厳密       | 侵入される     | contractor_account／vendor                     | 4/4    |            |
| oos-sangyoeisei-ddos              | 取引先・対象外 | out_of_scope                                 | out_of_scope     | 厳密       | 対象外         | none／—                                        | 1/1    |            |
| oos-ntt-insider ★                 | 取引先・対象外 | out_of_scope                                 | out_of_scope     | 厳密       | 対象外         | none／—                                        | 0/0    |            |
| oos-kanagawa-misprint             | 取引先・対象外 | out_of_scope                                 | out_of_scope     | 厳密       | 対象外         | none／—                                        | 0/0    |            |
| oos-toyota-usb ★                  | 取引先・対象外 | out_of_scope                                 | out_of_scope     | 厳密       | 対象外         | none／—                                        | 0/0    |            |
| oos-jpcert-php                    | 取引先・対象外 | out_of_scope                                 | out_of_scope     | 厳密       | 対象外         | none／—                                        | 0/0    |            |
| oos-jpcert-advisory               | 取引先・対象外 | out_of_scope（許容 data_breach）             | out_of_scope     | 厳密       | 対象外         | none／—                                        | 0/0    |            |
| oos-ipa-sme-survey                | 取引先・対象外 | out_of_scope                                 | out_of_scope     | 厳密       | 対象外         | none／—                                        | 0/0    |            |
| ir-nidec1                         | IR             | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ir-nidec2                         | IR             | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ir-yodoko1                        | IR             | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ir-yodoko2                        | IR             | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ir-daiwabo                        | IR             | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ir-askul-1020                     | IR             | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ir-askul-news                     | IR             | ransomware（許容 out_of_scope）              | ransomware       | 厳密       | 侵入される     | none／—                                        | 1/1    |            |
| ir-xebio                          | IR             | data_breach                                  | data_breach      | 厳密       | 入口なし       | vendor／—                                      | 3/3    |            |
| ir-san-hd                         | IR             | data_breach                                  | data_breach      | 厳密       | 入口なし       | web／—                                         | 2/2    |            |
| ir-treasure                       | IR             | data_breach                                  | data_breach      | 厳密       | 入口なし       | none／—                                        | 2/2    |            |
| ir-zuken                          | IR             | ransomware（許容 out_of_scope）              | out_of_scope     | 許容       | 対象外         | none／—                                        | 1/1    |            |
| ir-ibiden                         | IR             | out_of_scope                                 | out_of_scope     | 厳密       | 対象外         | web／—                                         | 1/1    |            |
| ir-iseki1                         | IR             | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ir-iseki2                         | IR             | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 1/2    |            |
| ir-sakata2                        | IR             | data_breach                                  | data_breach      | 厳密       | 侵入される     | none／network-device                           | 4/4    |            |
| ir-sakata-final                   | IR             | data_breach                                  | data_breach      | 厳密       | 侵入される     | none／network-device                           | 1/1    |            |
| ir-oug-final                      | IR             | out_of_scope                                 | out_of_scope     | 厳密       | 対象外         | web／—                                         | 1/1    |            |
| ir-kadokawa-0627                  | IR             | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ir-kadokawa-0628                  | IR             | ransomware（許容 data_breach）               | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ir-kadokawa-0702                  | IR             | ransomware（許容 data_breach）               | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ir-kadokawa-0729                  | IR             | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ir-kadokawa-0911                  | IR             | ransomware（許容 data_breach）               | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ir-panasonic-alrac                | IR             | data_breach                                  | data_breach      | 厳密       | 入口なし       | web／—                                         | 2/2    |            |
| ir-yac-garter                     | IR             | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ir-asahi-2                        | IR             | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ir-asahi-result                   | IR             | ransomware（許容 data_breach）               | ransomware       | 厳密       | 侵入される     | network-device／network-device                 | 4/4    |            |
| ir-asahi-prevent                  | IR             | ransomware                                   | ransomware       | 厳密       | 侵入される     | network-device／network-device                 | 7/7    |            |
| ir-asahi-pii                      | IR             | data_breach（許容 ransomware）               | data_breach      | 厳密       | 侵入される     | none／network-device                           | 3/3    |            |
| ir-nichirei-1                     | IR             | ransomware（許容 data_breach・out_of_scope） | data_breach      | 許容       | 侵入される     | none／—                                        | 2/2    |            |
| ir-nichirei-2                     | IR             | ransomware（許容 data_breach・out_of_scope） | ransomware       | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ir-nichirei-0716                  | IR             | ransomware（許容 data_breach・out_of_scope） | data_breach      | 許容       | 侵入される     | none／—                                        | 2/2    |            |
| ir-nichirei-7                     | IR             | data_breach（許容 ransomware）               | data_breach      | 厳密       | 侵入される     | none／—                                        | 2/2    |            |
| ir-jrc-idcf-2                     | IR             | data_breach                                  | data_breach      | 厳密       | 入口なし       | vendor／—                                      | 1/1    |            |
| ir-jrc-ymir                       | IR             | data_breach                                  | data_breach      | 厳密       | 入口なし       | vendor／—                                      | 2/2    |            |
| ir-mitsui-park                    | IR             | account_takeover                             | data_breach      | **不一致** | 入口なし       | credential／—                                  | 2/2    |            |
| ir-japanpost-pdf                  | IR             | account_takeover（許容 data_breach）         | data_breach      | 許容       | 入口なし       | credential／—                                  | 2/2    |            |
| ir-japanpost-html                 | IR             | account_takeover（許容 data_breach）         | out_of_scope     | **不一致** | 対象外         | credential／—                                  | 0/0    |            |
| ir-yamaichi-pdf                   | IR             | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 1/1    |            |
| ir-yamaichi-html                  | IR             | ransomware                                   | out_of_scope     | **不一致** | 対象外         | none／—                                        | 0/0    |            |
| ir-taikisha-us1                   | IR             | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 1/1    |            |
| ir-taikisha-us2                   | IR             | ransomware                                   | ransomware       | 厳密       | 侵入される     | none／—                                        | 1/1    |            |
| ir-taikisha-id                    | IR             | account_takeover                             | account_takeover | 厳密       | 入口なし       | mail／—                                        | 2/2    |            |
| ir-taikisha-my                    | IR             | account_takeover                             | account_takeover | 厳密       | 入口なし       | mail／—                                        | 2/2    |            |
| ir-futaba                         | IR             | out_of_scope（許容 bec）                     | out_of_scope     | 厳密       | 対象外         | mail／mail                                     | 1/1    |            |
| ir-daj-faq                        | IR             | data_breach（許容 account_takeover）         | data_breach      | 厳密       | 侵入される     | credential／credential                         | 3/3    |            |
| ir-kddi-lifenet                   | IR             | data_breach                                  | data_breach      | 厳密       | 侵入される     | vendor／web                                    | 1/1    |            |
| ir-daiwa                          | IR             | data_breach                                  | data_breach      | 厳密       | 入口なし       | vendor／—                                      | 1/1    |            |
| ir-monogatari-1                   | IR             | data_breach                                  | data_breach      | 厳密       | 入口なし       | web／—                                         | 1/1    |            |
| ir-monogatari-2                   | IR             | data_breach                                  | data_breach      | 厳密       | 入口なし       | web／—                                         | 0/0    |            |
| ir-takeuchi                       | IR             | ransomware                                   | —                | 通せず     | —              | —                                              | —      | 取得できず |
| ir-oug-1                          | IR             | out_of_scope                                 | —                | 通せず     | —              | —                                              | —      | 取得できず |
| ir-oug-2                          | IR             | out_of_scope                                 | —                | 通せず     | —              | —                                              | —      | 取得できず |
| ir-nec-vendor                     | IR             | ransomware（許容 data_breach）               | —                | 通せず     | —              | —                                              | —      | 取得できず |
| ir-nomura-vendor                  | IR             | data_breach                                  | —                | 通せず     | —              | —                                              | —      | 取得できず |
| ir-jrc-idcf-1                     | IR             | data_breach                                  | —                | 通せず     | —              | —                                              | —      | 取得できず |
| ir-jal-cargo                      | IR             | out_of_scope                                 | —                | 通せず     | —              | —                                              | —      | 取得できず |
| ir-jal-pay                        | IR             | out_of_scope                                 | —                | 通せず     | —              | —                                              | —      | 取得できず |
| ir-sagawa-2                       | IR             | data_breach                                  | —                | 通せず     | —              | —                                              | —      | 取得できず |
| ir-sagawa-5                       | IR             | data_breach                                  | —                | 通せず     | —              | —                                              | —      | 取得できず |
| php-valtec1                       | PHP2Shell      | data_breach                                  | data_breach      | 厳密       | 入口なし       | web／web                                       | 3/3    |            |
| php-valtec3                       | PHP2Shell      | data_breach                                  | data_breach      | 厳密       | 入口なし       | web／web                                       | 3/3    |            |
| php-xserver                       | PHP2Shell      | out_of_scope                                 | out_of_scope     | 厳密       | 対象外         | none／—                                        | 0/0    |            |
| php-sakura                        | PHP2Shell      | out_of_scope                                 | out_of_scope     | 厳密       | 対象外         | none／—                                        | 0/0    |            |
| php-lineworks                     | PHP2Shell      | out_of_scope                                 | out_of_scope     | 厳密       | 対象外         | none／—                                        | 0/0    |            |
| php-osaka                         | PHP2Shell      | out_of_scope                                 | out_of_scope     | 厳密       | 対象外         | none／—                                        | 0/0    |            |
