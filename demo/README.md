# デモ動画の作り方

3 分のデモ動画は、アプリ自身にデモを上演させる「デモモード」を画面収録し、ナレーション音声・字幕・効果音を結合して作る。
脚本は `docs/hackathon/demo-script-v2.md`（11 場面）。原稿・操作・音声・映像は一つのタイムライン（`demo/out/timeline.json`）でつながる。

```
demo/
  narration.json      ナレーション原稿（11 場面：読み上げ文、字幕、秒数、先頭の無音、画面で起きること、クレジット）
  storyboard.json     絵コンテ（場面ごとの画面の操作 actions と、見た目だけの演出 layers。デモモードがこの順に進める）
  endcard-facts.json  エンドカード後半に出す開発の跡の数字（約 40 セッション、採点の推移、実際の報道記事での検証、コミット数）
  sfx.json            効果音の指定（demo-sfx-assemble が担当）
  scripts/
    build-subtitles.ts  原稿 → 字幕（SRT / VTT）とタイムライン JSON
    synth-voicevox.ts   VOICEVOX（ローカル）で場面ごとの WAV を生成し、長さを audio/durations.json に書く
    synth-sfx.ts        効果音の合成（demo-sfx-assemble が担当）
    assemble.ts         録画 + 音声 + 効果音 + 字幕 を ffmpeg で 1 本の MP4 に（demo-sfx-assemble が担当）
    record-recon.ts     場面 4 用の外部確認の記録（demo-recon-record が担当。つなぎは済み）
    record-vendor-request.ts  場面 5 用のベンダー確認依頼の記録（Claude で一度だけ生成）
    record-onepager.ts  場面 9 用の社長向けの一枚の記録（Claude の言い換えつきで一度だけ生成。--check で照合）
    lib.ts              共通部分（依存なし）
  recordings/         場面 4 の外部確認の記録（demo-recon-record が担当。つなぎは済み）
  audio/              生成した音声（git 管理外）
  capture/            画面収録（git 管理外）
  out/                字幕・タイムライン・完成動画（git 管理外）
```

`demo/sfx.json`、`demo/scripts/synth-sfx.ts`、`demo/scripts/assemble.ts` は demo-sfx-assemble、`demo/recordings/`・`apps/web/src/client/components/ReconReplay.tsx`・`demo/scripts/record-recon.ts` は demo-recon-record が担当する。このセッションの作業（原稿・絵コンテ・デモモードの演出）では触らない。

## 手順

1. **原稿を確認する** `demo/narration.json`。読み上げ文（`textJa`）では ATT&CK を「国際的な攻撃手法の分類」と言い、英字は読み方（クロード、エーアイ、フェイブル、ソネット、ブイピーエヌ）で書く。字幕（`subtitleJa`）には正式表記（Claude、AI、Fable、Sonnet、VPN）を残す。モデルの役割分担に Mythos の名は出さない
2. **音声を作る**（任意）

   ```bash
   node demo/scripts/synth-voicevox.ts            # 既定：四国めたん（ノーマル）、http://localhost:50021
   node demo/scripts/synth-voicevox.ts --list     # 話者と style の一覧
   node demo/scripts/synth-voicevox.ts --name ずんだもん --style ノーマル --speed 1.05 --scene 4
   ```

   エンジンが無ければ手順を表示して終了する。音声が無くてもデモモードは原稿の秒数で進む。
   - 場面ごとに、読み上げが `targetSeconds` に満たなければ末尾を無音で伸ばす（場面の長さと、絵コンテの操作の時刻がそろう。`--no-pad` で外す）。長ければ場面が伸びるので、警告に従って `--speed` を上げるか原稿を詰める（場面 6 は 1 秒あたり 5.7 字で、いちばん速い）
   - 場面 7 の `leadSilenceSeconds: 2` は、音声の先頭の無音として入る（VOICEVOX の `prePhonemeLength`）。字幕の cue もその分あとから始まる
