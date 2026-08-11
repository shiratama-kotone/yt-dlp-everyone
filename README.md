# YouTube ダウンローダー (個人用 / Render + yt-dlp + ffmpeg)

Node.js + Express 製の個人用サーバーです。yt-dlp で画質一覧を取得し、
選択した画質(映像と音声が分かれている場合はサーバー側で ffmpeg を使って
自動結合)でMP4をダウンロードできます。

**ご利用にあたって**: 個人利用を前提としたツールです。ダウンロードした動画の
取り扱いについては、著作権および YouTube の利用規約をご自身の責任で
確認・遵守してください。

---

## 1. ファイル構成

```
.
├── server.js          # Expressサーバー本体
├── package.json
├── Dockerfile          # Render(Docker環境)用
├── render.yaml         # Renderのサービス定義
├── .dockerignore
├── worker-example.js   # Cloudflare Workerから呼び出す例
├── public/
│   └── index.html       # ブラウザ用の操作画面
└── README.md
```

## 2. Renderへのデプロイ手順

1. このフォルダの中身をGitHubリポジトリにpushする
2. Renderのダッシュボードで **New +** → **Web Service** を選択
3. リポジトリを選択すると `render.yaml` が自動検出されます
   (自動検出されない場合は environment を **Docker** に手動設定してください)
4. Environment Variables に `API_KEY` を設定する(強く推奨)
   - 未設定だと誰でもこのサーバーを使える状態になります
5. Deploy を実行。ビルドが完了すると `https://<サービス名>.onrender.com` で
   アクセスできるようになります

ローカルで動作確認したい場合は、Docker Desktopなどで以下のように起動できます。

```bash
docker build -t ytdl-server .
docker run -p 10000:10000 -e API_KEY=your-secret-key ytdl-server
```

## 3. HTMLページの使い方

`https://<サービス名>.onrender.com/` にアクセスすると操作画面が開きます。

1. `API_KEY` を設定している場合は画面上部にAPIキーを入力(ブラウザに保存されます)
2. YouTubeのURLを入力し「画質一覧を取得」をクリック
3. 映像フォーマットを選択(必要なら音声フォーマットも選択)
4. 「ダウンロード開始」をクリックするとブラウザのダウンロード機能でMP4が保存されます

## 4. API仕様

すべてのAPIは `API_KEY` を設定している場合、以下のいずれかで認証が必要です。

- ヘッダー: `x-api-key: <API_KEY>`
- クエリパラメータ: `?apiKey=<API_KEY>`

### GET /api/health

生存確認用。

```
GET /api/health
→ { "status": "ok", "time": "2026-08-02T..." }
```

### GET /api/formats?url=\<YouTubeURL\>

利用可能なフォーマット一覧を取得します。

```
GET /api/formats?url=https://www.youtube.com/watch?v=XXXXXXXXXXX
```

レスポンス例:

```json
{
  "title": "動画タイトル",
  "thumbnail": "https://...",
  "duration": 213,
  "channel": "チャンネル名",
  "formats": [
    {
      "formatId": "137",
      "ext": "mp4",
      "hasVideo": true,
      "hasAudio": false,
      "resolution": "1920x1080",
      "height": 1080,
      "fps": 30,
      "vcodec": "avc1.640028",
      "acodec": null,
      "abr": null,
      "tbr": 4500,
      "filesize": 52428800,
      "note": "1080p"
    },
    {
      "formatId": "140",
      "ext": "m4a",
      "hasVideo": false,
      "hasAudio": true,
      "resolution": null,
      "height": null,
      "fps": null,
      "vcodec": null,
      "acodec": "mp4a.40.2",
      "abr": 128,
      "tbr": 128,
      "filesize": 3355443,
      "note": null
    }
  ]
}
```

1080p以上のような高画質は `hasVideo: true, hasAudio: false` の形式(映像のみ)で
返ってくることが多いです。その場合は `hasAudio: true, hasVideo: false` の
音声フォーマットと組み合わせてダウンロードします。

### GET /api/download?url=...&formatId=...&audioFormatId=...&filename=...

