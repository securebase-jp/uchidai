# ウチダイへの貢献

ウチダイは「うちの会社は大丈夫か？」に根拠つきで答えるツールで、答えの質は **知見（知識ファイル）** で決まる。コードより先に、型紙・判定ルール・質問表・対策・期限を足したり直したりする貢献を歓迎する。この文書はその足し方を中心に書く。

## 設計の背骨（守ること）

- **判定はプログラムが決定的に行う。** Claude は「読む・言い換える・書く・探す」だけ。判定・計算・期限に Claude を使う変更は受け付けない
- **知見はデータとして持つ。** 「この脆弱性には多要素認証が効かない」のような知識は、コードの分岐ではなく `knowledge/` の YAML に書く。画面やエンジンはそれを読むだけ
- **未確認を「止まる」と扱わない。** 根拠（外部確認、ベンダー回答、担当者登録）が無い対策で止まる判定にはしない。評価関数がこれを保証するが、ルールもその前提で書く
- **会社カルテはブラウザにだけ。** サーバに保存する変更、Claude に社名・製品名・ホスト名を送る変更は受け付けない
- **対象ホストにはアクセスしない。** 外部確認は所有確認したドメインの DNS と証明書の公開ログだけ。AI攻撃者は ATT&CK の手法の水準まで。実在製品の攻撃手順・コマンド・コードを出す変更は受け付けない
- **出典を明記する。** 外部データ（ATT&CK、IPA 事例集、警察庁統計、個人情報保護委員会資料、CISA KEV）は README と NOTICE に出典を書く。出典を足すときは `knowledge/sources.yaml` に項目を足す。画面の「データの扱いと出典」の出典の部分はそこから作られるので、README と NOTICE の記述もそれと食い違わないように直す。IPA 事例集の本文はリポジトリに入れない（出典つきの短い抜粋と自分の言葉での要約だけ）
- UI の文言とドキュメントは日本語。Streamlit は使わない。ICS は対象外

## 知見ファイルの地図

```
knowledge/
  attack/                 取り込んだ ATT&CK（生成物。pnpm attack:import で更新）。version.json に版
  labels.ja.yaml          戦術・手法・緩和策・独自基準（UD-xx）の日本語ラベル
  roles.yaml              役割の枠（entry.vpn、admin、backup、core、cloud.mail_account.exec …）
  templates/*.yaml        型紙：被害の型ごとの段階 → 役割 → 典型手法 → 受け入れる手法
  rules/*.yaml            判定ルール表：役割 × 手法 → 条件式 → 5 状態と理由、効かない緩和策
  profiles/*.yaml         業種別の構成パターン（製造、事務、医療）：中核の名前、業務と日数、個人情報の既定
  questions.yaml          最初の5問 → 役割の枠と確認する緩和策
  measures.yaml           対策ボタン：役割の資産にどの緩和策・属性を書くか、依頼先
  costs.yaml              対策費用の目安（出典ページつきの単価だけ）
  deadlines.yaml          法令・実務上の期限と報告義務の条件（出典・確認日つき）
  entry-candidates.yaml   入口が不明なときの候補と並び順（警察庁統計）
  sources.yaml            ツール全体の出典の一覧（画面の「データの扱いと出典」の元。分類・名称・URL・発行元・利用条件・確認日）
  schemas/                JSON Schema（pnpm knowledge:check が zod から書き出す。手で編集しない）
apps/web/src/server/requests/questions.ts   確認の質問表（緩和策 ID ごとの 1 問の選択式）
examples/demo-seiko.json                    架空の会社のカルテ（検証にも使う）
```

すべて `pnpm knowledge:check` で検証される（役割・手法・緩和策の存在、日本語ラベルの有無、カルテの形）。

## 型紙を足す・直す（`knowledge/templates/`）

> 被害の型（damageType）ごとに型紙は複数持てます。判定は、記事の段階が手法まで対応づいた数 → 記事の手法の一致数 → `priority`（大きいほど優先）の順で 1 本を選びます。入口が不明な記事では同点の型紙を全部展開します。段階の `branch: true` は、記事に対応づいたときだけ入る枝で、止まっても本線は進みます（ランサムウェアの持ち出し＝二重恐喝）。

型紙は「この型の攻撃はどんな段階で進むか」を役割の枠に対して書く。会社ごとの具体名は書かない。

