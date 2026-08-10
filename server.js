/**
 * 個人用 YouTube 動画ダウンロードサーバー
 * Node.js + Express + yt-dlp + ffmpeg
 *
 * 主な機能:
 *  - GET  /api/health              : 生存確認
 *  - GET  /api/formats?url=...     : 指定したYouTube動画の利用可能な画質一覧を取得
 *  - GET  /api/download?...        : 指定した画質(必要なら映像/音声を自動結合)でダウンロード
 *
 * 注意:
 *  - このサーバーは個人利用を想定しています。公開状態で運用する場合は
 *    必ず API_KEY を設定し、第三者に自由に使われないようにしてください。
 *  - ダウンロードした動画の取り扱いについては、著作権や YouTube の利用規約を
 *    ご自身の責任で確認・遵守してください。
 */

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fsPromises = fs.promises;
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_KEY || ''; // 未設定なら認証なし(非推奨)
const YTDLP_PATH = process.env.YTDLP_PATH || 'yt-dlp';
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';

// yt-dlp / download の最大実行時間(ミリ秒)。長い動画・低速回線を考慮して長めに設定。
const PROCESS_TIMEOUT_MS = parseInt(process.env.PROCESS_TIMEOUT_MS || '', 10) || 10 * 60 * 1000; // 10分

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------------------------------------------------
// 認証ミドルウェア (API_KEY が設定されている場合のみ有効)
// ヘッダー "x-api-key" もしくはクエリ "apiKey" のいずれかで受け付ける
// ------------------------------------------------------------------
function apiKeyAuth(req, res, next) {
  if (!API_KEY) return next(); // API_KEY未設定なら素通し(個人検証用)
  const provided = req.get('x-api-key') || req.query.apiKey;
  if (provided && provided === API_KEY) return next();
  return res.status(401).json({ error: 'APIキーが無効、または未指定です' });
}

// ------------------------------------------------------------------
// YouTube URL かどうかの簡易チェック(オープンプロキシ化を防ぐ)
// ------------------------------------------------------------------
function isValidYouTubeUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    return (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtu.be'
    );
  } catch (e) {
    return false;
  }
}

// ------------------------------------------------------------------
// 外部プロセス実行の共通ヘルパー
// ------------------------------------------------------------------
function runProcess(command, args, { timeoutMs = PROCESS_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let stdout = '';
    let stderr = '';
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      proc.kill('SIGKILL');
      reject(new Error(`処理がタイムアウトしました (${Math.round(timeoutMs / 1000)}秒)`));
    }, timeoutMs);

    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    proc.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new Error(`コマンドが見つかりません: ${command} (インストール状況を確認してください)`));
      } else {
        reject(err);
      }
    });

    proc.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `${command} がコード ${code} で終了しました`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// ------------------------------------------------------------------
// 一時ディレクトリの後始末
// ------------------------------------------------------------------
async function cleanupDir(dirPath) {
  try {
    await fsPromises.rm(dirPath, { recursive: true, force: true });
  } catch (e) {
    console.error(`一時ディレクトリの削除に失敗: ${dirPath}`, e);
  }
}

