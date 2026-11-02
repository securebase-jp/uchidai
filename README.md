# ウチダイ

**「その対策、この攻撃に効きますか？」に、根拠つきで答える道具。**

他社のサイバー被害の報道を見た社長に「うちは大丈夫？」と聞かれた中小企業の一人情シスが、記事を貼ると数分で「結論・根拠・次の一手」を返せるようにする。報道と同じ攻撃が自社の構成の上をどう進むかを図で再生し、「止められます」か「大丈夫ではありませんでした」かを示し、社長向けの一枚にまとめる。

ハッカソン「Built with Claude: Japan 2026」（2026-11-02〜11-08）の期間中にゼロから作っている。Securebase Inc. の OSS（MIT License）。

## 何ができるか

三つの層を一本の経路でつなぐ。

| 層           | 問い                   | 材料                                                        | 誰が決めるか                                        |
| ------------ | ---------------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| 攻撃の型     | 攻撃者は何をするか     | 報道記事、MITRE ATT&CK Enterprise                           | Claude が記事を読み、プログラムが手法 ID を照合する |
| 自社の守り   | その攻撃は自社で通るか | 外部確認（DNS・証明書の公開ログ）、会社カルテ、ベンダー回答 | プログラム（判定ルール表）                          |
| 経営への影響 | 通ったら何が起きるか   | 業務の数値、法令・実務上の期限、費用の目安                  | プログラム（固定データ）                            |

Claude がするのは「読む（記事・PDF）、言い換える（社長向け）、書く（確認依頼の文）、探す（AI攻撃者）」だけ。止まるかどうかの判定、日数と金額、期限はすべてプログラムが決定的に計算する。Claude の出力は zod で検証し、存在しない手法 ID や型紙にない手法は捨てる。記事の内容で結論を操作することはできない。

画面：担当者画面（経路の再生、根拠、対策ボタンで再判定、確認依頼と送信箱、AI攻撃者、知見なし AI との比較）、社長画面（専門用語なしの自動再生）、社長向けの一枚（印刷と共有リンク）。

## 動かし方

Node 22.18 以上と pnpm。

```bash
pnpm install
cp .env.example .env   # ANTHROPIC_API_KEY を自分のキーで埋める（無くても動く。下の「キー無しでできること」）
pnpm dev               # 画面 http://localhost:5173 と API（8787）
```

Docker（単一イメージ。特定のホスティング事業者の機能に依存しない）：

```bash
docker build -t uchidai .
docker run --rm -p 127.0.0.1:8787:8787 --env-file .env uchidai
```

http://localhost:8787 を開く。`-p 127.0.0.1:8787:8787` で手元だけに公開する（会社カルテを扱う API が外から見えないように）。環境変数の一覧と細かい手順は [docs/usage.md](docs/usage.md)。

## 使い方（5 段）

トップ画面（`#/`）がこの順に案内し、各段の「いまの状態」を出す。