| パラメータ | 必須 | 説明 |
|---|---|---|
| `url` | ○ | YouTube動画URL |
| `formatId` | ○ | `/api/formats` で取得した映像(または映像+音声)のformatId |
| `audioFormatId` | △ | 映像に音声が含まれない場合に指定する音声のformatId。指定するとサーバー側でffmpegにより自動結合されます |
| `filename` | - | 保存ファイル名を指定したい場合(URLエンコード推奨) |

例1: 映像と音声が一体化しているフォーマット(例: 720p以下でよくある)

```
GET /api/download?url=https://youtu.be/XXXXXXXXXXX&formatId=22
```

例2: 1080p(映像のみ)+ 音声を自動結合してダウンロード

```
GET /api/download?url=https://youtu.be/XXXXXXXXXXX&formatId=137&audioFormatId=140
```

レスポンスは `Content-Disposition: attachment` 付きのMP4バイナリです。
ダウンロード完了後、サーバー上の一時ファイルは自動的に削除されます。

### GET /api/debug?url=\<YouTube URL\>

実際にダウンロードはせず、yt-dlpの `--list-formats`(詳細ログ付き)の
生の出力をそのまま返します。「Requested format is not available」など
原因が分かりにくいエラーが出たときの調査用エンドポイントです。

```
GET /api/debug?url=https://youtu.be/XXXXXXXXXXX
→ { "ok": true, "stdout": "...", "stderr": "..." }
```

## 5. Cloudflare Workerから使う場合

Worker自体はyt-dlp/ffmpegを実行できないため、Renderサーバーへの
「中継役」として使います(`worker-example.js` を参照)。

主な用途:
- APIキーをWorkerのSecretに隠して、フロント側にキーを露出させない
- 短いURL(`workers.dev` のドメイン)経由でアクセスできるようにする
- 他のオートメーション(Cloudflare Workers Cron、Zapier的な用途)からRenderの
  APIを呼び出す窓口にする

設定手順:

1. Cloudflareダッシュボードで新規Workerを作成し `worker-example.js` の中身を貼り付け
2. Workerの環境変数に以下を設定
   - `RENDER_BASE_URL`: `https://<サービス名>.onrender.com`
   - `API_KEY`: Renderサーバーに設定したものと同じ値(Secretとして保存)
3. デプロイ後、以下のようにアクセス可能

```
https://<worker名>.<サブドメイン>.workers.dev/formats?url=https://youtu.be/XXXX
https://<worker名>.<サブドメイン>.workers.dev/download?url=https://youtu.be/XXXX&formatId=137&audioFormatId=140
```

## 6. 環境変数一覧

| 変数名 | 必須 | 説明 |
|---|---|---|
| `API_KEY` | 推奨 | APIの簡易認証キー。未設定だと誰でも使える状態になる |
| `PORT` | - | Expressが待ち受けるポート。Renderが自動設定するため通常は変更不要 |
| `COOKIES_BASE64` | 状況による | Botチェック回避用Cookie(詳細は次項) |
| `PROCESS_TIMEOUT_MS` | - | yt-dlpの1リクエストあたりの最大実行時間(ミリ秒)。未設定時は `600000`(10分) |
| `YTDLP_PATH` | - | yt-dlp実行ファイルのパス。未設定時は `yt-dlp`(PATH上のもの) |
| `FFMPEG_PATH` | - | ffmpeg実行ファイルのパス。未設定時は `ffmpeg`(PATH上のもの) |

### PROCESS_TIMEOUT_MS について

`/api/formats`(情報取得)と `/api/download`(ダウンロード+結合)は、どちらも
内部でyt-dlpの子プロセスを起動して完了を待ちます。この待ち時間の上限が
`PROCESS_TIMEOUT_MS` です。

- 処理がこの時間を超えると、サーバーは子プロセスを強制終了し、
  `処理がタイムアウトしました(N秒)` というエラーを返します
- デフォルトは `600000`(10分)。長い動画・低速な回線・高画質(ファイルサイズ大)を
  扱う場合は、Renderの環境変数でもっと大きい値(例: `1800000` = 30分)に
  変更してください
- 逆に、明らかにハングしたリクエストを早めに切り上げたい場合は短めの値
  (例: `120000` = 2分)にしても構いません
- あくまでこのサーバー内部の上限であり、Render自体やブラウザ側のタイムアウト
  (無料プランのスリープ、リバースプロキシのタイムアウトなど)には別途影響される点に注意してください

