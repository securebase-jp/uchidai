# ウチダイ

「うちは大丈夫？」に、根拠つきで答える道具。

他社のサイバー被害の報道を見た社長に「うちは大丈夫？」と聞かれた中小企業の一人情シスが、数分で「結論・根拠・次の一手」を返せるようにする。報道と同じ攻撃が自社の構成をどう進むかを図で再生し、「止められます」か「大丈夫ではありませんでした」かを示す。一言で言えば **「その対策、この攻撃に効きますか？」に答える道具**。

ハッカソン「Built with Claude: Japan 2026」（2026-11-02〜11-08）の期間中にゼロから作っている。

## 状態

- [x] 評価の仕組みの骨組み（`eval/`）← 最初のコミット
- [x] ATT&CK Enterprise v20.0 の取り込み（`knowledge/attack/`）、役割の枠（`knowledge/roles.yaml`）、日本語ラベル、共通の型（`packages/engine/src/types.ts`）、デモ用の架空企業（`examples/demo-seiko.json`）
- [x] 記事の読解と手法IDの照合（`packages/llm`：URL・PDF・テキストの取り込み、構造化出力、ID・根拠文・型紙外・指示文の検証）。評価は 5 事例 × 知見あり／なしで実測を記録
- [x] 構成グラフ、型紙 3 つ、判定ルール表（条件式 DSL）、経路探索、対策ボタンの再判定、AI 経路の検証、知見なし比較の振り分け（`packages/engine`、`knowledge/`）
- [x] 経路図とアニメーション、最初の5問、自動レイアウト、担当者画面・社長画面、黒背景と攻撃者ログ（`apps/web`）
- [x] 確認依頼と判定の更新（1 問選択式の確認依頼、送信箱と `mailto:`／SMTP、スマホ向け回答ページ、SSE による判定の更新。`apps/web/src/server/routes/requests.ts`、`packages/llm/src/writer.ts`）
- [x] AI攻撃者（抽象化カルテ、4 点検証、記録の再生）と知見なしAIとの比較（効く／効かない／経路の外）
- [x] 経営への影響（業務波及、時間軸、法令・実務上の期限、費用の目安）と社長向けの一枚のデータ（`packages/engine`）。一枚の描画は未実装
- [x] 外部確認（所有確認、DNS、CT ログ、fixture、矛盾検出。`packages/recon`）。画面との接続は未実装
- [x] デモモード（`?demo=1`）、社長向けの一枚（`#/onepager`）、ナレーション原稿と字幕・音声・結合のスクリプト。作り方は [demo/README.md](demo/README.md)

計画は [docs/development-plan.md](docs/development-plan.md)、Claude Code での進め方の記録は `docs/claude-code-log.md`（作成予定）。

## 使い方（準備中）

```bash
pnpm install
cp .env.example .env   # ANTHROPIC_API_KEY を自分のキーで埋める
pnpm dev               # 画面（5173）と API（8787）。?profile=demo-seiko で架空企業
pnpm eval              # 評価（API キー不要）
pnpm knowledge:check   # 知識ファイルとカルテの検証
pnpm attack:import     # ATT&CK の再取り込み（最新版）
```

## ベンダー回答のデモ（確認依頼 → スマホで回答 → 判定が更新される）

担当者画面の「ベンダーへの確認依頼」で未確認の項目を選ぶと、1 問だけの選択式の確認依頼が作られ、送信箱に件名・本文・回答リンクが出る。ベンダーが回答リンクを開いて答えると、担当者画面の判定がその場で更新される（根拠：ベンダー回答、誰がいつ答えたかを記録）。依頼文は `ANTHROPIC_API_KEY` があれば Claude が書き、無ければテンプレートで組み立てる（どちらでも動く）。

**送信の仕組み（差し替え可能）**：既定は「送信箱に積む＋メールソフトで開く `mailto:` リンク」で、実際には送らない。`.env` に `SMTP_URL`（例 `smtp://user:pass@smtp.example.com:587`）と `MAIL_FROM` を設定すると nodemailer で送る（失敗しても送信箱に理由が残る）。サーバが持つのは依頼のトークンと回答だけ（`apps/web/.data/requests.json`、git 管理外）。会社カルテは送らない。

**スマホから回答リンクを開く手順（Cloudflare Tunnel）**：回答リンクは `PUBLIC_BASE_URL` を土台に作るので、手元のサーバを一時的に公開して、その URL を指定する。

```bash
# 1. 別のターミナルで手元の画面（5173）を公開し、表示される https://xxxx.trycloudflare.com を控える
cloudflared tunnel --url http://localhost:5173
```

```bash
# 2. 公開 URL を回答リンクの土台にして起動（.env に書いてもよい）
PUBLIC_BASE_URL=https://xxxx.trycloudflare.com pnpm dev
```

