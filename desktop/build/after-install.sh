#!/bin/bash
APP_DIR=/opt/Musix
EXEC=musix

if type update-alternatives >/dev/null 2>&1; then
  if [ -L "/usr/bin/$EXEC" ] && [ -e "/usr/bin/$EXEC" ] && [ "$(readlink "/usr/bin/$EXEC")" != "/etc/alternatives/$EXEC" ]; then
    rm -f "/usr/bin/$EXEC"
  fi
  update-alternatives --install "/usr/bin/$EXEC" "$EXEC" "$APP_DIR/$EXEC" 100 || ln -sf "$APP_DIR/$EXEC" "/usr/bin/$EXEC"
else
  ln -sf "$APP_DIR/$EXEC" "/usr/bin/$EXEC"
fi

if [ -f "$APP_DIR/chrome-sandbox" ]; then
  chown root:root "$APP_DIR/chrome-sandbox"
  chmod 4755 "$APP_DIR/chrome-sandbox"
fi

if [ -d /etc/apparmor.d ] && [ -f /etc/apparmor.d/abi/4.0 ] && command -v apparmor_parser >/dev/null 2>&1; then
  cat > /etc/apparmor.d/musix <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>

profile musix /opt/Musix/musix flags=(unconfined) {
  userns,

  include if exists <local/musix>
}
PROFILE
  apparmor_parser --replace --write-cache --skip-read-cache /etc/apparmor.d/musix || true
fi

if command -v update-mime-database >/dev/null 2>&1; then
  update-mime-database /usr/share/mime || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi

exit 0
