#!/bin/bash
# Bridgeboard for Mac with fake data (no sign-in): start.command with --demo,
# so choosing Node.js is written once.
case "$0" in */*) cd "${0%/*}" || exit 1 ;; esac
exec "$BASH" ./start.command --demo "$@"