3. **字幕とタイムラインを作る** `node demo/scripts/build-subtitles.ts` → `demo/out/narration.srt`（YouTube にアップロードできる）、`narration.vtt`、`timeline.json`。音声があればその長さで cue を切る
4. **エンドカードの数字を数え直す** `demo/endcard-facts.json`（`verifyBeforeRecording: true` のあいだは暫定）。数え方は同ファイルの `$comment`。数え直したら `measuredAt` を更新し、`verifyBeforeRecording` を `false` にする
   5-a. **自動で録画する（画面収録の許可が要らない方法）**：`pnpm dev` を起動したまま、次を実行する。ヘッドレスの Chromium（Playwright のものが `~/Library/Caches/ms-playwright` にあれば使える）でデモを実時間で動かし、1920×1080・30fps の `demo/capture/screen.mp4`（映像のみ）を作る。開始ボタンを押した時刻を 0 秒とするので、音声・効果音と時刻がそろう。字幕を画面に焼き込むときは URL に `&captions=1` を付ける

   ```bash
   node demo/scripts/record-screen.ts --seconds 183 \
     --url "http://localhost:5173/?profile=demo-seiko&demo=1&controls=0&captions=1&autostart=0"
   ```

   音声合成のエンジン（VOICEVOX）はローカルの 50021 番で動かす。読み上げの読みは、`/accent_phrases` で確かめられる（「十日」は「トオカ」と読まれるので、原稿の読み上げ用は「じゅうにち」と書く）。結合の最後に、全体の音量を -16 LUFS（ピーク -1.5 dB）にそろえる
5. **デモモードを録画する**：`pnpm dev` で起動し、ブラウザを 1920×1080・ダークテーマ（既定）にして次の URL を開き、画面収録（macOS は Shift+Cmd+5、60fps）を始めてから「開始」を押す

   ```
   http://localhost:5173/?profile=demo-seiko&demo=1&controls=0
   ```

   録画用の URL には `&controls=0` を付ける（画面下の操作バーと「一時停止中」の札を出さない。キー操作はそのまま使える）
   - `&scene=4` 場面 4 から　`&autostart=1` クリックなしで開始（音声の自動再生はブラウザの制限でクリックが要る）
   - `&captions=1` 画面に字幕を出す（焼き込みの代わり）　`&hud=1` 右上に場面と時刻
   - `&police=1|0` 場面 3 の警察庁の数字の小さな表示を出す／出さない（指定がなければ `storyboard.json` の `options.policeStat`。既定は出さない）
   - キー：Space 一時停止／再開、→ 次の場面、← 前の場面、H 右上の表示、C 字幕
   - **操作バー**：再生中、画面中央の下に「前の場面」「一時停止／再開」「次の場面」と場面の番号を出す。マウスが 2 秒動かないと自動で隠れ、動かすか Space・矢印・Tab で出る。人が見ながら試すときのための部品で、録画では `&controls=0` で消す
   - 音声ファイル（`demo/audio/<n>.wav`）があれば場面ごとに同期して鳴らし、場面の長さは音声の長さになる
   - 録画は毎回同じ映像になる（デモモードは前回の回答・下見・送信箱の残りを引きずらない。ベンダー確認も記録から出し、サーバの送信箱には触れない）
6. **結合する**（効果音を含む。`demo/sfx.json` の `strong: true` の cue（「効かない」「赤に変わる」、冒頭の数字）は、ナレーションの発話中も下げず大きく鳴らす。`mutes` の区間（冒頭の 4 秒の最後の 0.5 秒、結論の直前の 0.8 秒）は全部の音を切る。`demo/sfx.json` と `assemble.ts` は demo-sfx-assemble が担当）

   ```bash
   node demo/scripts/assemble.ts --video demo/capture/screen.mov [--title demo/capture/title.png] [--font "BIZ UDPGothic"]
   ```

   字幕は、録画時の `?captions=1` で画面に出したものを使う。libass の無い ffmpeg では、字幕トラック（mov_text）は `--soft-subtitles` を付けたときだけ埋め込む（画面の字幕とトラックの字幕が再生ソフトで重なって見えるため。11/5 に「字幕が何重にも重なる」と指摘があった）。

   ```bash
   # （字幕トラックが要るときだけ）
   node demo/scripts/assemble.ts --video demo/capture/screen.mp4 --soft-subtitles
   ```

   出力は `demo/out/uchidai-demo.mp4`（1920×1080・60fps・H.264/AAC）。エンドカードは場面 10・11 として録画に含まれる。
   字幕の焼き込みには libass つきの ffmpeg（`subtitles` フィルタ）が要る。手元の Homebrew の ffmpeg 9.0.2 には無かったため、その場合は録画時の `&captions=1` で画面に出した字幕を使い、字幕トラックは `--soft-subtitles` のときだけ埋め込む。`--no-subtitles`、`--no-audio`、`--dry-run`（コマンドを表示するだけ）がある