## 7. 「Sign in to confirm you're not a bot」対策 (Cookie設定)

YouTube側のBotチェックにより、Cookie無しだと `Sign in to confirm you're not a bot` という
エラーで失敗することがあります。その場合はブラウザのCookieをyt-dlpに渡す必要があります。

### 手順

1. **ブラウザでYouTubeにログインした状態**で、Cookieをエクスポートする拡張機能
   (例: Chromeの「Get cookies.txt LOCALLY」など)を使い、Netscape形式の
   `cookies.txt` をダウンロードする
2. `cookies.txt` をBase64の1行文字列に変換する

   ```bash
   # macOS
   base64 -i cookies.txt | tr -d '\n' > cookies_base64.txt

   # Linux
   base64 -w0 cookies.txt > cookies_base64.txt

   # Windows (PowerShell)
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("cookies.txt")) | Set-Content cookies_base64.txt
   ```

3. `cookies_base64.txt` の中身を、Renderのダッシュボード →
   対象サービス → **Environment** → `COOKIES_BASE64` にそのまま貼り付けて保存する
4. Renderが自動的に再デプロイされる(されない場合は手動でRedeployする)

サーバー起動時にこの値がデコードされ、一時ファイルとして書き出された上で
全てのyt-dlp呼び出しに `--cookies` オプションとして自動的に付与されます。

**注意点:**
- Cookieには自分のYouTubeアカウントの認証情報が含まれます。第三者に共有しないでください。
- Cookieには有効期限があるため、しばらくして再びBotチェックに引っかかるようになったら
  同じ手順で再取得・再設定してください。
- `COOKIES_BASE64` が未設定の場合、起動ログに警告が出ますが動作自体は続行します
  (Cookie無しでダウンロードできる動画も多いため)。

## 8. 「Requested format is not available」対策 (PO Token / SABR)

Cookieを設定しても `Requested format is not available` が出る場合、原因は
YouTube側の配信方式(SABR)によって **PO Token(Proof of Origin Token)** という
署名を解決できないと一部のフォーマットが「存在しない」扱いになってしまうことです。

これに対応するため、以下を導入しています。

- **yt-dlp本体をpipで最新版インストール**(スタンドアロンバイナリより追従が早い)
- **`yt-dlp-ejs`**: PO Token/nチャレンジの署名解決を行う追加コンポーネント
- **Deno**: `yt-dlp-ejs` が署名解決に使うJavaScriptランタイム
  (ベースイメージのNode.js標準では要件を満たさないため別途インストール)
- yt-dlp呼び出し時に以下を常時付与
  - `--js-runtimes deno`
  - `--remote-components ejs:github`
  - `--extractor-args youtube:formats=missing_pot`
    (PO Tokenが無くても取得できるフォーマットは強制的に一覧へ含めさせる)

これらは `server.js` の `resilienceArgs()` にまとまっており、
`/api/formats` `/api/download` `/api/debug` すべてに自動で付与されます。
特別な環境変数設定は不要です(Dockerfileでの依存インストールのみで有効になります)。

原因調査が必要な場合は `/api/debug?url=...` で `--list-formats -v` の
生ログを確認してください。

## 9. 注意点・既知の制約

- **Render無料プランのタイムアウト**: 無料プラン(Free Web Service)は
  一定時間アクセスがないとスリープし、次回リクエスト時にコールドスタートが
  発生します。また長時間の処理はプロキシ側のタイムアウトに引っかかる場合が
  あるため、長い動画では有料プランや `PROCESS_TIMEOUT_MS` の調整を検討してください。
- **ディスク容量**: Renderの無料プランは永続ディスクではなく一時領域のみです。
  本サーバーはダウンロード完了後に一時ファイルを都度削除するため、通常は
  問題になりませんが、非常に大きな動画(数GB)は一時的にディスクを圧迫します。
- **yt-dlpの更新**: YouTube側の仕様変更でyt-dlpが動かなくなることがあります。
  その場合はDockerイメージを再ビルド(pipで毎回最新版を取得する構成に
  なっているため、Renderで再デプロイすれば最新版が入ります)してください。
- **ビルド時間**: `python3`/`ffmpeg`/`deno` 等の追加インストールにより、
  以前の構成よりDockerビルドに時間がかかります。初回デプロイは気長にお待ちください。