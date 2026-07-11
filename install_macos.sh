#!/usr/bin/env bash

set -euo pipefail

REPO="aronpc/ai-traffic-lights"
APP_TITLE="AI Traffic Lights"
APP_NAME="AI Traffic Lights.app"
DMG_NAME="AI-Traffic-Lights.dmg"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"

info() { printf '\033[1;34m›\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m⚠️\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

OS="$(uname -s)"
ARCH="$(uname -m)"

if [ "$OS" != "Darwin" ]; then
  die "Este instalador é exclusivo para macOS. SO atual: $OS"
fi

if [ "$ARCH" != "arm64" ]; then
  warn "Sua arquitetura é $ARCH. Este build é otimizado para Apple Silicon (M1, M2, M3, M4, M5)."
fi

if ! command -v brew >/dev/null 2>&1; then
  die "Homebrew não encontrado. Por favor, instale o Homebrew em https://brew.sh e tente novamente."
fi

if ! command -v jq >/dev/null 2>&1; then
  info "Instalando dependência 'jq' via Homebrew..."
  brew install jq
  ok "'jq' instalado com sucesso."
else
  ok "'jq' já está instalado."
fi

info "Consultando a versão mais recente para macOS no GitHub..."
json=""
if ! json="$(curl -fsSL -H 'Accept: application/vnd.github+json' "$API_URL")"; then
  warn "Não foi possível conectar à API do GitHub."
fi

download_url=""
if [ -n "$json" ]; then
  download_url="$(printf '%s\n' "$json" | jq -r '.assets[] | select(.name | endswith(".dmg")) | .browser_download_url' | head -1 || true)"
  version="$(printf '%s\n' "$json" | jq -r '.tag_name | sub("^v"; "")' || true)"
fi

TMP_DIR="/tmp/ai-traffic-lights-install"
rm -rf "$TMP_DIR" && mkdir -p "$TMP_DIR"
DMG_PATH="$TMP_DIR/$DMG_NAME"

if [ -n "$download_url" ] && [ "$download_url" != "null" ]; then
  info "Baixando versão v${version} de: $download_url"
  curl -fSL --retry 3 -o "$DMG_PATH" "$download_url"
  ok "Download concluído."
  
  info "Montando instalador e copiando aplicativo para /Applications..."
  MOUNT_POINT="$TMP_DIR/mount"
  mkdir -p "$MOUNT_POINT"
  hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT_POINT" "$DMG_PATH"
  
  rm -rf "/Applications/${APP_NAME}.tmp"
  if cp -R "$MOUNT_POINT/$APP_NAME" "/Applications/${APP_NAME}.tmp"; then
    rm -rf "/Applications/$APP_NAME"
    mv "/Applications/${APP_NAME}.tmp" "/Applications/$APP_NAME"
    hdiutil detach "$MOUNT_POINT"
    ok "Aplicativo copiado para /Applications/$APP_NAME"
  else
    hdiutil detach "$MOUNT_POINT"
    die "Falha ao copiar o aplicativo para /Applications."
  fi
else
  warn "Nenhuma release .dmg oficial encontrada no repositório GitHub ainda."
  warn "Se você está compilando localmente, rode 'npm run dist' e copie o app para a pasta /Applications."
fi

LOCAL_REPO=""
if [ -f "package.json" ] && grep -q '"name": "ai-traffic-lights"' package.json; then
  LOCAL_REPO="$(pwd)"
fi

if [ -n "$LOCAL_REPO" ]; then
  if ! command -v npm >/dev/null 2>&1; then
    die "Instalação em modo desenvolvimento detectada, mas 'npm' não foi encontrado. Por favor, instale o Node.js e tente novamente."
  fi
  info "Executando em modo desenvolvimento. Instalando dependências do Node.js..."
  (cd "$LOCAL_REPO" && npm install)
  ok "Dependências do Node.js instaladas."
fi

info "Configurando aliases para inicialização rápida..."

if [ -n "$LOCAL_REPO" ]; then
  ALIAS_LINE_1="alias atl=\"[ -d '/Applications/AI Traffic Lights.app' ] && open -a '$APP_TITLE' || npm start --prefix '$LOCAL_REPO'\""
  ALIAS_LINE_2="alias ai-traffic-lights=\"[ -d '/Applications/AI Traffic Lights.app' ] && open -a '$APP_TITLE' || npm start --prefix '$LOCAL_REPO'\""
else
  ALIAS_LINE_1="alias atl=\"open -a '$APP_TITLE'\""
  ALIAS_LINE_2="alias ai-traffic-lights=\"open -a '$APP_TITLE'\""
fi

setup_profile_aliases() {
  local profile="$1"
  if [ -f "$profile" ]; then
    sed -i '' '/alias atl=/d' "$profile" 2>/dev/null || true
    sed -i '' '/alias ai-traffic-lights=/d' "$profile" 2>/dev/null || true
    
    echo "" >> "$profile"
    echo "$ALIAS_LINE_1" >> "$profile"
    echo "$ALIAS_LINE_2" >> "$profile"
    ok "Aliases adicionados em: $profile"
  fi
}

setup_profile_aliases "$HOME/.zshrc"
setup_profile_aliases "$HOME/.bash_profile"

printf '\n\033[1;32m✓ Configuração concluída!\033[0m\n\n'
cat <<EOF
  Para iniciar o app pelo terminal agora, abra uma nova aba ou execute:
    source ~/.zshrc
  
  Em seguida, você pode iniciar executando:
    atl

  Para habilitar o monitoramento de sessões do Claude Code, Antigravity, etc:
    Abra o aplicativo, clique no ícone da engrenagem (Preferências) e escolha "Instalar/atualizar hooks".
EOF
