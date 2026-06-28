#!/usr/bin/env sh
# Container deploy smoke (task C12): build the image, run it, poll the read + write surfaces,
# then SIGTERM and assert a GRACEFUL (exit 0) shutdown — which verifies main.ts's stop()
# wiring. Runs in CI (job `deploy-smoke`) and locally where docker is available. Needs docker.
set -eu

IMAGE="vouch-node:smoke"
NAME="vouch-smoke-$$"
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> build image"
docker build -f deploy/Dockerfile -t "$IMAGE" .

echo "==> run container"
docker run -d --name "$NAME" -p 8787:8787 -p 8788:8788 "$IMAGE"

echo "==> poll read /health (up to 60s)"
ok=0
i=0
while [ "$i" -lt 60 ]; do
  if curl -fsS http://localhost:8787/health >/dev/null 2>&1; then ok=1; break; fi
  i=$((i + 1))
  sleep 1
done
if [ "$ok" != 1 ]; then
  echo "FAIL: read server did not come up"
  docker logs "$NAME" || true
  exit 1
fi

echo "==> assert read /health + /metrics"
curl -fsS http://localhost:8787/health | grep -q '"ok":true' || { echo "FAIL: bad /health"; exit 1; }
curl -fsS http://localhost:8787/metrics | grep -q '"regions"' || { echo "FAIL: bad /metrics"; exit 1; }

echo "==> assert write stub /v1/transact → 501"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:8788/v1/transact -d '{"from":"a@umi","to":"b@umi","amount":1}')
[ "$code" = 501 ] || { echo "FAIL: expected 501 from write stub, got $code"; exit 1; }

echo "==> SIGTERM → graceful shutdown"
docker stop -t 10 "$NAME" >/dev/null      # `docker stop` sends SIGTERM (then SIGKILL after -t)
exit_code=$(docker inspect -f '{{.State.ExitCode}}' "$NAME")
echo "container exit code: $exit_code"
[ "$exit_code" = 0 ] || { echo "FAIL: non-graceful shutdown (exit $exit_code → likely SIGKILL)"; exit 1; }

echo "✓ deploy smoke passed"