3. ブラウザで `http://localhost:5173/?profile=demo-seiko#/staff` を開き、「管理者アカウント　M1026 特権アカウント管理」の「ベンダーに確認する」を押す
4. 送信箱の「メールソフトで開く」でベンダー役のスマホ宛てにメールを送る（送信箱の回答リンクを直接スマホで開いてもよい）
5. スマホで回答リンクを開き、「全 PC で共通」とお名前を入れて送る。担当者画面に「回答が届きました」と出て、判定が更新される。同じ手順で M1040（EDR）に「入っていない」と答えると、管理者権限の段階が黄から赤に変わる

公開 URL は一時的なもので、トンネルを止めれば無効になる。デモが終わったら `cloudflared` を止め、`apps/web/.data/requests.json` を消せば依頼と回答も消える。録画の直前には、担当者画面の送信箱の「送信箱を空にする」ボタン（または `curl -X DELETE http://localhost:5173/api/requests`）で空にする。サーバはメモリにも依頼を持つので、ファイルを消すだけでは、サーバを再起動するまで残る。

公開 URL 経由（転送ヘッダつき）の要求は、既定では回答ページの API（`/api/requests/:token` と回答の送信）だけに制限する。他の API（会社カルテを扱うもの）を公開 URL から使うのは `UCHIDAI_ALLOW_REMOTE_API=1` を設定したときだけで、デモ以外では設定しない。CORS も手元の localhost と `PUBLIC_BASE_URL` だけに許す。

## Docker で動かす

特定のホスティング事業者の独自機能には依存しない単一イメージです。API キーはイメージに入れず、実行時に渡します（`.env` は `.dockerignore` で除外済み）。

```bash
docker build -t uchidai .
docker run --rm -p 127.0.0.1:8787:8787 --env-file .env uchidai
```

http://localhost:8787/?profile=demo-seiko を開きます。`-p 127.0.0.1:8787:8787` で手元だけに公開してください（会社カルテを扱う API が外から見えないように）。キー無しでも、記録済みの事例・AI攻撃者の記録・比較の記録で動きます。確認依頼の保存先を残すなら `-v uchidai-data:/app/apps/web/.data` を足します。

## 責任ある利用

- 外部確認の対象は、DNS の TXT レコードで所有を確認した自社ドメインだけ。DNS の公開レコードと証明書の公開ログだけを参照し、対象ホストへの直接アクセス（ポートスキャン、Web ページの取得を含む）は一切行わない
- AI攻撃者は MITRE ATT&CK の手法の水準までしか扱わず、実在製品の攻撃手順・コマンド・コードは出力しない。外部通信やツール実行の権限を持たない
- 対象は ATT&CK Enterprise のみ。制御システム（ICS）は対象外
- デモで使う会社（デモ精工株式会社）とそのデータはすべて架空
- 会社カルテは「自社の弱点の地図」であり、利用者の手元にだけ保存する。実運用では保存時の暗号化、限定されたアクセス権、操作記録を前提とする（本MVPでは未実装）

## 出典

- MITRE ATT&CK® Enterprise v20.0: https://attack.mitre.org/ （利用規約と帰属表示は `NOTICE` に記載。日本語ラベルは本プロジェクト独自の訳）
- IPA「中小企業のための実例で学ぶサイバーセキュリティリスク事例集」（2026年3月）: https://www.ipa.go.jp/security/reports/sme/rcu1hd0000009k82-att/sme-jirei.pdf — 本文は含めず、出典つきの抜粋と開発者自身の言葉での要約だけを置く。対策費用の目安は別紙「想定被害額計算明細」の単価（`knowledge/costs.yaml`）
- 個人情報保護委員会「個人情報の保護に関する法律についてのガイドライン（通則編）」：漏えい等報告の期限と対象（`knowledge/deadlines.yaml` に確認日と URL）
- 警察庁「サイバー空間をめぐる脅威の情勢等について」：入口候補の並び順の根拠（`knowledge/entry-candidates.yaml`）
- crt.sh（Sectigo Limited）：証明書の公開ログ（CT）の検索。1 ドメイン 1 回の取得と結果のキャッシュに限る（`packages/recon/README.md`）
- CISA Known Exploited Vulnerabilities Catalog：悪用確認済み脆弱性の突き合わせ

## ライセンス

MIT License。外部データは各提供元の規約に従う（`NOTICE`）。

---

English summary: _Uchidai_ helps a one-person IT team at a small company answer the CEO's question "Are we safe?" after a cyber-incident in the news. Claude reads the article and maps it to MITRE ATT&CK; a deterministic rule engine replays the same attack path over the company's own architecture graph, says whether each step is stopped (with evidence), and translates the outcome into business impact and legal deadlines. Built from scratch during Built with Claude: Japan 2026.