1. **自社のドメインを外から見る**（任意、`#/domain`）：ドメインを入れてトークンを発行し、DNS に TXT レコード（名前 `@`、値 `uchidai-verify=<トークン>`）を追加して所有を確認する。確認できたドメインだけ、DNS の公開レコードと証明書の公開ログ（crt.sh）を参照し、VPN らしいホスト名、SPF・DMARC、メールやホームページの提供元の手がかりを集める。結果は 5 問の初期値（「外部から推定」の印つき）と、カルテの属性・矛盾になる。**対象のホストには一切アクセスしない**
2. **最初の5問に答える**（`#/questions`）：業種、現場、仕事の置き場所、社外からのつなぎ方、バックアップ。すべて選択式で、答えるたびに構成図の枠が組み上がる（「前の質問に戻る」で戻れる）。終わると担当者画面へ移り、この時点の会社名は「うちの会社」、対策はすべて「未確認」
3. **カルテの詳細を登録する**（`#/profile`）：会社名と人数、1 日の売上、復旧日数、個人情報の有無を入れ、構成要素ごとの対策の有無を「自分で答える」（1 問の選択式）か「ベンダーに聞く」（確認依頼）。先頭の「まず答えるとよい項目」は、いまの事例の経路で問われている未確認（入口に近い順）で、ここから答えると結論が変わりやすい。未確認は決して「止まる」とは扱わないので、未確認が残る間、結論は最悪の想定か「確認中」になる。カルテは JSON で書き出し・読み込みできる
4. **記事を貼る**（トップの手順 4）：報道記事の URL・本文・PDF を Claude が読み、攻撃の段階を ATT&CK の手法 ID に対応づける（記載／推定／不明と根拠文つき）。読んだ事例はこのブラウザに保存され、再読み込みしても残る。キーが無いサーバでは、IPA 事例集を読んだ記録済みの事例から選ぶ（何も選んでいない間は既定で事例 1 を使い、トップにその旨が出る）
5. **結論を見る**：担当者画面（`#/staff`）で経路の再生、各段階の判定と根拠、対策ボタン、確認依頼、業種を切り替えて同じ攻撃を見る一場面、AI攻撃者、知見なし比較。未確認が残るときは、結論が最悪の想定である旨と、経路で問われている未確認の件数が上部に出る。社長画面（`#/exec`）は 30〜40 秒の自動再生。社長向けの一枚（`#/onepager`）は印刷して PDF にでき、「共有リンクをコピー」で一枚の内容を圧縮して URL に載せたリンクができる（サーバには何も保存しない。社長のスマホで開ける。開いた側には作成時点の判定である旨と出所が出る。内容が URL に入るので社外に送るときは中身を確かめる）

確認依頼のデモ（ベンダー役のスマホで回答 → 判定がその場で更新）と、公開 URL（Cloudflare Tunnel）を使うときの注意は [docs/usage.md](docs/usage.md) に書いた。

## キー無しでできること

`ANTHROPIC_API_KEY` が無くても、記事の読解と文章の言い換え以外はすべて動く。

- 記録済みの事例（IPA 事例集 5 件を Claude が読んだ結果の記録）で、判定・経路の再生・対策ボタン・時間軸・一枚
- 外部確認、最初の5問、カルテの登録、確認依頼（依頼文はテンプレートで組む）、回答による判定の更新
- AI攻撃者と知見なし比較は記録の再生
- `pnpm eval`（評価は記録データで採点する）

## データの扱い

- **会社カルテはこのブラウザ（localStorage）にだけ保存する。** サーバには保存しない（判定のたびに API へ渡すが残さない）。カルテは「自社の弱点の地図」なので、書き出した JSON の扱いには注意する
- **Claude に送るのは、記事の本文と、判定結果のうち役割名と数値だけ。** 社名・製品名・バージョン・ホスト名は送らず、プログラム側でテンプレートに差し込む。記事は信頼できないデータとして指示文と分けて渡し、出力は検証する
- **外部に出る通信は 3 つだけ。** Claude API（記事と判定結果）、DNS（所有確認と公開レコード）、crt.sh（証明書の公開ログ。1 ドメイン 1 回、24 時間キャッシュ）。対象のホストにはつながない
- サーバが持つのは、確認依頼のトークンと回答（`apps/web/.data/`、git 管理外）と、所有確認のトークンだけ
- 公開 URL（`PUBLIC_BASE_URL`）経由の要求は、既定ではベンダーの回答ページの API だけに制限する

## 責任ある利用

- 外部確認の対象は、DNS の TXT レコードで所有を確認した自社ドメインだけ。DNS の公開レコードと証明書の公開ログだけを参照し、ポートスキャン、Web ページの取得、ログイン画面の確認、TLS 接続は一切行わない
- AI攻撃者は MITRE ATT&CK の手法の水準までしか扱わず、実在製品の攻撃手順・コマンド・コードは出力しない。外部通信やツール実行の権限を持たない
- 対象は ATT&CK Enterprise のみ。制御システム（ICS）は対象外
- 判定は型紙と判定ルール表の範囲に限る。記事に入口が書かれていないときは型紙の入口候補だけで判定し、別の入口から来る攻撃は含まれない（画面に注記を出す）
- デモで使う会社（デモ精工株式会社）とそのデータはすべて架空
- 実運用では、カルテの保存時の暗号化、限定されたアクセス権、操作記録を前提とする（本 MVP では未実装）

