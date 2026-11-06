# ウチダイを動かす（Docker で、数分で）

ウチダイは、あなたのパソコンの中で動かして使います。インターネット上のサービスではありません。そのためにいちばん手軽なのが Docker です。Node や pnpm を入れたり、ソースを取得して組み立てたりする必要はありません。

この文書は、Docker を入れるところから、起動、更新、止め方、困ったときまでを、順に説明します。ソースから動かしたい開発者向けの手順は、[README](../README.md) の「動かし方」にあります。

## 先に、大事なこと

ウチダイには、ログインの仕組みがありません。会社カルテを扱う機能が動くので、**あなたのパソコンの中だけで使ってください。** この文書の手順は、そのように作ってあります（`127.0.0.1` だけに公開します）。社内のほかの人や、インターネットから開けるようにはしないでください。ほかの人に結果を見せたいときは、画面の「社長向けの一枚」から PDF を作るか、共有リンクを使ってください。

## 1. Docker を入れる

すでに Docker が入っていれば、この手順は飛ばせます。ターミナル（Windows では PowerShell）で `docker --version` と打って、版が表示されれば入っています。

入っていなければ、お使いのパソコンに合わせて、Docker の公式の案内に沿って入れてください。

- Mac：[Docker Desktop for Mac の導入](https://docs.docker.com/desktop/setup/install/mac-install/)
- Windows：[Docker Desktop for Windows の導入](https://docs.docker.com/desktop/setup/install/windows-install/)
- Linux：[Docker Engine の導入](https://docs.docker.com/engine/install/)

入れたあと、Docker Desktop を一度起動して、画面の下か上に「Engine running」（動作中）と出るまで待ってください。

## 2. 起動する（3 手順）

ウチダイの公開イメージ（`ghcr.io/securebase-jp/uchidai`）を使います。Mac は Apple Silicon（M1 以降）も Intel も、Windows も、Linux も、同じ手順で動きます。API キーも `.env` ファイルも、最初は要りません。

### compose で動かす（おすすめ）

1. 空のフォルダを 1 つ作り、その中に [`docker-compose.yml`](../docker-compose.yml) を保存します。ターミナルで、次のように取得することもできます。

   ```bash
   curl -fsSLO https://raw.githubusercontent.com/securebase-jp/uchidai/main/docker-compose.yml
   ```

2. そのフォルダで、次を実行します。初回はイメージの取得に 1〜2 分かかります。

   ```bash
   docker compose up -d
   ```

3. ブラウザで <http://localhost:8787> を開きます。

これで使えます。パソコンを再起動しても、Docker が起動すれば自動で立ち上がります（`restart: unless-stopped`）。

### docker run の 1 行で動かす

compose を使わず、1 行で動かすこともできます。

```bash
docker run -d --name uchidai --restart unless-stopped -p 127.0.0.1:8787:8787 -v uchidai-data:/app/apps/web/.data ghcr.io/securebase-jp/uchidai:latest
```

こちらも <http://localhost:8787> を開きます。`-p 127.0.0.1:8787:8787` が「手元のパソコンだけに公開する」の指定です。`127.0.0.1:` を省いて `-p 8787:8787` とすると、同じネットワークのほかの機器からも見えるので、省かないでください。

## 3. 最初の確認

画面が開いたら、トップの案内に沿って進めます。API キーが無くても、記事の読解と文章の言い換えを除いて、すべて使えます（使える範囲は README の「API キーが無くても使える範囲」にあります）。

動いているかどうかは、次のようにも確かめられます。

```bash
curl http://127.0.0.1:8787/api/health
```

`{"ok":true,...}` と返れば動いています。

## 4. API キーを渡す（任意）

報道記事の URL や本文、PDF を Claude に読ませたいときだけ、Anthropic の API キーが要ります。キーは [Anthropic Console](https://console.anthropic.com/) で作ります。キーは、あなたのパソコンで動くウチダイのサーバだけが使い、ブラウザには渡しません。イメージの中にも入っていません。

**compose の場合**：`docker-compose.yml` と同じフォルダに、`.env` という名前のファイルを作り、1 行書きます。キーの部分は、ご自分のキーに置き換えます。

```text
ANTHROPIC_API_KEY=（ご自分のキー）
```

そのあと、`docker compose up -d` をもう一度実行すると、反映されます。

**docker run の場合**：`.env` ファイルを作って、`--env-file .env` を足します。

```bash
docker run -d --name uchidai --restart unless-stopped -p 127.0.0.1:8787:8787 -v uchidai-data:/app/apps/web/.data --env-file .env ghcr.io/securebase-jp/uchidai:latest
```

キーを入れた `.env` は、ほかの人に渡したり、共有フォルダや GitHub に置いたりしないでください。キーが漏れたときは、Anthropic Console でそのキーを無効にしてください。

### そのほかに渡せる設定

どれも任意で、普通は要りません。`.env` に `名前=値` の形で書きます。

| 名前                                    | 意味                                                                                                                                                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                     | Claude の API キー。無ければ、記事の読解と言い換えだけが使えません                                                                                                                                        |
| `ANTHROPIC_MODEL`                       | 読解や言い換えに使うモデルの名前。既定は製品が決めたものです                                                                                                                                              |
| `SMTP_URL`、`MAIL_FROM`                 | 確認依頼をメールで送るときの送信先の設定（`smtp://ユーザー:パスワード@ホスト:587` の形）と差出人。無ければ、送信箱と `mailto:` のリンクだけになります       |
| `HTTPS_PROXY`、`HTTP_PROXY`、`NO_PROXY` | 社内のプロキシを通さないと外へ出られないときの設定。後の「困ったとき」を見てください                                                                                                                      |
| `UCHIDAI_REQUESTS_FILE`                 | 確認依頼の保存先のファイル。既定のままで構いません                                                                                                                                                        |
| `UCHIDAI_KNOWLEDGE_DIR`                 | 判定の知識のフォルダを別の場所に差し替える。開発者向けで、フォルダを `-v` で渡す必要があります                                                                                                            |
| `UCHIDAI_ALLOW_REMOTE_API`              | `1` にすると、公開 URL 経由でも全 API を使えるようにします。デモ以外では**設定しないでください**                                                                                                          |
| `API_HOST`、`API_PORT`                  | イメージの中の待ち受け。既定（`0.0.0.0`、`8787`）のままにしてください。公開するポートを変えるときは、`-p` の左側（例：`127.0.0.1:9000:8787`）だけを変えます                                               |

## 5. データの置き場所と消し方

ウチダイが覚えているものは、2 か所に分かれています。

- **会社カルテ**：ブラウザの中（localStorage）にだけあります。サーバには保存されません。ブラウザごと、開いた URL ごとに別々です。たとえば `http://localhost:8787` と `http://localhost:9000` では、カルテは共有されません。公開するポートを変えるとカルテが見えなくなるので、ご注意ください（元のポートに戻せば見えます）。カルテは JSON で書き出せるので、書き出して保存しておくと、別のブラウザや別のパソコンにも移せます。
- **サーバ側のデータ**：確認依頼と、ドメインの所有確認のトークン、CISA KEV のキャッシュだけです。Docker の名前つきボリューム（`uchidai-data`）に置かれ、コンテナを作り直しても残ります。

消したいときは、次のとおりにします。消したものは戻せません。

```bash
# compose の場合：コンテナとボリューム（サーバ側のデータ）を消す
docker compose down -v

# docker run の場合
docker rm -f uchidai
docker volume rm uchidai-data
```

会社カルテを消すには、ブラウザの設定で `localhost` のサイトデータ（localStorage）を消してください。

## 6. 更新する

新しい版が公開されたら、取得し直して作り直します。ボリュームは残るので、サーバ側のデータは消えません。会社カルテもブラウザにあるので、消えません。

```bash
# compose の場合
docker compose pull
docker compose up -d
```

```bash
# docker run の場合
docker pull ghcr.io/securebase-jp/uchidai:latest
docker rm -f uchidai
docker run -d --name uchidai --restart unless-stopped -p 127.0.0.1:8787:8787 -v uchidai-data:/app/apps/web/.data ghcr.io/securebase-jp/uchidai:latest
```

`:latest` ではなく、版を決めて使うこともできます（例：`ghcr.io/securebase-jp/uchidai:1.2`）。版の一覧は、リポジトリのリリースのページにあります。

## 7. 止める

```bash
# compose の場合（データは残る）
docker compose stop      # 一時的に止める。docker compose start でまた動く
docker compose down      # 止めて、コンテナを片づける（データは残る）
```

```bash
# docker run の場合
docker stop uchidai      # 止める。docker start uchidai でまた動く
docker rm uchidai        # コンテナを片づける（データは残る）
```

Docker Desktop の画面からも、止めたり消したりできます。

## 8. 困ったとき

### ポート 8787 が使用中だと言われる

別のものが 8787 番を使っています。`-p` や `ports:` の左側の番号を、空いている別の番号（例：`8788`）に変えて、起動し直してください。開く URL も `http://localhost:8788` になります。このとき、会社カルテは元の URL とは別のものとして扱われます（前の「データの置き場所」を見てください）。

- compose の場合：`docker-compose.yml` の `"127.0.0.1:8787:8787"` を `"127.0.0.1:8788:8787"` にします。
- docker run の場合：`-p 127.0.0.1:8788:8787` にします。

ウチダイを開発用（`pnpm dev`）で動かしていると、8787 番を使っています。そちらを止めてください。

### 社内のプロキシを通さないと外へ出られない

イメージの取得（`docker pull`）と、ウチダイが外へ出る通信（Claude、CISA KEV、証明書の公開ログへの問い合わせ）は、別々に設定します。

- 取得：Docker Desktop の設定の「Resources」→「Proxies」に、プロキシを設定します。
- 実行中のウチダイ：`.env` に次の行を足し、作り直します。値は、社内で案内されているプロキシです。

  ```text
  HTTPS_PROXY=http://プロキシのホスト:ポート
  NO_PROXY=localhost,127.0.0.1
  ```

  docker run の場合は、同じ内容を `-e HTTPS_PROXY=...` で渡すか、`--env-file .env` を使います。

### Apple Silicon（M1 以降の Mac）

そのまま動きます。イメージは Intel 向け（amd64）と Apple Silicon 向け（arm64）の両方が公開されていて、Docker が自動で合うほうを選びます。「platform が合わない」という警告が出る場合は、古い版のイメージが残っているかもしれません。`docker pull ghcr.io/securebase-jp/uchidai:latest` で取り直してください。

### Windows（WSL2）

Docker Desktop for Windows は、WSL 2 を使う設定が既定です。入らない、起動しないときは、[WSL 2 の公式の案内](https://docs.docker.com/desktop/features/wsl/)を見てください。PowerShell で `docker compose up -d` を実行すれば、同じように動きます。WSL のターミナルから実行するときも、ブラウザで開く URL は `http://localhost:8787` のままです。

### 画面が開かない、動いているか分からない

```bash
docker ps                 # uchidai が一覧にあり、STATUS が Up（healthy）なら動いています
docker logs uchidai       # 起動の記録。「[uchidai api] http://0.0.0.0:8787」が出ていれば起動しています
```

「`ANTHROPIC_API_KEY` 未設定」という 1 行が出るのは、キーを渡していないからで、異常ではありません。

### イメージが取得できない（denied、unauthorized）

公開の設定が済んでいない、または、ネットワークがイメージの置き場（`ghcr.io`）に届かない可能性があります。社内のネットワークの制限の場合は、情報システムの担当者に `ghcr.io` を許可してもらってください。

### 書き込みの権限のエラー（EACCES）が出る

名前つきボリューム（`uchidai-data`）を使っていれば起きません。ボリュームではなく、自分のフォルダを `-v ./data:/app/apps/web/.data` のように渡すと、そのフォルダの持ち主がコンテナの利用者（`node`、番号 1000）と合わず、書けないことがあります。名前つきボリュームを使うことをおすすめします。

## 手元以外へ公開しないでください（再掲）

- `ports:` や `-p` を `8787:8787` のように、`127.0.0.1:` を付けない形に変えないでください。付けないと、同じネットワークのほかの機器から、会社カルテを扱う機能が使えてしまいます。
- ウチダイにはログインがありません。インターネットへ公開するための設定（ルーターのポート開放、クラウド上での公開、トンネルなど）は、おすすめしません。やむを得ないときは、前に認証をかける仕組み（社内の VPN、認証つきのリバースプロキシ）を、ご自身の責任で置いてください。
- 社長向けの一枚の共有リンクを外で開く方法は、[docs/usage.md](usage.md) にあります。この場合も、使えるのは出典の一覧だけで、会社カルテを扱う機能は外から使えません。公開するのは、この Docker のサーバや `pnpm build` 後の本番の形のサーバ（8787）だけにし、開発用の `pnpm dev` の画面（5173）は公開しないでください（開発サーバはリポジトリの中のファイルを配信できるため）。
