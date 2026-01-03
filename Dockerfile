FROM ubuntu:22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install required packages
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
    && rm -rf /var/lib/apt/lists/*

# Set Obsidian version - can be overridden at build time
ARG OBSIDIAN_VERSION=1.7.7

# Download and install Obsidian
RUN wget -q "https://github.com/obsidianmd/obsidian-releases/releases/download/v${OBSIDIAN_VERSION}/obsidian_${OBSIDIAN_VERSION}_amd64.deb" -O /tmp/obsidian.deb \
    && dpkg -i /tmp/obsidian.deb || apt-get install -f -y \
    && rm /tmp/obsidian.deb

# Create non-root user for running Obsidian
RUN useradd -m -s /bin/bash obsidian

# Create directories for VNC password and vault storage
RUN mkdir -p /home/obsidian/.vnc \
    && mkdir -p /home/obsidian/vault \
    && mkdir -p /home/obsidian/.config/obsidian \
    && chown -R obsidian:obsidian /home/obsidian

# Copy configuration files
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Environment variables
ENV DISPLAY=:5
ENV VNC_PASSWORD=obsidian
ENV SCREEN_RESOLUTION=1280x720x24

# Expose VNC port
EXPOSE 5900

# Volume for vault storage and Obsidian config
VOLUME ["/home/obsidian/vault", "/home/obsidian/.config/obsidian"]

# Set entrypoint
ENTRYPOINT ["/entrypoint.sh"]
