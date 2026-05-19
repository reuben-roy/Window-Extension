#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MAPPING_PATH="$ROOT_DIR/docs/learning-textbooks.json"
OUTPUT_ROOT="$ROOT_DIR/backend/data/learning/raw"
LIMIT=""
TOPIC_FILTER=""
SUBTOPIC_FILTER=""
FORCE="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --limit)
      LIMIT="${2:-}"
      shift 2
      ;;
    --topic)
      TOPIC_FILTER="${2:-}"
      shift 2
      ;;
    --subtopic)
      SUBTOPIC_FILTER="${2:-}"
      shift 2
      ;;
    --force)
      FORCE="1"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

mkdir -p "$OUTPUT_ROOT"

make_jobs() {
  export MAPPING_PATH LIMIT TOPIC_FILTER SUBTOPIC_FILTER
  node <<'EOF'
const fs = require('fs');
const mapping = JSON.parse(fs.readFileSync(process.env.MAPPING_PATH, 'utf8'));
const limit = process.env.LIMIT ? Number(process.env.LIMIT) : null;
const topicFilter = process.env.TOPIC_FILTER || null;
const subtopicFilter = process.env.SUBTOPIC_FILTER || null;

function slugify(value) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function matchesFilter(filter, value) {
  if (!filter) return true;
  return filter === value || slugify(filter) === slugify(value);
}

const rows = [];
for (const [parentTopic, subtopics] of Object.entries(mapping.topics)) {
  if (!matchesFilter(topicFilter, parentTopic)) continue;
  for (const [subtopic, books] of Object.entries(subtopics)) {
    if (!matchesFilter(subtopicFilter, subtopic)) continue;
    for (const book of books) {
      const slug = slugify(`${parentTopic}-${subtopic}-${book.title}`);
      rows.push([
        parentTopic,
        subtopic,
        book.title,
        book.url,
        book.fit,
        slug
      ].join('\t'));
    }
  }
}

for (const row of (limit ? rows.slice(0, limit) : rows)) {
  console.log(row);
}
EOF
}