```yaml
id: ransomware # 一意。ファイル名と合わせる
damageType: ransomware # ransomware | bec | data_breach | out_of_scope
labelJa: 業務停止（ランサムウェア）
descriptionJa: 入口から侵入し、管理者権限を奪って社内に広がり、バックアップを消してから暗号化する
stages:
  - id: entry
    labelJa: 入口から侵入
    tactics: [TA0001] # この段階に当たる戦術（記事の段階との照合に使う）
    entry: true # 入口の段階。記事に入口が無ければ入口候補を展開する
    byRole: # 役割ごとの典型手法。記事に無ければ「推定」として埋める
      entry.vpn: T1190
      entry.rdp: T1133
      pc: T1566
    accepts: [T1190, T1133, T1078, T1566, T1566.001] # 記事から読まれたとき、この段階として受け入れる手法
  - id: recovery
    labelJa: バックアップを消す
    breachedJa: 暗号化される # 突破されたときの画面の札（現在形）。無ければ「突破される」
    breachedDoneJa: 暗号化されました # 再生中の帯の文（過去形）。「バックアップが暗号化されました」になる
    tactics: [TA0040]
    byRole: { backup: T1490 }
    accepts: [T1490, T1485]
    optional: true # 記事に無くても経路は成立する
  - id: encrypt
    labelJa: 暗号化・業務停止
    tactics: [TA0040]
    byRole: { core: T1486 }
    accepts: [T1486, T1489]
    terminal: true # 中核に到達する段階
```

- `precondition: true` は前提として表示するだけの段階（なりすまし送金の「パスワードが流出している」など）
- `breachedJa` と `breachedDoneJa` は、その段階が突破されたときに画面が使う言葉（構成図の札は現在形、再生中の帯は過去形）。インシデントの内容に合わせて「暗号化される」「だまされる」「漏えいする」のように書く。省略すると汎用の「突破される／突破されました」になる
- `accepts` に書いた手法だけが記事から対応づけられる。書いていない手法は読解の結果から捨てられる。記事でよく使われる言い回しが別の手法 ID に読まれるなら、ここに足す（例：「システムが停止した」は T1489）。足すときは `labels.ja.yaml` にラベルも足す
- 段階の役割は `roles.yaml` に無いと検証で落ちる。新しい役割が要るときは `roles.yaml` と、その役割を作る `questions.yaml`／`profiles/`、描く側の列（`layer`、`side`）も合わせる
- 型紙を足したら、その段階ごとに判定ルール（次項）が要る。ルールの無い段階は判定できない

## 判定ルールを足す・直す（`knowledge/rules/`）

ルールは「役割 × 手法」に対して、カルテの対策（緩和策の有無）と属性から段階の状態を決める。

```yaml
rules:
  - id: ransomware.entry.vpn
    role: entry.vpn
    techniques: [T1190] # 空なら、その役割の既定ルール
    materialsJa: 外部確認：VPN装置の露出。カルテ：製品・バージョン、更新の運用
    mitigations: [M1042, M1051] # この段階で効く緩和策（画面の「効く緩和策」、確認依頼の候補になる）
    ineffective: # 効かない緩和策（注記ではなくデータ。知見なし比較の根拠にもなる）
      - mitigation: M1032
        when: { attr: { key: authBypass, equals: true } }
        reasonJa: この脆弱性は認証を回避するため、多要素認証では止まりません
    outcomes: # 上から順に評価し、最初に一致した状態を採用する
      - state: blocked
        when: { control: { mitigation: M1042, status: present } }
        reasonJa: VPN装置を外部に公開していない
      - state: breached
        when: { attr: { key: knownExploited, equals: true } }
        reasonJa: 製品・バージョンが悪用確認済みの脆弱性に該当する
      - state: unknown
        when:
          any:
            - control: { mitigation: M1051, status: unknown }
            - attr: { key: version, missing: true }
        reasonJa: バージョンまたは更新の運用が未確認
      - state: breached # when の無い行は既定
        reasonJa: 更新の運用がなく、脆弱性が残っている
```

**条件式 DSL**：`all: [...]`、`any: [...]`、`not: {...}`、`control: { mitigation, status: present | absent | unknown }`、`attr: { key, equals: 値 }`、`attr: { key, missing: true }`、`always: true`。

**5 つの状態**：

