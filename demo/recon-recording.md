# 場面 4「自社の姿」：外部確認の記録と再生

デモの場面 4（`docs/demo-script-v2.md`）は、開発者が所有する実ドメイン **demo-sec.com** を、DNS の公開レコードと証明書の公開ログ（CT）だけで外から見た結果の**記録**を再生して見せる。録画のたびに問い合わせるのではなく、**一度だけ実際に外部確認した結果**を `demo/recordings/recon.demo-sec.json` に残し、画面（`ReconReplay`）はそれを再生する。再生は実際のネットワークに一切出ない（毎回同じ映像になる）。

## 記録に入っているもの

| 場所                     | 中身                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `note`                   | 「実際の外部確認の記録。DNS の公開レコードと証明書の公開ログだけを参照。対象のホストにはアクセスしていない。リクエストヘッダは保存していない」          |
| `recordedAt`             | 記録した日時（UTC）。画面の札「実際に外から見た記録（記録日 …、demo-sec.com）」は、ここから日本時間の日付を出す                                         |
| `provenance`             | DNS は実際の参照（`live`）、証明書の公開ログは Cert Spotter のキャッシュ（`cachedAt`、`queriedNow: false`）、置き換えたもの（`redactions`）             |
| `run`                    | `/api/recon/run` の `RunView` 相当：確認項目 7 件、ホスト名 4 件（証明書 4 件）、VPN 用ホスト、SPF・DMARC・メールの提供元、`answersHints`、`assetHints` |
| `applied.contradictions` | カルテ（架空のデモ精工 `examples/demo-seiko.json`）に反映したときの矛盾。廃止済みの旧キャンペーンサイト `campaign2019.demo-sec.com` が外部に残っている  |
| `applied.changes`        | 反映の差分（属性の上書きと追加、ドメインの付け替え）。実ドメインへの付け替えは recon の `mapHostname`（`findContradictions` の中）が行った              |

反映後のカルテそのものは入れない。**実際に得た値は手で書き換えていない。** 変えているのは次の 2 つだけ。

- **IP アドレス**：公開リポジトリに載るので、文書用の予約範囲（203.0.113.0/24、IPv6 は 2001:db8::/32）以外は、同じ値が同じ置き換え先になるよう機械的に置き換える。今回の記録では、DNS が返した IP がもともと文書用の予約範囲（203.0.113.x）だったため、置き換えは 0 件
- **所有確認のトークン**：`ownership.record` は `uchidai-verify=（記録では省略）` にする

形の検証は `apps/web/src/shared/reconRecording.ts`（zod）。記録のスクリプトは、書き出す前に recon の `ReconResult` と記録の schema の両方で検証し、予約範囲以外の IP とトークンが残っていれば**書き出さずに止まる**。

## 記録のやり方（11/8 の録画の前、必要なとき）

外部に出るのは demo-sec.com の **DNS の公開レコードの参照だけ**。対象のホストにはつながない。`.env` は読まず、Cloudflare の API トークンも使わない（DNS の変更はしない）。

1. **証明書の公開ログのキャッシュを確かめる。** Cert Spotter の応答が `packages/recon/.cache/` に 24 時間残る（キー `certspotter:demo-sec.com`）。**Cert Spotter は認証なしだと 1 時間 10 回まで**なので、新しくは問い合わせない。スクリプトは、キャッシュが無い・切れているときは、何もせずに止まる（終了コード 2）。
2. **所有確認はスクリプトがやり直す。** 所有確認は 24 時間で失効し、サーバのメモリにしか残らない。スクリプトが `apps/web/.data/recon-tokens.json` のトークンで、DNS の TXT（`uchidai-verify=…`）を実際に確かめる。トークンがファイルに無い場合は、画面の外部確認（`#/domain`）で発行し、TXT を DNS に入れてから再実行する。
3. **記録する。** DNS はサンドボックスの外で解決する（Claude Code から実行するなら `dangerouslyDisableSandbox: true`）。

   ```bash
   node --disable-warning=ExperimentalWarning demo/scripts/record-recon.ts
   ```

   出力の例：`証明書の公開ログ：キャッシュを使う（取得 …、6.5 時間前）` → `所有確認 ✓` → `書き出しました：demo/recordings/recon.demo-sec.json`。
