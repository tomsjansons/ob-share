# Stage 1: Build Next.js application
FROM node:20-slim AS nextjs-builder

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source files
COPY src ./src
COPY public ./public
COPY next.config.ts tsconfig.json tailwind.config.ts postcss.config.mjs drizzle.config.ts ./
COPY drizzle ./drizzle

# Build the application
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# Stage 2: Final runtime image
FROM ubuntu:22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install required packages including Node.js
RUN apt-get update && apt-get install -y \
    openbox \
    xvfb \
    x11vnc \
    python3-xdg \
    wget \
    xdg-utils \
    libnotify4 \
    libnss3 \
    libsecret-1-0 \
    libgbm1 \
    libasound2 \
    libgtk-3-0 \
    libdrm2 \
    libxss1 \
    libxshmfence1 \
    supervisor \
    dbus-x11 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libpango-1.0-0 \
    libcairo2 \
    fonts-liberation \
    curl \
    ca-certificates \
    sqlite3 \
    ffmpeg \
    # Additional fonts for better web rendering
    fonts-noto \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install Google Chrome (works in Docker, unlike snap-based chromium-browser)
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm globally
RUN corepack enable && corepack prepare pnpm@latest --activate

# Set Obsidian version - can be overridden at build time
ARG OBSIDIAN_VERSION=1.7.7

# Download and install Obsidian
RUN wget -q "https://github.com/obsidianmd/obsidian-releases/releases/download/v${OBSIDIAN_VERSION}/obsidian_${OBSIDIAN_VERSION}_amd64.deb" -O /tmp/obsidian.deb \
    && dpkg -i /tmp/obsidian.deb || apt-get install -f -y \
    && rm /tmp/obsidian.deb

# Create non-root user for running Obsidian
RUN useradd -m -s /bin/bash obsidian

# Create directories for VNC password, vault storage, data, and Chrome profile
RUN mkdir -p /home/obsidian/.vnc \
    && mkdir -p /home/obsidian/vault \
    && mkdir -p /home/obsidian/.config/obsidian \
    && mkdir -p /home/obsidian/.config/google-chrome \
    && mkdir -p /home/obsidian/Documents \
    && mkdir -p /data \
    && mkdir -p /app \
    && chown -R obsidian:obsidian /home/obsidian \
    && chown obsidian:obsidian /data \
    && chown obsidian:obsidian /app

# Copy Next.js standalone build from builder
COPY --from=nextjs-builder /app/.next/standalone /app
COPY --from=nextjs-builder /app/.next/static /app/.next/static
COPY --from=nextjs-builder /app/public /app/public

# Copy Drizzle files for migrations
COPY --from=nextjs-builder /app/node_modules /app/node_modules
COPY drizzle.config.ts /app/
COPY drizzle /app/drizzle
COPY src/server/db /app/src/server/db
COPY package.json /app/

# Copy configuration files
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY entrypoint.sh /entrypoint.sh
COPY scripts /app/scripts
RUN chmod +x /entrypoint.sh && (chmod +x /app/scripts/*.sh 2>/dev/null || true)

# Environment variables
ENV DISPLAY=:5
ENV VNC_PASSWORD=obsidian
ENV SCREEN_RESOLUTION=1280x720x24
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Chrome/Chromium paths for puppeteer-core
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV CHROMIUM_PROFILE_PATH=/data/chromium-profile

# Expose VNC and Next.js ports
EXPOSE 5900 3000

# Set entrypoint
ENTRYPOINT ["/entrypoint.sh"]