| 状態          | 意味                                                   | 色  |
| ------------- | ------------------------------------------------------ | --- |
| `blocked`     | ここで止まる                                           | 緑  |
| `recoverable` | やられるが戻せる（経路は止めず、停止日数を短くする）   | 緑  |
| `unknown`     | 未確認。止まるとは扱わない                             | 黄  |
| `human`       | 人の判断にかかっている（研修だけ、承認ボタン方式など） | 黄  |
| `breached`    | 突破される                                             | 赤  |

**書き方の原則**：

- 止まる状態（`blocked`、`recoverable`、`human`）には必ず `when` を書き、確定した対策か属性を条件にする。未確認で止まる書き方をしても、評価関数が `unknown` に落とす
- 緑の条件は厳しく（例：横展開は区画の分離と通信の制限が揃って緑）、未確認は独立した行で黄に、既定は赤。「分からないなら最悪を想定する」が利用者を守る
- ルールの選び方は、手法が完全一致 → 親手法が一致（サブ手法 `T1566.001` は `T1566` のルールに当たる）→ 役割の既定ルール（`techniques: []`）。段階に手法が無いときは既定ルール
- 根拠の優先は外部確認 ＞ ベンダー回答 ＞ 担当者登録。同じ緩和策に食い違う根拠があれば「矛盾」として画面に出る
- 属性（`attrs`）は確認の質問表の選択肢（下記）か外部確認が書く。新しい属性を条件に使うときは、どちらかに書き手を足す
- `reasonJa` は担当者画面にそのまま出る。手法 ID や緩和策 ID を文に入れてもよい（社長向けの一枚では取り除かれる）

## 日本語ラベル（`knowledge/labels.ja.yaml`）

型紙・ルール・質問表で使う戦術、手法、緩和策には日本語ラベルが要る（無いと `knowledge:check` が落ちる）。MITRE の公式訳ではなく本プロジェクト独自の訳なので、既存の語調（短い名詞句、専門用語を避ける）に合わせる。独自基準（ATT&CK に無い対策）は `UD-xx` として `custom` に足し、`descriptionJa` で何を指すかを書く。

## 確認の質問表（`apps/web/src/server/requests/questions.ts`）

緩和策 ID ごとに「1 問だけの選択式」。ベンダーへの確認依頼と、カルテ画面の「自分で答える」の両方で使う。

```ts
{
  mitigation: "M1026",
  textJa: "管理者のパスワードは、全 PC で共通ですか",
  hintJa: "キッティング時に同じ管理者パスワードを入れたままかどうか",
  choices: [
    { id: "shared", labelJa: "全 PC で共通", status: "absent", attrs: { sharedPassword: true } },
    { id: "individual", labelJa: "PC ごとに個別", status: "present", attrs: { sharedPassword: false } },
    UNKNOWN,
  ],
}
```

- 文言は専門用語を避け、保守ベンダーが 1 分で答えられる形に。必ず「分からない」（`UNKNOWN`）を残す
- 選択肢の `status` と `attrs` が、判定ルールの `control` と `attr` の材料になる。ルールが見る属性だけを書く
- 質問の無い緩和策は画面で「あり／なし／分からない」の 3 択になる

## 対策ボタンと費用（`measures.yaml`、`costs.yaml`）

```yaml
# measures.yaml
- id: vpn-update
  labelJa: VPN 装置の更新
  mitigation: M1051
  patches: # 役割で資産を特定し、緩和策の有無と属性を書き換える（根拠は担当者登録）
    - role: entry.vpn
      mitigation: M1051
      status: present
      attrs: { knownExploited: false, authBypass: false }
  requestToJa: 保守ベンダー
```

費用は `costs.yaml` に、出典ページで確認できた単価（`unitPrices`）と、対策 ID との対応（`measures`：`basis` が `ipa` なら `unitPriceId` と数量の根拠 `quantity: devices | people | company`、見積もりが要るなら `quote`、社内ルールなら `internal`）を書く。単価が確認できない対策は「ベンダーの見積もり待ち」と表示される。推計値や相場観は入れない。

## 期限（`deadlines.yaml`）

法令・実務上の期限は、`sources`（名称、URL、確認日）と `deadlines`（`kind: legal | insurance | partner | police | money`、日数、根拠条文、`sourceId`、`status: confirmed | unverified`）で持つ。報告義務の条件は `reportTriggers`。確認できなかった項目は `status: unverified` と `noteJa` に「要確認」を明記する。日付の計算はプログラムが行う。

## 業種別パターンと最初の5問（`profiles/`、`questions.yaml`）