## 場面の表（11 場面・180 秒）

読み上げの目安は 1 分あたり 300〜350 字。3 分で 750 字前後が上限。`build-subtitles.ts` が文字数（空白と記号を除く）の表を出す。

| 場面 | 題                         | 文字数 |  秒 | 画面（overlay と、いま実装されている演出）                                                                                              |
| ---- | -------------------------- | -----: | --: | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 社長の一言                 |     41 |  15 | 冒頭の 4 秒（`cold-open`：暗転 → 赤い線が図を走る → 業務停止の日数と売上影響 → 無音 0.5 秒。読み上げなし）→ チャット（`chat-boss`）。帯 |
| 2    | 答えられない担当者         |     54 |  15 | チャット（`chat-staff`）。最後の 3 秒に暗く沈み、壁 3 枚が順に立つ。白い字「大企業には、専門チームがいる。この人には、いない。」        |
| 3    | ウチダイ登場・リンクを貼る |     84 |  18 | 暗転 → 宣言（`declaration`）→ 記事のリンク（`reading`）。壁「専門知識」が崩れる。警察庁の数字は入切式（既定は出さない）                 |
| 4    | 自社の姿                   |     65 |  14 | 前半 9 秒：外部確認の記録の再生（`slot:recon`）。後半 5 秒：最初の 5 問で図が組み上がる（`build`）                                      |
| 5    | 攻撃の再生とベンダー確認   |    120 |  26 | 担当者画面の再生（×1.5、破られた場所ごとに寄る）→ 「ベンダーに確認する」→ 番号つきメール → 返事の番号を入力 → 黄が赤（`slot:request`）  |
| 6    | AI 攻撃者                  |     68 |  12 | 下見の記録（`slot:attacker`）。札「実際の出力の記録」、「採用 3・破棄 0」「検証 ✓ ✓ ✓ ✓」、点線の新しい入口、注記                       |
| 7    | 結論                       |     62 |  15 | 2 秒の暗転 → 結論（`conclusion`、売上を数え上げる）→ 時間軸。隅に注記と「デモ精工（架空）」                                             |
| 8    | 一手で変わる               |     83 |  20 | 多要素認証（弾かれる）→ 装置の更新（止まり、結論が反転）→ 一般的な AI との左右の並置（`slot:comparison`）。壁「相談相手と予算」が崩れる |
| 9    | 社長への回答               |     47 |  13 | カーソルで「AI で一枚を作る」→ 一枚（記録。結論 1.5 秒 → 止まる業務 → 対策に寄る）→ チャット（`chat-reply`）→ 「じゃあ、それやろう」    |
| 10   | Claude の使い方と作り方    |     91 |  24 | エンドカード前半（`endcard-roles`、12 秒：使い道・検証・プログラム）→ 後半（`endcard-trace`、12 秒：Claude Code の跡）                  |
| 11   | 続けて使う・締め           |     31 |   8 | エンドカード（`endcard-close`）。最後の 2 秒はロゴと一行だけ                                                                            |
| 合計 |                            |    746 | 180 |                                                                                                                                         |

音声を作ると各場面の長さは音声の長さに置き換わる（`demo/audio/durations.json`。目安に満たない音声は末尾を無音で伸ばすので、通常は目安どおり）。場面の操作の時刻（`storyboard.json` の `at`）は秒で固定。原稿を変えたら目安秒数も合わせる。

## 絵コンテの書き方（`storyboard.json`）

場面ごとに `route`（画面）、`overlay`（全面に重ねる演出の初期値）、`actions`（時刻つきの操作）、`layers`（時刻つきの見た目）を持つ。部品の時刻は、overlay が出た時刻（場面の最初か、`overlay` 操作の `at`）を 0 とする。

