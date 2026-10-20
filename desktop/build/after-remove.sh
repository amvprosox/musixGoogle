#!/bin/bash
APP_DIR=/opt/Musix
EXEC=musix

case "$1" in
  remove|purge)
    if type update-alternatives >/dev/null 2>&1; then
      update-alternatives --remove "$EXEC" "$APP_DIR/$EXEC" || true
    fi
    if [ -L "/usr/bin/$EXEC" ] && [ ! -e "/usr/bin/$EXEC" ]; then
      rm -f "/usr/bin/$EXEC"
    fi
    if [ -f /etc/apparmor.d/musix ]; then
      if command -v apparmor_parser >/dev/null 2>&1; then
        apparmor_parser --remove /etc/apparmor.d/musix >/dev/null 2>&1 || true
      fi
      rm -f /etc/apparmor.d/musix
    fi
    if command -v update-desktop-database >/dev/null 2>&1; then
      update-desktop-database /usr/share/applications || true
    fi
    ;;
esac

exit 0