- `profiles/<id>.yaml`：中核システムの名前、業務（手作業で回せる日数、復旧日数、切り離したバックアップがあるときの復旧日数、影響先）、個人情報の既定。業種を足すときは `questions.yaml` の業種の選択肢に `pattern` を対応づける
- 「現場はありますか？」の選択肢（`site`）には `industries`（出す業種の `value` の配列）を付けられる。付けた選択肢は、その業種を選んだときだけ出る（製造・建設に「診療所・施設」は出さない）。付けなければすべての業種に出る。業種を足すときは、その業種に出す現場を `industries` に加える
- `questions.yaml`：5 問の文言と選択肢、選択肢が作る役割（`addsRole`）と確認する緩和策（`checks`）。問いを増やすと「2 分で終わる」が崩れるので、既存の問いの選択肢を足す方を先に考える
- 入口候補の並び順（`entry-candidates.yaml`）は警察庁の統計の件数順。更新するときは統計の版と URL、転記した日を書く

## ATT&CK のバージョンと ID

- 取り込んだ版は `knowledge/attack/version.json`（現在 Enterprise v20.0）。`pnpm attack:import` で最新版を取り込み直す
- 廃止（revoked）された ID は `enterprise.json` の `revokedBy` で置き換え先に対応づけてある。Claude が古い ID を返しても照合できる。知識ファイルには現行の ID を書く（例：なりすましは `T1656` ではなく `T1684.001`）
- 版を上げたら、`labels.ja.yaml` に新しい ID のラベルを足し、`pnpm knowledge:check` と `pnpm eval` を通す。戦術名の変更（v20 で防御回避 → 潜伏、防御の無力化の新設）はラベル側で吸収する

## 変更を出す前に

```bash
pnpm knowledge:check   # 知識ファイルとカルテの検証（JSON Schema も書き出す。差分はコミットに含める）
pnpm typecheck
pnpm lint              # Biome。pnpm lint:fix で整形
pnpm test              # Vitest（engine の判定はテストで固定してある。想定結果を変えるならテストも直す）
pnpm eval              # 記録データで採点し、eval/RESULTS.md に 1 行追記する。EVAL_NOTE="変更の要点" を付ける
pnpm exec biome check --write eval/RESULTS.md   # 追記した表の整形（Biome は Markdown の表も整形する）
pnpm secrets           # gitleaks（lefthook の pre-commit でも動く）
```

- 判定の結果が変わる変更（型紙・ルール・質問表）は、`pnpm eval` の点数と、架空の会社（`examples/demo-seiko.json`）での想定結果（事例 1：赤 → VPN の多要素認証は効かない → 装置の更新で止まる → 切り離したバックアップで抑えられる。事例 5：人次第 → 社長の多要素認証で止まる。事例 2：止まる）が崩れないことを確かめる。崩れるのが正しいなら、理由を PR に書く
- 新しい手法や記事の言い回しに対応したときは、`pnpm eval:articles`（実在の記事での読解。`--replay` なら Claude を呼ばない）も見る
- 秘密情報：`.env` と `.env.*` はコミットしない。会社の実在のカルテ、記事の全文、実在ドメインの外部確認の結果を Issue や PR に貼らない

## コミットと PR

- Conventional Commits（`feat(engine): …`、`fix(web): …`、`docs: …`、`knowledge: …`）。本文は日本語でよい。小さな単位でこまめに
- 1 つの PR では 1 つのことを。知見の変更は、出典（URL と確認日）と「なぜそう判定すべきか」を本文に書く
- Claude Code などの AI を使ったときは、コミットの末尾に `Co-Authored-By:` を残してよい（このリポジトリはそうしている）

## Issue の立て方

`.github/ISSUE_TEMPLATE/` の型を使う。

- **判定がおかしい**：どの事例（記録済みの事例の番号か、記事の URL）、どの会社カルテ（架空の会社か、5 問の回答か。実在のカルテは貼らない）、期待した結論と実際の結論、担当者画面の「根拠」に出た段階・手法・判定・理由
- **知見の追加**：型紙／ルール／質問／対策／期限のどれか、根拠となる公開資料（URL と確認日）、置き換えたい文言や条件
- **読解の誤り**：記事の URL（全文は貼らない）、Claude が返した段階と期待した段階、`clarity`（明確／一部推定／入口不明）

脆弱性や秘密情報の漏えいに関わる報告は、公開の Issue ではなく、リポジトリの Security 連絡先へ。