// ------------------------------------------------------------------
// GET /api/health
// ------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ------------------------------------------------------------------
// GET /api/formats?url=<YouTube URL>
// 利用可能な画質/音声フォーマット一覧を返す
// ------------------------------------------------------------------
app.get('/api/formats', apiKeyAuth, async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'クエリパラメータ url が必要です' });
  }
  if (!isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'YouTubeのURLではありません' });
  }

  try {
    const args = ['-J', '--no-playlist', '--no-warnings', url];
    const { stdout } = await runProcess(YTDLP_PATH, args);

    let info;
    try {
      info = JSON.parse(stdout);
    } catch (e) {
      throw new Error('yt-dlp の出力(JSON)の解析に失敗しました');
    }

    const rawFormats = Array.isArray(info.formats) ? info.formats : [];

    const formats = rawFormats
      .filter((f) => f.vcodec !== 'none' || f.acodec !== 'none')
      .map((f) => {
        const hasVideo = f.vcodec && f.vcodec !== 'none';
        const hasAudio = f.acodec && f.acodec !== 'none';
        return {
          formatId: f.format_id,
          ext: f.ext,
          hasVideo: !!hasVideo,
          hasAudio: !!hasAudio,
          resolution: hasVideo ? (f.resolution || `${f.width || '?'}x${f.height || '?'}`) : null,
          height: f.height || null,
          fps: f.fps || null,
          vcodec: hasVideo ? f.vcodec : null,
          acodec: hasAudio ? f.acodec : null,
          abr: f.abr || null,
          tbr: f.tbr || null,
          filesize: f.filesize || f.filesize_approx || null,
          note: f.format_note || null,
        };
      })
      // 見やすいように解像度→ビットレート順でソート
      .sort((a, b) => {
        const ah = a.height || 0;
        const bh = b.height || 0;
        if (bh !== ah) return bh - ah;
        return (b.tbr || 0) - (a.tbr || 0);
      });

    res.json({
      title: info.title || null,
      thumbnail: info.thumbnail || null,
      duration: info.duration || null,
      channel: info.channel || info.uploader || null,
      formats,
    });
  } catch (err) {
    console.error('フォーマット取得エラー:', err.message);
    res.status(500).json({ error: err.message || 'フォーマットの取得に失敗しました' });
  }
});

// ------------------------------------------------------------------
// GET /api/download?url=...&formatId=...&audioFormatId=...&filename=...
//
// formatId のみ指定    : そのフォーマットをそのままダウンロード(映像+音声が結合済みの場合など)
// formatId + audioFormatId : 映像と音声を別々に取得し、ffmpeg(yt-dlp内蔵)で自動結合してMP4化
// ------------------------------------------------------------------
app.get('/api/download', apiKeyAuth, async (req, res) => {
  const { url, formatId, audioFormatId, filename } = req.query;

  if (!url || !formatId) {
    return res.status(400).json({ error: 'クエリパラメータ url と formatId が必要です' });
  }
  if (!isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'YouTubeのURLではありません' });
  }

  const jobId = uuidv4();
  const workDir = path.join(os.tmpdir(), `ytdl-${jobId}`);

  try {
    await fsPromises.mkdir(workDir, { recursive: true });
  } catch (e) {
    console.error('一時ディレクトリ作成エラー:', e);
    return res.status(500).json({ error: '一時ディレクトリの作成に失敗しました' });
  }

  // 映像と音声が別フォーマットの場合、yt-dlp が内部で ffmpeg を呼び出して自動結合する
  const formatArg = audioFormatId ? `${formatId}+${audioFormatId}` : formatId;
  const outputTemplate = path.join(workDir, 'output.%(ext)s');

  const args = [
    '-f', formatArg,
    '--merge-output-format', 'mp4',
    '--no-playlist',
    '--no-warnings',
    '--ffmpeg-location', FFMPEG_PATH,
    '-o', outputTemplate,
    url,
  ];

  try {
    await runProcess(YTDLP_PATH, args);

    const files = await fsPromises.readdir(workDir);
    const outputFile = files.find((f) => f.startsWith('output.'));

    if (!outputFile) {
      throw new Error('出力ファイルが生成されませんでした');
    }

    const filePath = path.join(workDir, outputFile);
    const downloadName = filename
      ? decodeURIComponent(filename).replace(/[\\/:*?"<>|]/g, '_')
      : outputFile;

    res.download(filePath, downloadName, async (err) => {
      // レスポンス送信の成否にかかわらず一時ファイルを削除
      await cleanupDir(workDir);
      if (err) {
        console.error('ファイル送信エラー:', err.message);
      }
    });
  } catch (err) {
    console.error('ダウンロードエラー:', err.message);
    await cleanupDir(workDir);
    res.status(500).json({ error: err.message || 'ダウンロードに失敗しました' });
  }
});

// ------------------------------------------------------------------
// 404 / エラーハンドラ
// ------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('未処理のエラー:', err);
  res.status(500).json({ error: 'サーバー内部エラーが発生しました' });
});

app.listen(PORT, () => {
  console.log(`サーバーが起動しました: http://localhost:${PORT}`);
  if (!API_KEY) {
    console.warn('警告: API_KEY が未設定です。公開環境では必ず設定してください。');
  }
});
