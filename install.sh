#!/bin/bash

# SaungStream Automatic Installation Script
# For Ubuntu/Debian

echo "Starting SaungStream Installation..."

# 1. Update System
echo "Updating system packages..."
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js 18
echo "Installing Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Install FFmpeg
echo "Installing FFmpeg..."
sudo apt install -y ffmpeg

# 4. Install Git
echo "Installing Git..."
sudo apt install -y git

# 5. Install PM2
echo "Installing PM2..."
sudo npm install -g pm2

# 6. Install Dependencies
echo "Installing project dependencies..."
npm install

# 7. Setup Environment
if [ ! -f .env ]; then
    echo "Creating .env file from .env.example..."
    cp .env.example .env
fi

# 8. Build Application
echo "Building the application..."
npm run build

# 9. Start with PM2
echo "Starting application with PM2..."
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup

echo "--------------------------------------------------"
echo "Installation Complete!"
echo "Default Credentials: admin / admin"
echo "To expose to internet using Cloudflare Tunnel, follow the README guide."
echo "--------------------------------------------------"