- **actions**（画面の状態を変える）：`route`、`overlay`、`clock`（再生時計：`play`/`pause`/`toEnd`/`restart`/`speed`）、`measures`、`answers`、`reset`、`scroll`（`block: "start"` で上端に寄せる）、`click`（セレクタの要素を実際に押し、押した場所に輪を出す。`nth`、`text` で絞る）、`fill`（入力欄に値を入れる）。場面 5 のベンダー確認は、`click`／`fill` で本物の送信箱の部品（「ベンダーに確認する」→ 本文を見る → 返信を入力する → 番号 1 → 名前 → 「この回答で判定を更新する」）を動かし、実際の返信 API で判定を更新する
- **layers**（状態を持たない見た目）：`dim`（暗転・沈み）、`text`（帯 `band`、宣言、注記。位置と大きさを選べる）、`badge`（札：`fiction` は「架空」、`record` は「実際の記録」）、`walls`（3 枚の壁：`expert`・`advisor`・`time`。`big` は中央、`strip` は下の小さな帯。`rise` で立ち、`crumble` で崩れ、`fallen` は崩れた状態から始まる）、`zoom`（担当者画面の構成図をノードに寄せる。`target` は構成図のノード ID、`scale` は倍率）。層は `from`〜`to` 秒で表示され、一時停止すると止まり、場面を飛ばしても同じ絵になる
- **cursor**（場面ごと）：`true` の場面では、見えるカーソルが `click`／`fill`／`tap` の 0.6 秒前に押す場所へ動き、押すと 2 重の波紋が出る（録画用の演出。場面 3・5・9）。`tap` は押す動きだけを見せ、要素は押さない（演出の画面の「URL を貼る」など）
- **spot**（層）：構成図以外の要素に寄せる。`container`（拡大する枠）を拡大し、`target`（枠の中の要素）の中心を画面の (50%, `y`) に持ってくる。場面 3 の読解の表、場面 8 の「効かない」の行、場面 9 の一枚の結論・止まる業務・対策
- **下の段の決まり**：字幕は一番下（`--demo-caption-bottom`）、帯・下の注記・壁の帯はその上の一段（`--demo-band-bottom`）だけで、同じ場面の中で時間を重ねない（`storyboard.test.ts` が確かめる）。演出の画面は下の `--demo-safe-bottom` を空けて描く
- **options**：`policeStat`（場面 3 の警察庁の数字）。`layers` の `when: "policeStat"` が付いた層は、これが true のときだけ出る。警察庁サイト上の掲載場所を確認してから出す（`docs/hackathon/demo-script-v2.md` の決めてほしいこと 1）

`storyboard.test.ts` が、原稿との場面の対応、時刻が場面の長さに収まること、`scroll`・`click`・`fill` のセレクタが画面の部品に実在すること、`zoom` の対象がデモ用カルテにあること、壁が 3 → 8 → 9 の順に 1 枚ずつ崩れること、返信の番号 1 が「全 PC で共通（ない）」に当たることを確かめる。

## ベンダー確認依頼の記録（場面 5）

依頼文は Claude が毎回書くと 10 秒以上かかり、文面も変わるので、実際に生成した結果を一度だけ記録して使う。依頼文を書き直したい（原稿・メールの書き方が変わった）ときだけ、次で撮り直す。

```bash
node --disable-warning=ExperimentalWarning --env-file=<キーのある環境変数ファイル> demo/scripts/record-vendor-request.ts
```

- `POST /api/requests` と同じ経路を、一時ファイルの送信箱で in-process に呼ぶ（本物の送信箱には書かない）。キーはサーバ側の環境変数から読まれ、スクリプトは値を読まず出力もしない。`api.anthropic.com` への通信が要る
- 依頼文を書いたのが Claude でなければ（キーが無い・失敗してテンプレートになった）、何も書かずに止まる。リクエストヘッダは保存しない。キーらしき文字列が混ざっていれば書き出さない
- 記録の中身：件名、番号つきの本文（返信の書き方つき）、選択肢、選択肢 → 回答の対応（サーバの質問表の写し）。件名の回答期限は記録した日の 7 日後なので、動画に映るなら撮り直す前に確認する

## 社長向けの一枚の記録（場面 9）

