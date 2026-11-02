# ウチダイ

「うちは大丈夫？」に、根拠つきで答える道具。

他社のサイバー被害の報道を見た社長に「うちは大丈夫？」と聞かれた中小企業の一人情シスが、数分で「結論・根拠・次の一手」を返せるようにする。報道と同じ攻撃が自社の構成をどう進むかを図で再生し、「止められます」か「大丈夫ではありませんでした」かを示す。一言で言えば **「その対策、この攻撃に効きますか？」に答える道具**。

ハッカソン「Built with Claude: Japan 2026」（2026-11-02〜11-08）の期間中にゼロから作っている。

## 状態

- [x] 評価の仕組みの骨組み（`eval/`）← 最初のコミット
- [x] ATT&CK Enterprise v20.0 の取り込み（`knowledge/attack/`）、役割の枠（`knowledge/roles.yaml`）、日本語ラベル、共通の型（`packages/engine/src/types.ts`）、デモ用の架空企業（`examples/demo-seiko.json`）
- [ ] 記事の読解と手法IDの照合
- [x] 構成グラフ、型紙 3 つ、判定ルール表（条件式 DSL）、経路探索、対策ボタンの再判定、AI 経路の検証、知見なし比較の振り分け（`packages/engine`、`knowledge/`）
- [ ] 経路図とアニメーション
- [ ] 確認依頼と判定の更新、対策ボタン
- [ ] AI攻撃者と知見なしAIとの比較
- [ ] 経営への影響、社長向けの一枚
- [ ] デモモード

計画は [docs/development-plan.md](docs/development-plan.md)、Claude Code での進め方の記録は `docs/claude-code-log.md`（作成予定）。

## 使い方（準備中）

```bash
pnpm install
cp .env.example .env   # ANTHROPIC_API_KEY を自分のキーで埋める
pnpm eval              # 評価（API キー不要）
pnpm knowledge:check   # 知識ファイルとカルテの検証
pnpm attack:import     # ATT&CK の再取り込み（最新版）
```

## 責任ある利用

- 外部確認の対象は、DNS の TXT レコードで所有を確認した自社ドメインだけ。DNS の公開レコードと証明書の公開ログだけを参照し、対象ホストへの直接アクセス（ポートスキャン、Web ページの取得を含む）は一切行わない
- AI攻撃者は MITRE ATT&CK の手法の水準までしか扱わず、実在製品の攻撃手順・コマンド・コードは出力しない。外部通信やツール実行の権限を持たない
- 対象は ATT&CK Enterprise のみ。制御システム（ICS）は対象外
- デモで使う会社（デモ精工株式会社）とそのデータはすべて架空
- 会社カルテは「自社の弱点の地図」であり、利用者の手元にだけ保存する。実運用では保存時の暗号化、限定されたアクセス権、操作記録を前提とする（本MVPでは未実装）

## 出典

- MITRE ATT&CK®: https://attack.mitre.org/ （利用規約と帰属表示は `NOTICE` に記載予定）
- IPA「中小企業のための実例で学ぶサイバーセキュリティリスク事例集」（2026年3月）: https://www.ipa.go.jp/security/reports/sme/rcu1hd0000009k82-att/sme-jirei.pdf — 本文は含めず、出典つきの抜粋と開発者自身の言葉での要約だけを置く

## ライセンス

MIT License。外部データは各提供元の規約に従う（`NOTICE`）。

---

English summary: _Uchidai_ helps a one-person IT team at a small company answer the CEO's question "Are we safe?" after a cyber-incident in the news. Claude reads the article and maps it to MITRE ATT&CK; a deterministic rule engine replays the same attack path over the company's own architecture graph, says whether each step is stopped (with evidence), and translates the outcome into business impact and legal deadlines. Built from scratch during Built with Claude: Japan 2026.
