#!/bin/bash
set -euo pipefail
if [[ $# != 1 || ! -f "$1" || "$1" != *.dmg ]]; then
  echo 'Usage: bash scripts/notarize-macos.sh /path/to/Tingo.dmg' >&2
  exit 1
fi
dmg_path="$1"
profile="${TINGO_NOTARY_PROFILE:-tingo-notary}"
# The DMG must already be distribution-signed; never modify it after notarization except stapling.
codesign --verify --strict "$dmg_path"
xcrun notarytool submit "$dmg_path" --keychain-profile "$profile" --wait --output-format json > "${dmg_path}.notary.json"
python3 - "${dmg_path}.notary.json" <<'PY'
import json, sys
result = json.load(open(sys.argv[1]))
print('Notarization:', result.get('status'), 'Submission:', result.get('id'))
if result.get('status') != 'Accepted':
    sys.exit('Not accepted. Retrieve the submission log with xcrun notarytool log <id> --keychain-profile tingo-notary.')
PY
xcrun stapler staple "$dmg_path"
xcrun stapler validate "$dmg_path"
spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg_path"
shasum -a 256 "$dmg_path"
