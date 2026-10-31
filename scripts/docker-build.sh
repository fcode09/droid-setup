#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# A fresh output directory prevents overwriting a previous build's evidence.
output_dir="${project_root}/artifacts/linux-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p -- "$output_dir"

docker build \
  --platform linux/amd64 \
  --target artifacts \
  --output "type=local,dest=${output_dir}" \
  --file "${project_root}/Dockerfile" \
  "$project_root"

printf 'Linux artifacts: %s\n' "$output_dir"
printf 'Verify before use: cd "%s" && sha256sum -c SHA256SUMS\n' "$output_dir"
