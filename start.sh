#!/bin/bash

echo ""
echo "TrailWright QA - Starting..."
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed."
    echo ""
    echo "Please install Node.js:"
    echo "  macOS:   brew install node"
    echo "  Ubuntu:  sudo apt install nodejs npm"
    echo "  Or download from: https://nodejs.org/"
    echo ""
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "Failed to install dependencies."
        exit 1
    fi
fi

# Check if server/client dependencies are installed
if [ ! -d "server/node_modules" ]; then
    echo "Running first-time setup..."
    npm run setup
    if [ $? -ne 0 ]; then
        echo "Failed to run setup."
        exit 1
    fi
fi

# Check if Playwright browsers are installed
if [ ! -d "$HOME/.cache/ms-playwright" ]; then
    echo "Installing Playwright browsers..."
    cd server
    npx playwright install chromium
    cd ..
fi

echo ""
echo "Starting TrailWright QA..."
echo ""
echo "Once started, open http://localhost:3000 in your browser."
echo "Press Ctrl+C to stop."
echo ""

npm run dev
