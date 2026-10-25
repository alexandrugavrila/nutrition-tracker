#!/usr/bin/env bash
# Shared helpers for the production Docker Compose stack.

set -euo pipefail

prod_repo_root() {
  (
    cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd
  )
}

prod_compose_file() {
  printf '%s/%s\n' "$(prod_repo_root)" "docker-compose.prod.yml"
}

prod_env_file() {
  printf '%s/%s\n' "$(prod_repo_root)" ".env.production"
}

prod_require_file() {
  local path=$1
  [[ -f "$path" ]] || {
    echo "Required file not found: $path" >&2
    return 1
  }
}

prod_compose() {
  local repo_root compose_file env_file
  repo_root="$(prod_repo_root)"
  compose_file="$(prod_compose_file)"
  env_file="$(prod_env_file)"
  prod_require_file "$compose_file"
  prod_require_file "$env_file"

  (
    cd "$repo_root"
    docker compose --env-file "$env_file" -f "$compose_file" "$@"
  )
}

prod_get_env_value() {
  local key=$1
  local env_file
  env_file="$(prod_env_file)"
  prod_require_file "$env_file"

  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      "$key"=*)
        printf '%s\n' "${line#*=}"
        return 0
        ;;
    esac
  done <"$env_file"

  echo "Required key '$key' was not found in $env_file" >&2
  return 1
}

prod_set_env_value() {
  local key=$1 value=$2
  local env_file tmp_file found=false
  env_file="$(prod_env_file)"
  prod_require_file "$env_file"
  tmp_file="$(mktemp)"

  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      "$key"=*)
        printf '%s=%s\n' "$key" "$value" >>"$tmp_file"
        found=true
        ;;
      *)
        printf '%s\n' "$line" >>"$tmp_file"
        ;;
    esac
  done <"$env_file"

  if [[ "$found" != true ]]; then
    printf '%s=%s\n' "$key" "$value" >>"$tmp_file"
  fi

  mv "$tmp_file" "$env_file"
}

prod_set_image_tag() {
  local image=$1 tag=$2
  local without_digest last_segment base

  without_digest="${image%%@*}"
  last_segment="${without_digest##*/}"
  base="$without_digest"
  if [[ "$last_segment" == *:* ]]; then
    base="${without_digest%:*}"
  fi

  printf '%s:%s\n' "$base" "$tag"
}

prod_wait_for_service() {
  local service=$1 timeout_seconds=${2:-180}
  local deadline=$((SECONDS + timeout_seconds))
  local container_id="" last_status="not-created"

  while (( SECONDS < deadline )); do
    container_id="$(prod_compose ps -q "$service" | tr -d '\r')"
    if [[ -n "$container_id" ]]; then
      last_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null | tr -d '\r')"
      if [[ "$last_status" == "healthy" || "$last_status" == "running" ]]; then
        return 0
      fi
    fi
    sleep 2
  done

  echo "Service '$service' did not become healthy within ${timeout_seconds}s. Last status: ${last_status:-unknown}" >&2
  return 1
}

prod_wait_for_http() {
  local url=$1 timeout_seconds=${2:-60}
  local deadline=$((SECONDS + timeout_seconds))

  while (( SECONDS < deadline )); do
    if curl -fsS --max-time 5 "$url" >/dev/null; then
      return 0
    fi
    sleep 2
  done

  echo "HTTP check failed for $url within ${timeout_seconds}s." >&2
  return 1
}

prod_http_port() {
  local value
  value="$(prod_get_env_value PROD_HTTP_PORT)"
  if [[ -z "$value" ]]; then
    printf '80\n'
  else
    printf '%s\n' "$value"
  fi
}

prod_backup_dir() {
  local path
  path="$(prod_repo_root)/Database/backups/production"
  mkdir -p "$path"
  printf '%s\n' "$path"
}