## 評価

```bash
pnpm eval              # 記録データで採点（API キー不要）。結果は eval/RESULTS.md に 1 行追記
pnpm eval --live       # Claude を呼んで記録を更新してから採点
pnpm eval:attacker     # AI攻撃者と知見なし比較
pnpm eval:articles     # 実在の報道記事での読解と型紙への対応づけ
```

観点は、段階の抽出、記載／推定の区別、手法 ID、根拠文、最終判定（[eval/README.md](eval/README.md)）。点数の推移は [eval/RESULTS.md](eval/RESULTS.md)。変更のたびに実行して記録する。

## 開発

```bash
pnpm typecheck && pnpm lint && pnpm test   # 型検査、Biome、Vitest
pnpm knowledge:check                        # 知識ファイルとカルテの検証、JSON Schema の書き出し
pnpm secrets                                # gitleaks（コミット前にも lefthook で実行）
pnpm attack:import                          # ATT&CK の再取り込み
```

知見（型紙、判定ルール、質問表、対策と費用、期限）の足し方は [CONTRIBUTING.md](CONTRIBUTING.md)。計画は [docs/development-plan.md](docs/development-plan.md)、Claude Code でどう進めたかの記録は [docs/claude-code-log.md](docs/claude-code-log.md)。

## デモ動画の作り方

`?profile=demo-seiko&demo=1` でデモモード（架空の会社で 9 場面が自動で進む）が動く。原稿、字幕、音声（VOICEVOX）、結合（ffmpeg）の手順は [demo/README.md](demo/README.md)。

## 出典

- MITRE ATT&CK® Enterprise v20.0: https://attack.mitre.org/ （利用規約と帰属表示は [NOTICE](NOTICE)。日本語ラベルは本プロジェクト独自の訳）
- IPA「中小企業のための実例で学ぶサイバーセキュリティリスク事例集」（2026年3月）: https://www.ipa.go.jp/security/reports/sme/rcu1hd0000009k82-att/sme-jirei.pdf — 本文は含めず、出典つきの短い抜粋と開発者自身の言葉での要約だけを置く。対策費用の目安は別紙「想定被害額計算明細」の単価（`knowledge/costs.yaml`）
- 個人情報保護委員会「個人情報の保護に関する法律についてのガイドライン（通則編）」「漏えい等の対応とお役立ち資料」：漏えい等報告の期限と対象（`knowledge/deadlines.yaml` に確認日と URL）
- 警察庁「サイバー空間をめぐる脅威の情勢等について」：入口候補の並び順の根拠（`knowledge/entry-candidates.yaml`）。警視庁「ビジネスメール詐欺（BEC）対策」：送金後の実務上の期限
- crt.sh（Sectigo Limited）：証明書の公開ログ（CT）の検索。1 ドメイン 1 回の取得と結果のキャッシュに限る（[packages/recon/README.md](packages/recon/README.md)）
- CISA Known Exploited Vulnerabilities Catalog：悪用確認済み脆弱性の突き合わせ

## ライセンス

MIT License（[LICENSE](LICENSE)）。外部データとフォントは各提供元の規約に従う（[NOTICE](NOTICE)）。行動規範は [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

---

English summary: _Uchidai_ helps a one-person IT team at a small company answer the CEO's question "Are we safe?" after a cyber-incident in the news. Claude reads the article and maps it to MITRE ATT&CK; a deterministic rule engine replays the same attack path over the company's own architecture graph, says whether each step is stopped (with evidence), and translates the outcome into business impact and legal deadlines, ending in a one-page summary for the CEO that can be shared as a self-contained link. The company profile never leaves the browser; only the article and role-level results go to Claude. Built from scratch during Built with Claude: Japan 2026.
