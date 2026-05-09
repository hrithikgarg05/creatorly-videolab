FROM node:20-slim

# Install ffmpeg (required for video frame extraction and audio analysis)
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Ensure temp upload directory exists
RUN mkdir -p /tmp/uploads /tmp/frames

EXPOSE 3001

CMD ["node", "server.js"]
