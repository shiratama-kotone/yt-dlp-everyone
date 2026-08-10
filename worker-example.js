/**
 * Cloudflare Worker から Render 上のダウンロードサーバーを呼び出すサンプル。
 *
 * Worker自体はyt-dlp/ffmpegを実行できないため、あくまで
 * Renderサーバーへのリクエストを中継する「窓口」として使います。
 * (例: 短縮エンドポイントの提供、APIキーをWorker側のSecretに隠す、など)
 *
 * 使い方:
 *  1. Cloudflare Dashboard で新規Workerを作成し、このコードを貼り付け
 *  2. Worker の Settings > Variables で以下を設定
 *       - RENDER_BASE_URL : https://your-app.onrender.com
 *       - API_KEY         : Renderサーバーに設定したものと同じ値 (Secretとして保存)
 *  3. デプロイ後、下記のようにアクセスできます
 *       https://your-worker.workers.dev/formats?url=https://youtu.be/xxxx
 *       https://your-worker.workers.dev/download?url=...&formatId=...
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/formats') {
      return proxy(env, '/api/formats', url.searchParams);
    }

    if (url.pathname === '/download') {
      return proxy(env, '/api/download', url.searchParams);
    }

    return new Response('Not Found', { status: 404 });
  },
};

async function proxy(env, targetPath, searchParams) {
  const target = new URL(targetPath, env.RENDER_BASE_URL);
  searchParams.forEach((value, key) => target.searchParams.set(key, value));

  const upstreamRes = await fetch(target.toString(), {
    headers: {
      'x-api-key': env.API_KEY || '',
    },
  });

  // ヘッダーとステータスをそのまま透過させ、レスポンス本体をストリームで返す
  const headers = new Headers(upstreamRes.headers);
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers,
  });
}
