# SaungStream - Video Streaming Management System

A robust video streaming management system built with React, Express, and SQLite.

## Features

- **Media Library**: Upload and manage videos, including thumbnails and duration extraction.
- **External Link Uploads**: Download media from Google Drive, Dropbox, Mega, and MediaFire.
- **Playlists**: Create and organize video playlists.
- **Live Streams**: Manage live stream configurations.
- **Scheduler**: Schedule streams with flexible repeat options.
- **User Management**: Admin-level user control, including roles, status, and storage limits.
- **Profile Customization**: Users can change usernames, passwords, and upload profile pictures.
- **System Monitoring**: Real-time CPU and disk space monitoring.

## Quick Installation (Recommended)

For a fresh Linux server (Ubuntu/Debian), you can use the automatic installation script:

```bash
chmod +x install.sh
./install.sh
```

This script will install Node.js, FFmpeg, Git, PM2, and set up the project for you.

## Linux Server Installation Guide (Manual)

### 1. Update System Packages
```bash
sudo apt update && sudo apt upgrade -y
```

### 2. Install Node.js
We recommend using Node.js 18.x or later.
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

### 3. Verify Node.js and NPM Installation
```bash
node -v
npm -v
```

### 4. Install FFmpeg
FFmpeg is required for video processing and thumbnail generation.
```bash
sudo apt install -y ffmpeg
```

### 5. Install Git
```bash
sudo apt install -y git
```

### 6. Setup Project
Clone the repository and install dependencies.
```bash
git clone https://github.com/acnudesign/SaungStream
cd SaungStream
npm install
npm run build
```

### 7. Configure Environment Variables
Create a `.env` file in the root directory and add your configuration.
```bash
cp .env.example .env
# Edit .env with your preferred editor
nano .env
```

### 8. Build the Application
```bash
npm run build
```

### 9. Install Process Manager (PM2)
PM2 ensures your application runs continuously and restarts automatically if it crashes.
```bash
sudo npm install -y pm2 -g
```

### 10. Run the Application with PM2
```bash
# Start the server using npm (most reliable across Windows/Linux)
pm2 start npm --name saungstream -- run start

# Alternatively, using an ecosystem file (recommended for Windows)
# pm2 start ecosystem.config.cjs

# Save the PM2 process list
pm2 save

# Setup PM2 to start on boot (follow the instructions it provides)
pm2 startup
```

### 11. Useful PM2 Commands
- `pm2 status`: Check the status of your application.
- `pm2 logs saungstream`: View real-time logs.
- `pm2 restart saungstream`: Restart the application.
- `pm2 stop saungstream`: Stop the application.

## Exposing to Internet with Cloudflare Tunnel

To make your local server accessible from the internet securely, we recommend using **Cloudflare Tunnel**.

### 1. Install Cloudflared
```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
```

### 2. Authenticate Cloudflared
```bash
cloudflared tunnel login
```

### 3. Create a Tunnel
```bash
cloudflared tunnel create saungstream
```

### 4. Configure the Tunnel
Create a configuration file or use the Cloudflare Dashboard to point your domain to `http://localhost:3000`.

### 5. Run with PM2
We have included a Cloudflare configuration in `ecosystem.config.cjs`. You can start it using:
```bash
pm2 start cloudflared
```
*Note: Make sure to update your tunnel name or ID in `ecosystem.config.cjs` if you use this method, or just run `cloudflared tunnel run saungstream` manually.*

## Default Credentials
- **Username**: admin
- **Password**: admin

## License
MIT