一枚の「何が起きるか」の文は、Claude の言い換えを毎回待つと約 3 秒の空白（骨組み）が映り、文も録るたびに変わる。そこで、場面 9 と同じ状態（デモ精工・事例 1・対策なし・場面 5 のベンダー回答「全 PC で共通」）の一枚を、`POST /api/onepager` と同じ経路で一度だけ作って `demo/recordings/onepager.demo-seiko.ipa-case-1.json` に残す。デモモードでは、条件が記録と同じときだけ、カーソルが「AI で一枚を作る」を押した瞬間に記録をそのまま出す（API も Claude も呼ばない）。画面の右上に札「Claude の言い換え（記録）」が出る。デモでないとき・条件が違うときは、いつもどおり API で作る。

```bash
# 作る（キーのある環境変数ファイルを Node に渡す。api.anthropic.com への通信が要る。キーの値は読まず、出力もしない）
node --disable-warning=ExperimentalWarning --env-file=<キーのある環境変数ファイル> demo/scripts/record-onepager.ts
# 記録が今の判定・数字・期限・対策と合っているかを確かめる（Claude を呼ばない。合わなければ終了コード 1）
node --disable-warning=ExperimentalWarning demo/scripts/record-onepager.ts --check
```

- 言い換えたのが Claude でなければ（キーが無い・検証で捨てた・失敗した）何も書かずに止まる。リクエストヘッダは保存しない。キーらしき文字列があれば書き出さない
- **11/7 昼（コードと知識ファイルの変更を止めたあと）に作り直す**：一枚の文（C5：`packages/engine/src/onepager.ts`、`packages/llm/src/onepager-writer.ts`、`knowledge/deadlines.yaml`）が固まってから、次の順に行う
  1. main を取り込んだ checkout で `record-onepager.ts --check` を実行する。「違います」と出たら（C5 で文や期限が変わったら）、次へ
  2. `record-onepager.ts` で作り直し、表示された「何が起きるか」の各行を読んで、事実と数字（10 日、3 日目、1 億円など）が判定と合っているか確かめる
  3. もう一度 `--check` が通ることを確かめ、`pnpm test`（`storyboard.test.ts` が記録と場面 9 の対応を確かめる）を通してからコミットする
  4. 録画（手順 5-a）の前に、`?demo=1&scene=5` から通して、場面 9 で骨組みが出ず、札「Claude の言い換え（記録）」が出ることを確かめる（場面 9 から始めると場面 5 の回答が無いので、記録を使わず API で作る）

## 差し込み口

`apps/web/src/client/demo/slots.tsx` の `SLOTS` に、`(props: { elapsed, seconds, onScreen }) => ReactNode` の部品を入れると、その枠に実際の画面が入る（`elapsed` は差し込み口が出てからの秒数）。

