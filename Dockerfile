# ── Stage 1: Build Next.js ──────────────────────────────────────────────────
FROM node:20-slim AS web-builder
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ── Stage 2: Final image (Python + Node for Next.js production) ─────────────
FROM python:3.11-slim

# Install Node.js and supervisor
RUN apt-get update && \
    apt-get install -y curl supervisor && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY . .

# Copy built Next.js from stage 1
COPY --from=web-builder /web/.next /app/web/.next
COPY --from=web-builder /web/node_modules /app/web/node_modules

# Supervisor config
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# HuggingFace Spaces / Fly.io expects this port (Next.js is the public face)
EXPOSE 7860

CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