prod_resolve_dump_path() {
  local candidate=$1
  if [[ "$candidate" == *.meta.json ]]; then
    candidate="${candidate%.meta.json}"
  fi
  if [[ "$candidate" != /* && "$candidate" != [A-Za-z]:* ]]; then
    candidate="$(prod_repo_root)/$candidate"
  fi
  [[ -f "$candidate" ]] || {
    echo "Snapshot dump not found: $candidate" >&2
    return 1
  }
  printf '%s\n' "$candidate"
}

prod_snapshot_metadata_path() {
  local dump_path
  dump_path="$(prod_resolve_dump_path "$1")"
  printf '%s.meta.json\n' "$dump_path"
}

prod_metadata_value() {
  local meta_path=$1 key=$2 value
  value="$(grep -o "\"${key}\"[^\"]*\"[^\"]*\"" "$meta_path" 2>/dev/null | sed "s/.*\"${key}\"[^\"]*\"\\([^\"]*\\)\"/\\1/" | head -n 1)"
  printf '%s\n' "$value"
}

prod_git_commit() {
  local repo_root commit
  repo_root="$(prod_repo_root)"
  commit="$(git -C "$repo_root" rev-parse --short HEAD 2>/dev/null || true)"
  if [[ -n "$commit" ]]; then
    printf '%s\n' "$commit"
  else
    printf 'unknown\n'
  fi
}

prod_alembic_version() {
  local user password database value
  user="$(prod_get_env_value POSTGRES_USER)"
  password="$(prod_get_env_value POSTGRES_PASSWORD)"
  database="$(prod_get_env_value POSTGRES_DB)"

  value="$(prod_compose exec -T -e "PGPASSWORD=$password" db \
    psql -h localhost -U "$user" -d "$database" -Atc 'SELECT version_num FROM alembic_version LIMIT 1;' 2>/dev/null | tr -d '\r' || true)"
  if [[ -n "$value" ]]; then
    printf '%s\n' "$value"
  else
    printf 'unknown\n'
  fi
}

prod_run_migration() {
  echo "Running Alembic migrations against the production database..."
  prod_compose run --rm backend sh -lc 'cd /app/Backend && python -m alembic -c alembic.ini upgrade head'
}

prod_backup() {
  local label=${1:-manual}
  local sanitized_label timestamp base_name backup_dir dump_path meta_path temp_dump
  local user password database container_id alembic_version git_commit

  sanitized_label="$(printf '%s' "$label" | tr -cs 'A-Za-z0-9._-' '-')"
  sanitized_label="${sanitized_label#-}"
  sanitized_label="${sanitized_label%-}"
  if [[ -z "$sanitized_label" ]]; then
    sanitized_label="snapshot"
  fi

  timestamp="$(date +"%Y%m%d-%H%M%S")"
  base_name="production-${sanitized_label}-${timestamp}"
  backup_dir="$(prod_backup_dir)"
  dump_path="$backup_dir/$base_name.dump"
  meta_path="${dump_path}.meta.json"
  temp_dump="/tmp/${base_name}.dump"
  user="$(prod_get_env_value POSTGRES_USER)"
  password="$(prod_get_env_value POSTGRES_PASSWORD)"
  database="$(prod_get_env_value POSTGRES_DB)"

  echo "Creating production database snapshot..." >&2
  prod_compose up -d db >&2
  prod_wait_for_service db 180
  prod_compose exec -T -e "PGPASSWORD=$password" db \
    pg_dump --format=custom --no-owner --no-privileges -h localhost -U "$user" -d "$database" -f "$temp_dump" >&2

  container_id="$(prod_compose ps -q db | tr -d '\r')"
  [[ -n "$container_id" ]] || {
    echo "Could not resolve the production db container id." >&2
    return 1
  }

  docker cp "${container_id}:${temp_dump}" "$dump_path" >/dev/null
  prod_compose exec -T db sh -lc "rm -f '$temp_dump'" >/dev/null 2>&1 || true

  alembic_version="$(prod_alembic_version)"
  git_commit="$(prod_git_commit)"
  cat >"$meta_path" <<EOF
{
  "timestamp": "$timestamp",
  "label": "$sanitized_label",
  "dump_path": "$dump_path",
  "alembic_version": "$alembic_version",
  "git_commit": "$git_commit",
  "backend_image": "$(prod_get_env_value BACKEND_IMAGE)",
  "frontend_image": "$(prod_get_env_value FRONTEND_IMAGE)",
  "postgres_image": "$(prod_get_env_value POSTGRES_IMAGE)",
  "edge_image": "$(prod_get_env_value EDGE_IMAGE)"
}
EOF

  printf '%s\n' "$dump_path"
}

prod_restore() {
  local dump_path reset_schema=${2:-false}
  local resolved_dump temp_dump user password database container_id restore_status

  resolved_dump="$(prod_resolve_dump_path "$1")"
  temp_dump="/tmp/$(basename "$resolved_dump")"
  user="$(prod_get_env_value POSTGRES_USER)"
  password="$(prod_get_env_value POSTGRES_PASSWORD)"
  database="$(prod_get_env_value POSTGRES_DB)"

  prod_compose up -d db
  prod_wait_for_service db 180

  container_id="$(prod_compose ps -q db | tr -d '\r')"
  [[ -n "$container_id" ]] || {
    echo "Could not resolve the production db container id." >&2
    return 1
  }

  docker cp "$resolved_dump" "${container_id}:${temp_dump}"

  restore_status=0
  if [[ "$reset_schema" == true ]]; then
    echo "Resetting schema 'public' before restore..."
    set +e
    prod_compose exec -T -e "PGPASSWORD=$password" db \
      psql -h localhost -U "$user" -d "$database" -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
    restore_status=$?
    set -e
    if [[ $restore_status -ne 0 ]]; then
      prod_compose exec -T db sh -lc "rm -f '$temp_dump'" >/dev/null 2>&1 || true
      return $restore_status
    fi
  fi

  echo "Restoring production database from snapshot..."
  set +e
  prod_compose exec -T -e "PGPASSWORD=$password" db \
    pg_restore --clean --if-exists --no-owner --no-privileges -h localhost -U "$user" -d "$database" "$temp_dump"
  restore_status=$?
  set -e
  prod_compose exec -T db sh -lc "rm -f '$temp_dump'" >/dev/null 2>&1 || true
  return $restore_status
}

prod_wait_for_stack_ready() {
  local http_port
  prod_wait_for_service db 180
  prod_wait_for_service backend 240
  prod_wait_for_service frontend 180
  prod_wait_for_service edge 180

  http_port="$(prod_http_port)"
  echo "Running post-deploy HTTP checks on port $http_port..."
  prod_wait_for_http "http://127.0.0.1:${http_port}/healthz" 60
  prod_wait_for_http "http://127.0.0.1:${http_port}/api/health/ready" 60
}
