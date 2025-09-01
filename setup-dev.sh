#!/bin/bash
# Podium GUI Development Setup

echo "🎭 Setting up Podium GUI development environment..."

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 16+ first."
    echo "Visit: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js found: $(node --version)"

# Check for npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm not found. Please install npm first."
    exit 1
fi

echo "✅ npm found: $(npm --version)"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -eq 0 ]; then
    echo "✅ Dependencies installed successfully!"
    echo ""
    echo "🚀 Development commands:"
    echo "  npm run dev     - Run in development mode"
    echo "  npm run build   - Build for production"
    echo "  npm start       - Run built application"
    echo ""
    echo "🎯 Ready to develop! Run 'npm run dev' to start."
else
    echo "❌ Failed to install dependencies"
    exit 1
fi
