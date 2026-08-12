#!/usr/bin/env bash
# Rebuilds the repository sample used in evaluation/repository-sample.md.
#
# The clones themselves are not archived, because the commit hashes are: a repo
# re-cloned here is either byte-identical to the one measured, or the check below
# fails and tells you the upstream tag moved. That is a stronger record than a
# stored copy, and it is the same property the system itself is built on.
#
#   ./sample-clone.sh [target-dir]      default: ./sample
#
# Roughly 1.2 GB and several minutes on a normal connection.
set -uo pipefail

TARGET="${1:-./sample}"
mkdir -p "$TARGET"

# repo <tab> tag <tab> expected commit, exactly as measured on 2026-08-12
read -r -d '' SAMPLE <<'EOF'
spf13/cobra	v1.10.2	88b30ab89da2d0d0abb153818746c5a2d30eccec
psf/requests	v2.34.2	6e83187b8feb273ed4c6cdab5efd8d54901dfab3
pallets/click	8.4.2	b2e30a175449cfda909ee4fbf4a29a6a071cad53
junegunn/fzf	v0.74.2	3337be9d450cd349e99273a2d3985ceaf5f3753f
BurntSushi/ripgrep	14.1.1	4649aa9700619f94cf9c66876e9549d83420e16c
expressjs/express	v4.22.2	df0abc9333a3398b97b71f6ea7cd77d5ea3e9f97
axios/axios	v1.19.0	311fcc5c8d989b7248f05d390bb83bfbfb009977
sharkdp/bat	v0.26.1	979ba22628bc9d8171f2cffca2bd5c90c9fc0a9e
libarchive/libarchive	v3.8.9	27cbc7827172698143e440801fc0ba39ccb4f1f5
godotengine/godot-demo-projects	4.7-6ad6167	6ad6167e0577fe3622c18546138f456b107ce93c
curl/curl	curl-8_16_0	11b991232fbcaa88e2b1faecac224416b0001e35
microsoft/fluentui-system-icons	1.1.335	0a92ff83f03fa5319edaf0e2b2a09e460b69091a
EOF

drift=0
while IFS=$'\t' read -r repo tag expected; do
  [ -z "$repo" ] && continue
  dir="$TARGET/$(echo "$repo" | tr '/' '_')"
  if [ ! -d "$dir" ]; then
    printf 'cloning %s@%s\n' "$repo" "$tag"
    git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$tag" \
      "https://github.com/$repo" "$dir" || {
      printf '  FAILED to clone %s\n' "$repo"; drift=1; continue; }
  fi
  actual=$(git -C "$dir" rev-parse HEAD)
  if [ "$actual" = "$expected" ]; then
    printf '  ok       %s %s\n' "$repo" "$actual"
  else
    printf '  MOVED    %s\n           expected %s\n           got      %s\n' "$repo" "$expected" "$actual"
    drift=1
  fi
done <<< "$SAMPLE"

if [ "$drift" -ne 0 ]; then
  echo
  echo "At least one tag no longer points where it did on 2026-08-12."
  echo "That is worth investigating rather than working around: a moved release tag"
  echo "is the tj-actions pattern, and it is precisely what this project detects."
  exit 1
fi
echo
echo "All 12 repositories match the measured commits."
