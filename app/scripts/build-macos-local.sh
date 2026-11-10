#!/bin/bash
# 本机构建并用固定的自签名证书签名。
#
# 默认的 ad-hoc 签名（signingIdentity "-"）让 macOS 按二进制哈希认 App，每次重新构建，
# 「完全磁盘访问」「麦克风」「录屏」等授权都会悄悄失效（设置里开关还开着，但对新版本不算数）。
# 换成固定证书后，系统按「Bundle ID + 证书」认 App，重新构建后授权依然有效。
#
# 证书放在单独的钥匙串里（默认 ~/.config/tingo-signing/local-codesign.keychain-db），
# 不碰登录钥匙串，也不改系统信任设置。
#
# 用法：bash scripts/build-macos-local.sh [--install] [其他 tauri build 参数]
#   --install  构建后替换 /Applications/Tingo.app（需要先退出 Tingo）
set -euo pipefail
cd "$(dirname "$0")/.."

signing_dir="${TINGO_LOCAL_SIGNING_DIR:-$HOME/.config/tingo-signing}"
keychain="$signing_dir/local-codesign.keychain-db"
password_file="$signing_dir/local-codesign.password"
name="Tingo Local Signing"
install=0
args=()
for arg in "$@"; do
  if [[ $arg == --install ]]; then install=1; else args+=("$arg"); fi
done

if [[ ! -f $keychain ]]; then
  echo "首次运行：生成本机签名证书「$name」" >&2
  mkdir -p "$signing_dir"
  chmod 700 "$signing_dir"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  (umask 077; /usr/bin/openssl rand -hex 24 > "$password_file")
  cat > "$tmp/cert.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $name
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
EOF
  # 系统自带的 LibreSSL 生成的 PEM 能直接被 security 导入，不受 Homebrew OpenSSL 版本影响
  /usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -config "$tmp/cert.cnf" -keyout "$tmp/key.pem" -out "$tmp/cert.pem" 2>/dev/null
  password="$(cat "$password_file")"
  security create-keychain -p "$password" "$keychain"
  security set-keychain-settings "$keychain"   # 不自动上锁
  security unlock-keychain -p "$password" "$keychain"
  security import "$tmp/key.pem" -k "$keychain" -T /usr/bin/codesign >/dev/null
  security import "$tmp/cert.pem" -k "$keychain" >/dev/null
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain" >/dev/null
fi

security unlock-keychain -p "$(cat "$password_file")" "$keychain"
identity="$(security find-identity -p codesigning "$keychain" | awk -v n="\"$name\"" 'index($0, n) {print $2; exit}')"
if [[ -z $identity ]]; then
  echo "钥匙串 $keychain 里找不到「$name」证书。删掉 $signing_dir 下的 local-codesign.* 后重跑可重新生成。" >&2
  exit 1
fi

# 先按默认配置 ad-hoc 构建，再整体换签名；不依赖钥匙串搜索列表
unset APPLE_SIGNING_IDENTITY APPLE_CERTIFICATE
if ! command -v pnpm >/dev/null; then
  # tauri.conf.json 的 beforeBuildCommand 是 pnpm build；没装 pnpm 时用 npm 跑同一个脚本
  args+=(--config '{"build":{"beforeBuildCommand":"npm run build"}}')
fi
if grep -q '^custom-protocol *=' src-tauri/Cargo.toml; then
  # main.rs 要求发布版打开本 crate 的 custom-protocol；tauri CLI 只开 tauri/custom-protocol
  args+=(--features custom-protocol)
fi
npm run tauri -- build --bundles app ${args[@]+"${args[@]}"}

app="src-tauri/target/release/bundle/macos/Tingo.app"
entitlements="src-tauri/Entitlements.plist"
# 由内到外：先签 Resources 里的录音组件，再签整个 App
codesign --force --keychain "$keychain" --sign "$identity" --options runtime \
  --identifier io.github.tancheng33.tingo.recorder --entitlements "$entitlements" \
  "$app/Contents/Resources/tingo-recorder"
codesign --force --keychain "$keychain" --sign "$identity" --options runtime \
  --entitlements "$entitlements" "$app"

requirement="identifier \"io.github.tancheng33.tingo\" and certificate leaf = H\"$identity\""
codesign --verify --deep --strict -R "=$requirement" "$app"
echo "已签名：$app"
echo "  $requirement"

if [[ $install == 1 ]]; then
  if pgrep -xq tingo; then
    echo "Tingo 正在运行，请先退出（⌘Q）再安装。新版本留在 $app。" >&2
    exit 1
  fi
  rm -rf /Applications/Tingo.app.new
  ditto "$app" /Applications/Tingo.app.new
  rm -rf /Applications/Tingo.app
  mv /Applications/Tingo.app.new /Applications/Tingo.app
  echo "已安装到 /Applications/Tingo.app"
fi

cat <<EOF

第一次从 ad-hoc 签名换成本机证书时，需要重新授权一次：
  系统设置 → 隐私与安全性 → 完全磁盘访问权限，选中 Tingo 点「−」删掉，再点「+」加回 /Applications/Tingo.app。
之后用这个脚本重新构建，授权会一直有效。
EOF