discover_download_candidate() {
  local html_path="$1"
  node - "$html_path" <<'EOF'
const fs = require('fs');
const htmlPath = process.argv[2];
const html = fs.readFileSync(htmlPath, 'utf8');
const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
let best = null;
for (const match of html.matchAll(anchorPattern)) {
  const href = match[1] || '';
  const label = (match[2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const haystack = `${href} ${label}`.toLowerCase();
  let score = 0;
  if (haystack.includes('pdf')) score += 10;
  if (haystack.includes('download')) score += 8;
  if (haystack.includes('textbook')) score += 4;
  if (haystack.includes('book')) score += 3;
  if (haystack.includes('answer')) score -= 8;
  if (haystack.includes('instructor')) score -= 10;
  if (score <= 0) continue;
  if (!best || score > best.score) best = { href, label, score };
}
if (best) {
  console.log(JSON.stringify(best));
}
EOF
}

json_escape() {
  node -e 'console.log(JSON.stringify(process.argv[1]))' "$1"
}

download_one() {
  local parent_topic="$1"
  local subtopic="$2"
  local title="$3"
  local url="$4"
  local fit="$5"
  local slug="$6"

  local dir="$OUTPUT_ROOT/$slug"
  local manifest_path="$dir/manifest.json"
  local headers_path="$dir/headers.txt"
  local tmp_path="$dir/source.tmp"

  mkdir -p "$dir"

  if [[ "$FORCE" != "1" && -f "$manifest_path" ]]; then
    printf '{"title":%s,"status":"skipped_existing","outputDir":%s}\n' \
      "$(json_escape "$title")" \
      "$(json_escape "$dir")"
    return
  fi

  if ! curl -sSL -D "$headers_path" -o "$tmp_path" "$url"; then
    printf '{\n  "parentTopic": %s,\n  "subtopic": %s,\n  "title": %s,\n  "sourceUrl": %s,\n  "fit": %s,\n  "outputDir": %s,\n  "status": "failed"\n}\n' \
      "$(json_escape "$parent_topic")" \
      "$(json_escape "$subtopic")" \
      "$(json_escape "$title")" \
      "$(json_escape "$url")" \
      "$(json_escape "$fit")" \
      "$(json_escape "$dir")" > "$manifest_path"
    printf '{"title":%s,"status":"failed","outputDir":%s}\n' \
      "$(json_escape "$title")" \
      "$(json_escape "$dir")"
    rm -f "$tmp_path"
    return
  fi

  local content_type
  content_type="$(grep -i '^content-type:' "$headers_path" | tail -n 1 | sed 's/^[^:]*:[[:space:]]*//' | tr -d '\r')"

  if [[ "$content_type" =~ application/pdf|application/epub\+zip|application/zip|application/octet-stream ]]; then
    local ext=".bin"
    if [[ "$content_type" == *pdf* ]]; then ext=".pdf"; fi
    if [[ "$content_type" == *epub* ]]; then ext=".epub"; fi
    local final_path="$dir/source$ext"
    mv "$tmp_path" "$final_path"
    local file_sha
    local file_bytes
    file_sha="$(shasum -a 256 "$final_path" | awk '{print $1}')"
    file_bytes="$(wc -c < "$final_path" | tr -d ' ')"
    printf '{\n  "parentTopic": %s,\n  "subtopic": %s,\n  "title": %s,\n  "sourceUrl": %s,\n  "fit": %s,\n  "outputDir": %s,\n  "status": "downloaded_binary",\n  "binary": {\n    "path": %s,\n    "contentType": %s,\n    "sha256": %s,\n    "bytes": %s\n  }\n}\n' \
      "$(json_escape "$parent_topic")" \
      "$(json_escape "$subtopic")" \
      "$(json_escape "$title")" \
      "$(json_escape "$url")" \
      "$(json_escape "$fit")" \
      "$(json_escape "$dir")" \
      "$(json_escape "$final_path")" \
      "$(json_escape "$content_type")" \
      "$(json_escape "$file_sha")" \
      "$file_bytes" > "$manifest_path"
    printf '{"title":%s,"status":"downloaded_binary","outputDir":%s}\n' \
      "$(json_escape "$title")" \
      "$(json_escape "$dir")"
    return
  fi

  local html_path="$dir/landing-page.html"
  mv "$tmp_path" "$html_path"
  local file_sha
  file_sha="$(shasum -a 256 "$html_path" | awk '{print $1}')"
  local candidate_json=""
  candidate_json="$(discover_download_candidate "$html_path" || true)"

  {
    printf '{\n'
    printf '  "parentTopic": %s,\n' "$(json_escape "$parent_topic")"
    printf '  "subtopic": %s,\n' "$(json_escape "$subtopic")"
    printf '  "title": %s,\n' "$(json_escape "$title")"
    printf '  "sourceUrl": %s,\n' "$(json_escape "$url")"
    printf '  "fit": %s,\n' "$(json_escape "$fit")"
    printf '  "outputDir": %s,\n' "$(json_escape "$dir")"
    printf '  "status": "saved_html_only",\n'
    printf '  "landingPage": {\n'
    printf '    "path": %s,\n' "$(json_escape "$html_path")"
    printf '    "contentType": %s,\n' "$(json_escape "$content_type")"
    printf '    "sha256": %s\n' "$(json_escape "$file_sha")"
    printf '  }'
    if [[ -n "$candidate_json" ]]; then
      printf ',\n  "discoveredLinkCandidate": %s\n' "$candidate_json"
    else
      printf '\n'
    fi
    printf '}\n'
  } > "$manifest_path"

  printf '{"title":%s,"status":"saved_html_only","outputDir":%s}\n' \
    "$(json_escape "$title")" \
    "$(json_escape "$dir")"
}

count_total=0
count_downloaded_binary=0
count_saved_html_only=0
count_skipped_existing=0
count_failed=0

while IFS=$'\t' read -r parent_topic subtopic title url fit slug; do
  [[ -z "${title:-}" ]] && continue
  result="$(download_one "$parent_topic" "$subtopic" "$title" "$url" "$fit" "$slug")"
  echo "$result"
  status="$(printf '%s' "$result" | tail -n 1 | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')"
  count_total=$((count_total + 1))
  case "$status" in
    downloaded_binary) count_downloaded_binary=$((count_downloaded_binary + 1)) ;;
    saved_html_only) count_saved_html_only=$((count_saved_html_only + 1)) ;;
    skipped_existing) count_skipped_existing=$((count_skipped_existing + 1)) ;;
    failed) count_failed=$((count_failed + 1)) ;;
  esac
done < <(make_jobs)

cat <<EOF
{
  "summary": {
    "total": $count_total,
    "downloaded_binary": $count_downloaded_binary,
    "saved_html_only": $count_saved_html_only,
    "skipped_existing": $count_skipped_existing,
    "failed": $count_failed
  }
}
EOF
