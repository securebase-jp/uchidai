# 効果音（自作の合成音）

デモ動画の効果音は、**ffmpeg の合成だけ**で作る。外部の音素材、ダウンロード、録音、BGM は使わない（BGM は仕様で使えない）。権利の問題は出ない。
いつ・どの音を鳴らすかは `demo/sfx.json`（cue の一覧）、音そのものは `demo/scripts/sfx-sounds.ts`（レシピ）、動画への合成は `demo/scripts/assemble.ts`。脚本は `docs/demo-script-v2.md` の「効果音」の表と各場面の演出。

## 音の一覧

ピークはすべて -6 dBFS 以下（実測で約 -7.3〜-8.3 dBFS）、モノラル・48 kHz・16 bit の WAV。`node demo/scripts/synth-sfx.ts --list` でも見られる。

| 音名            | 長さ（秒） | 鳴らす場面 | 音                                                             |
| --------------- | ---------: | ---------- | -------------------------------------------------------------- |
| `message`       |       0.50 | 1・9       | メッセージの着信。短い 2 音（A5 → D6）                         |
| `wall-up`       |       0.80 | 2          | 壁が立つ低い音。80→130 Hz の上がる音と低域のノイズの一打       |
| `wall-down`     |       1.60 | 9（3・8）  | 壁が崩れる音。低域のノイズの崩れと、下がる音、細かい破片       |
| `tick`          |       0.10 | 4          | 外部確認の結果が出るたびの小さな音（1760 Hz + 2637 Hz）        |
| `scan`          |       1.00 | 5          | 赤い線が進む間の細い走査音。700→1500 Hz の上がる音に細かい揺れ |
| `flip`          |       0.40 | 5          | 黄 → 赤の短い音。上がる 3 音（C5 → G5 → D6）                   |
| `verify`        |       0.50 | 6          | 検証が通る小さな音。高い 2 音と短い反響                        |
| `count`         |       1.60 | 7          | 数え上げのカウント音。音程が少しずつ上がる 14 回の小さな刻み   |
| `impact`        |       2.00 | 7          | 結論の低い一打。120→42 Hz の落下、55 Hz の持続、反響           |
| `shield-bounce` |       0.70 | 8          | 盾が弾かれる金属的な音。ずれた倍音 3 つと、下がって戻る音      |
| `green-spread`  |       1.40 | 8          | 緑が広がる音。上がっていく 4 音（C5 E5 G5 C6）とふくらむ空気   |

場面 3 と 8 の `wall-down` は、脚本の表（壁が崩れる音は場面 9 だけ）にはないが、場面の演出（専門知識の壁・相談相手と予算の壁が崩れる）に合わせて足した。要らなければ `sfx.json` から消す。

小さなノートパソコンのスピーカーでは、`impact` と `wall-up` の低域（40〜130 Hz）はほとんど出ない。耳で確かめるときはヘッドホンで。

## 作り方

```bash
node demo/scripts/synth-sfx.ts                 # 全部を demo/audio/sfx/<音名>.wav に書く（git 管理外）
node demo/scripts/synth-sfx.ts --only tick,impact
node demo/scripts/synth-sfx.ts --list          # 一覧
node demo/scripts/synth-sfx.ts --dry-run       # ffmpeg のコマンドを表示するだけ
```

- 材料は `lavfi` の `sine`、`aevalsrc`（音程が動く音）、`anoisesrc`（ノイズ。`seed` を固定）と、`afade`、`aecho`、`volume`、`lowpass`／`highpass`、`tremolo`、`alimiter` だけ。何度作っても同じ WAV になる（テストで確かめている）
- 各音は「層」を足して作る。層は、音程、開始（秒）、長さ、音量、立ち上がり、減衰。音を直すときは `sfx-sounds.ts` の `RECIPES` の数値を変える
- `trimDb` は、層を混ぜたあとのピークをほぼ -7.5 dBFS にそろえる補正（実測で決めた）。音を変えたら測り直す（下の「確かめ方」）
- 最後の `alimiter` が、ピークを -6.9 dBFS（0.45）で止める保険。ここで削られているときは層の音量を下げる

## cue の調整（いつ鳴らすか）

`demo/sfx.json` の各 cue は次の形。

```json
{ "scene": 8, "label": "一手で変わる", "at": 4, "sound": "shield-bounce", "gain": 0.9, "note": "…" }
```

| 項目     | 意味                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------ |
| `scene`  | 脚本 v2 の場面の番号 n。`narration.json` の `n` と照合する（`id` は使わない）                    |
| `label`  | 場面の名前。参考で、照合には使わない                                                             |
| `at`     | 場面の開始からの秒。`anchor` が `"end"` なら、場面の終わりの何秒前か                             |
| `anchor` | 省略すると `"start"`。音声を作ると場面の長さが変わるので、「最後の 3 秒」の演出は `"end"` にする |
| `sound`  | 上の表の音名                                                                                     |
| `gain`   | 0〜1。音ごとの基準の音量に対する割合                                                             |
| `note`   | 何に合わせた音か                                                                                 |

**時刻は仮置き**。脚本の各場面の演出（「各 1.5 秒」「最後の 3 秒」「0.5 秒」など）から置いたもので、録画の映像を見て合わせる。

