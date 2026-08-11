FROM node:20-bookworm-slim

# yt-dlp(Python製) と ffmpeg、証明書類をインストール
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        ffmpeg \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp は pip で最新版を入れる(バイナリより更新が容易なため)
# yt-dlp-ejs: YouTubeのSABR配信化に伴い必要になった署名/nチャレンジ解決用の追加コンポーネント。
# これが無いと、cookieを設定していても一部フォーマットが
# "Requested format is not available" として弾かれることがある。
RUN pip3 install --no-cache-dir --break-system-packages -U yt-dlp yt-dlp-ejs

# Deno: yt-dlp-ejsの署名/nチャレンジ解決に使うJavaScriptランタイム。
# ベースイメージのNode.js(20系)はyt-dlp-ejsの要件(Node 22.6+)を満たさないため、
# yt-dlpが標準で優先的に使うDenoを別途インストールする。
RUN npm install -g deno

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000

CMD ["node", "server.js"]