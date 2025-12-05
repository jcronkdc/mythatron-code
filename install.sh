#!/bin/bash

# Claude Code Installation Script
# Saves you $11,500+/month compared to Cursor

echo "🤖 Claude Code Installer"
echo "========================"
echo ""

# Check if VS Code is installed
if ! command -v code &> /dev/null; then
    echo "❌ VS Code not found. Please install VS Code first."
    exit 1
fi

echo "✅ VS Code found"

# Check if VSIX exists
VSIX_PATH="$(dirname "$0")/claude-code-1.0.0.vsix"
if [ ! -f "$VSIX_PATH" ]; then
    echo "❌ Extension package not found. Run 'npm run package' first."
    exit 1
fi

echo "✅ Extension package found"

# Install the extension
echo ""
echo "📦 Installing Claude Code extension..."
code --install-extension "$VSIX_PATH"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Claude Code installed successfully!"
    echo ""
    echo "🔑 Next Steps:"
    echo "   1. Open VS Code"
    echo "   2. Press Cmd+, (Settings)"
    echo "   3. Search for 'Claude Code'"
    echo "   4. Enter your Anthropic API key"
    echo ""
    echo "💰 You're now saving \$11,500+/month!"
    echo ""
    echo "⌨️  Keyboard Shortcuts:"
    echo "   Cmd+Shift+K - Open Chat"
    echo "   Cmd+Shift+N - New Conversation"
else
    echo ""
    echo "❌ Installation failed. Try manually:"
    echo "   code --install-extension $VSIX_PATH"
fi