| 差し込み口        | 状態     | 中身                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slot:recon`      | 接続済み | 場面 4 前半。`ReconReplaySlot`（`components/ReconReplay.tsx`）が `demo/recordings/recon.demo-sec.json` の記録を再生する。ネットワークに出ない（描きは `elapsed` だけで決まる）。14 秒の時計を、差し込み口が出ている 9 秒に引き伸ばす。記録の作り方は `demo/recon-recording.md`                                                                                                                                                                              |
| `slot:attacker`   | 接続済み | 記録した下見の出力を再生。ログを出し終えたら「採用 n・破棄 m」と 4 点検証の ✓ を順に出す（数は検証結果そのもの）                                                                                                                                                                                                                                                                                                                                            |
| `slot:request`    | 接続済み | ベンダー確認。依頼は記録（`demo/recordings/vendor-request.demo-seiko.json`、Claude で実際に生成した管理者アカウント M1026 の依頼文）から組み立て、`click`／`fill` の操作で本物の送信箱の部品を動かす。**サーバにも送信箱にも依頼を作らず、Claude も呼ばない**（毎回同じ映像。サーバの送信箱が空でも残りがあっても同じ）。返信の入力は、サーバの `recordReply` と同じ回答を作って判定に反映する（一致は `server/vendorRequestRecording.test.ts` が確かめる） |
| `slot:comparison` | 接続済み | 知見なし AI の提案（挙げた順）と、ウチダイの判定の左右の並置。「効かない」の印は判定ルールで効かないと決まったものだけ                                                                                                                                                                                                                                                                                                                                      |

場面 4 の「対象のホストにはアクセスしません」の字と札「実際に外から見た記録（記録日 …、demo-sec.com）」は `ReconReplay` が出す（絵コンテの層にはない）。差し込み口の `seconds` は、その overlay が出ている長さ（次の `overlay` 操作の時刻まで、無ければ場面の終わり）。

## 利用規約の確認結果（2026-11-02）

### VOICEVOX

- **ソフトウェア本体**（[利用規約](https://voicevox.hiroshiba.jp/term/)）：「商用・非商用問わず利用することができます」「ご利用の際は VOICEVOX を利用したことがわかるクレジット表記が必要です」「作成された音声を利用する際は、各音声ライブラリの規約に従ってください」。作った音声の利用を他者に許諾するときは、相手にも同じ条件を守らせる
- **音声ライブラリ**（キャラクターごとに規約が違う）：既定の **四国めたん** と **ずんだもん** は SSS LLC の[東北ずん子・ずんだもんプロジェクト 音源利用規約](https://zunko.jp/con_ongen_kiyaku.html)に従う。商用・非商用とも利用可で、法人と個人の区別はなく、クレジットは「VOICEVOX:四国めたん」「VOICEVOX:ずんだもん」の形。動画サイトでは概要欄か画面内のクレジットに書く。禁止：公序良俗に反する利用、政治・宗教活動や特定の個人・団体・国家の批判や支持、情報商材、虚偽・誤解を招く情報の作成、風俗営業、反社会的勢力による利用
- **青山龍星**など一部のキャラクターは、企業が携わる利用に事前確認が要る（Docker Hub の `voicevox/voicevox_engine` の説明）。ab3xy の作品として公開するため、既定では使わない。話者を変えるときは `--name` で指定し、そのキャラクターの規約と `narration.json` の `credits.voice` を合わせる
- 本リポジトリの表記：エンドカード（場面 11）と README に「音声合成：VOICEVOX:四国めたん」。動画の概要欄にも同じ一行を書く

### HyperFrames

- 実在する：[heygen-com/hyperframes](https://github.com/heygen-com/hyperframes)（HeyGen が公開。HTML で動画を定義し、headless Chrome で 1 フレームずつ描画して FFmpeg で MP4 にする。README の表記は Apache 2.0 で「per-render fees や commercial-use thresholds は無い」）。Node.js 22 以上、FFmpeg、Puppeteer 経由の Chrome が要る
- 使い方（README より）：`npx hyperframes init my-video` → `npx hyperframes preview` → `npx hyperframes render`。構成は HTML に `data-composition-id` / `data-width` / `data-height` / `data-start` / `data-duration` / `data-track-index` を付け、GSAP のタイムラインを `window.__timelines` に登録する
- **この環境では動作を確認していない**（Chromium の取得が要るため）。代替として `assemble.ts`（ffmpeg）を主の手順にした。HyperFrames を使うなら、録画した MP4 と `demo/out/narration.wav` を `<video>` と `<audio>` の clip として置き、字幕は `timeline.json` の cue から `<div data-start data-duration>` を作る形になる

### 書体と ATT&CK

- BIZ UDPGothic / BIZ UDPMincho / JetBrains Mono：いずれも SIL Open Font License 1.1（`@fontsource` で同梱）
- MITRE ATT&CK®：© The MITRE Corporation。利用規約と帰属はルートの `NOTICE`

## 社長向けの一枚（動画の場面 9 でも使う）

`#/onepager` に縦長の一枚を描く。共有リンクだけで再現できる：

```
http://localhost:5173/#/onepager?profile=demo-seiko&case=ipa-case-1&measures=
```

- `profile`：`examples/<id>.json` のカルテ。省略するとこのブラウザに保存したカルテ（この場合リンクでは共有できない）
- `case`：`eval/recordings/<id>.with-knowledge.json` の記録済みの読解結果。省略すると画面で選んだ事例
- `measures`：適用する対策ボタンの ID をコンマ区切り。省略すると画面の状態、空なら対策なし
- `rewrite=0`：Claude の言い換えを使わずテンプレート文にする
- 「PDF をダウンロード」はブラウザの中で .pdf を作って保存（A4 縦・白地・2 ページ以内）。「印刷する」はブラウザの印刷。API は `POST /api/onepager`