4. 書き出したら `pnpm lint:fix`、`pnpm test` を通す（記録の形、IP、再生の段階のテストが走る）。

### 再記録の注意

- **キャッシュが切れたら**、再記録の前に Cert Spotter の応答を取り直す必要がある。取り直しは `/api/recon/run` を 1 回実行する形（画面の外部確認）で、1 時間 10 回の枠を使う。他のセッションも同じ枠を使うので、直近の使用回数を考えて、**やるなら 1 回だけ**。取り直せないときは、いまの記録をそのまま使う（記録はコミット済みなので、再生には影響しない）
- crt.sh は demo-sec.com の証明書を載せていない（空か 502 か時間切れ）ので、実際の参照では Cert Spotter が予備に使われる。記録のスクリプトは crt.sh には問い合わせない（`CertSpotterSource` に、ネットワークに出ない `fetch` を渡し、キャッシュにあるものだけを読む）
- DNS の状態が変わっていると、記録の中身が変わる（VPN 用ホスト `vpn.demo-sec.com`、DMARC なし、`campaign2019.demo-sec.com` が残っていること）。変わったら場面 4 の原稿と合わなくなるので、PM に知らせる
- 記録は `git diff` で内容を確かめてからコミットする

## 再生の仕組み

- 部品：`apps/web/src/client/components/ReconReplay.tsx`。時刻と中身の決め方は `apps/web/src/client/lib/reconReplay.ts`（純粋な関数）
- **描きは `elapsed`（場面の開始からの秒数）だけで決まる。** `useEffect`・タイマー・`fetch` は使わない。一時停止すれば止まり、再開すれば続きから進む。場面の長さ `seconds` が 14 秒でなければ、経過を 14 秒に引き伸ばして使う
- 時刻表（14 秒の時計）：0.4〜2.4 秒 ドメインを打つ → 2.8 秒 所有確認 → 4.2 秒 ✓ → 5.0／6.6／8.2 秒 結果が 1 つずつ（①VPN 用のホスト名 `vpn.demo-sec.com`、②DMARC なし、③廃止したはずの旧キャンペーンサイトの証明書が、まだ残っている＝カルテとの食い違い）→ 10.2 秒 ほかの確認（SPF、メールの提供元、証明書の公開ログ）→ 14 秒まで保つ。時刻は `REPLAY_AT`
- 「対象のホストにはアクセスしません」を最初から最後まで大きく、「実際に外から見た記録（記録日 …、demo-sec.com）」の札を出す
- 行の見た目は外部確認の画面（`ReconResultView`）と同じ部品を使う：`.chk-*` のスタイル（`flow.css`）、`CheckIcon`（`ReconResultView.tsx` から export した）、`SourceRef`。新しいのは枠の見出しと札（`ReconReplay.css`）だけ
- 記録の JSON はビルドに取り込む（`import`）。読み込み時に zod で検証するので、形が違えば画面を開いた時点で分かる

## `slot:recon` へのつなぎ方（PM が行う）

差し込み口の形 `{ elapsed: number; seconds: number }` に合わせてある。

```tsx
// apps/web/src/client/demo/slots.tsx
import { ReconReplaySlot } from "../components/ReconReplay.tsx";

SLOTS["slot:recon"] = ReconReplaySlot; // (props: SlotProps) => ReactNode と同じ形
```

- `ReconReplaySlot` は全画面の枠 `<div className="demo-slot full">` の中に `ReconReplay` を描く。ほかのスロットと同じ作り。枠を自分で持ちたいときは `ReconReplay`（`{ elapsed, seconds, recording? }`）を直接使う
- `recording` を渡すと記録を差し替えられる（テスト用。既定は `demo/recordings/recon.demo-sec.json`）
- `SLOT_TITLE` に `"slot:recon"` の見出しを足すのは `slots.tsx` 側（この変更では触れていない）
- 画面は 1120px 幅に収めてある。字は動画で読めるよう大きめ（見出し 38px、結果 22px）

## 確認の仕方

- `pnpm --filter @uchidai/web exec vitest run src/client/components/ReconReplay.test.tsx`：記録の形・IP・段階・DOM
- 見た目：内蔵ブラウザで、`ReconReplay` を `elapsed` を動かしながら描く仮のページ（コミットしない）で、0 / 1.4 / 3.5 / 5.6 / 8.8 / 12 秒を確かめた