1. 録画を再生し、音を足したい瞬間の、その場面の開始からの秒を読む
2. `at` を書き換える（`node demo/scripts/assemble.ts … --dry-run` で、絶対時刻 = `adelay=…S`（サンプル数 ÷ 48000）を確認できる）
3. 結合して聞く。ナレーションの上に被る cue は、自動で小さくなる（下のダッキング）ので、時刻より先に「その瞬間の画面に合っているか」を見る

場面の番号がタイムラインに無い cue（場面 10・11 が絵コンテにまだ無いとき、など）は、警告を出して飛ばす。場面の長さを超える `at` は、次の場面にかかるので警告を出す。

## 動画への合成

```bash
node demo/scripts/assemble.ts --video demo/capture/screen.mov [--sfx-gain -14] [--no-sfx]
```

1. `build-subtitles.ts` の `timeline.json`（場面の開始と長さ）と同じ計算で、cue を絶対時刻（場面の開始 + `at`）にする
2. 音ごとに 1 入力にして、cue ごとに `volume`（`gain`）と `adelay`（サンプル単位）をかけ、`amix`（`normalize=0`）で 1 本の効果音トラック `demo/out/sfx-track.wav` にする
3. ナレーションの WAV（いまの処理のまま。音声が無い場面は無音）と、効果音トラックを **`sidechaincompress`** でミックスして `demo/out/audio-mix.wav` にし、これを動画に付ける。出力は 1920×1080・60fps・H.264/AAC のまま

| オプション          | 内容                                                                |
| ------------------- | ------------------------------------------------------------------- |
| `--no-sfx`          | 効果音を入れない（ナレーションだけ）                                |
| `--sfx-gain <dB>`   | 効果音をナレーションに対して下げる量。既定 -14                      |
| `--sfx <path>`      | cue の JSON を別のものにする（既定 `demo/sfx.json`）                |
| `--sfx-dir <dir>`   | 効果音の WAV の置き場（既定 `demo/audio/sfx`）                      |
| `--timeline <path>` | 原稿から計算せず、この `timeline.json` の場面の時刻を使う（検証用） |
| `--work-dir <dir>`  | 途中の WAV や字幕の置き場（既定 `demo/out`）                        |

既存の `--video`、`--out`、`--title`、`--title-seconds`、`--font`、`--no-subtitles`、`--no-audio`、`--fps`、`--dry-run` はそのまま。`--no-audio` は音声すべて（効果音も）を付けない。音声（VOICEVOX）がまだ無いときは、ナレーションが無音になり、効果音だけが入る。効果音の WAV が無いときは警告を出して飛ばす（先に `synth-sfx.ts` を実行する）。

### ダッキング（ナレーションの発話中は効果音を下げる）

ナレーションをサイドチェーンの鍵にして、効果音だけを圧縮する（`sidechaincompress`）。ナレーションは触らない。

| 項目        | 値     | 意味                                                           |
| ----------- | ------ | -------------------------------------------------------------- |
| `threshold` | 0.02   | ナレーションが約 -34 dBFS を超えたら下げ始める                 |
| `ratio`     | 20     | 設定できる最大。発話中は効果音がほぼ聞こえなくなる             |
| `attack`    | 10 ms  | 発話の頭で素早く下げる                                         |
| `release`   | 400 ms | 発話が終わってから戻るまで。語間で音が跳ねないように長めにする |
| `makeup`    | 1      | 持ち上げない                                                   |

実測（疑似の発話 -10.5 dBFS ピーク、`shield-bounce` を発話中に置いた場合）：効果音のピークが -22.2 dBFS → -40.7 dBFS（約 18 dB 余計に下がる）。発話の外に置いた効果音は変わらない（差 0 dB）。数値は `demo/scripts/sfx.test.ts` が毎回確かめる。値は `sfx-lib.ts` の `DEFAULT_DUCK`。

## 確かめ方（耳で聞かずに数値で）

```bash
# 長さとピーク
ffprobe -v error -show_entries format=duration -of csv=p=0 demo/audio/sfx/impact.wav
ffmpeg -hide_banner -i demo/audio/sfx/impact.wav -af volumedetect -f null - 2>&1 | grep max_volume

# 完成した動画の、ある区間（例：119〜120 秒）の音量
ffmpeg -hide_banner -ss 119 -t 1 -i demo/out/uchidai-demo.mp4 -af volumedetect -f null - 2>&1 | grep -E "mean_volume|max_volume"
```

`pnpm --filter @uchidai/demo test` が、スキーマ、cue の絶対時刻、ffmpeg 引数、音の合成（長さ・ピーク・決定性）、ダッキング、仮の動画での結合を確かめる（ffmpeg が無い環境では ffmpeg を使う部分だけ飛ばす）。

## 権利

- すべて ffmpeg の信号合成（正弦波、ノイズ、フィルタ）。録音、サンプル音源、外部のライブラリの音は使っていない
- 作った音の権利は、このリポジトリ（MIT）に属する。クレジットの表記は要らない
- 動画に付ける表記は、これまでどおり音声合成（VOICEVOX:四国めたん）と書体だけ
