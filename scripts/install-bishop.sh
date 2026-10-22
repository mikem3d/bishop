#!/usr/bin/env bash
# Build the agent tools and put a `bishop` command on your PATH.
# Run from the repo: ./scripts/install-bishop.sh
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"

command -v node >/dev/null || { echo "Node.js 20+ is required: brew install node"; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || { echo "Node.js 20+ is required (found $(node -v))."; exit 1; }
command -v pnpm >/dev/null || { echo "Installing pnpm…"; corepack enable >/dev/null 2>&1 || npm install -g pnpm; }
command -v claude >/dev/null || echo "Warning: the claude command isn't on your PATH. Install Claude Code and sign in before running the agent."

pnpm install --frozen-lockfile
pnpm --filter @bishop/agent-kit build

# First writable bin folder already on PATH wins.
for dir in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin"; do
  if [ -d "$dir" ] && [ -w "$dir" ]; then BIN="$dir"; break; fi
done
if [ -z "${BIN:-}" ]; then BIN="$HOME/.local/bin"; mkdir -p "$BIN"; fi

cat > "$BIN/bishop" <<EOF
#!/usr/bin/env bash
exec "$(command -v node)" "$REPO/packages/agent-kit/dist/cli.js" "\$@"
EOF
chmod +x "$BIN/bishop"

echo
echo "Installed: $BIN/bishop"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "Add $BIN to your PATH, e.g.: echo 'export PATH=\"$BIN:\$PATH\"' >> ~/.zshrc";; esac
echo
echo "Next:"
echo "  bishop login                 # sign in (use the email you use in the phone app) and name this Mac"
echo "  cd ~/code/some-project && bishop link"
echo "  bishop install               # keep the agent running in the background"
