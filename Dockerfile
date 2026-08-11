FROM node:20-slim

# ffmpeg と yt-dlp の実行に必要なパッケージをインストール
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp のスタンドアロンバイナリを取得
# 注意: "yt-dlp"(拡張子なし)はPython同梱ではなく、実行時にシステムのpython3を要求する。
# 一方 "yt-dlp_linux" はPythonをバイナリ内に同梱した単体実行ファイルなので、
# ベースイメージに python3 を追加インストールしなくても動作する。
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
        -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000

CMD ["node", "server.js"]
