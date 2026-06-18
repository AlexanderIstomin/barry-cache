FROM oven/bun:1
WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile || bun install

# The brain reuses shared logic from src/core; copy both trees.
COPY src ./src
COPY brain ./brain

ENV BRAIN_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8787

# `serve` auto-creates config + identity and migrates on boot.
ENTRYPOINT ["bun", "run", "brain/cli.ts"]
CMD ["serve", "--dir", "/data", "--port", "8787"]
