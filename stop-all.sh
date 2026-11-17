#!/usr/bin/env bash
# Prowosma - stop everything start-all.sh started (macOS / Linux). A MongoDB you started yourself is left running.
ROOT="$(cd "$(dirname "$0")" && pwd)"; RUN="$ROOT/.prowosma-run"
descendants() { local c; for c in $(pgrep -P "$1" 2>/dev/null); do echo "$c"; descendants "$c"; done; }
echo; echo "  Stopping Prowosma"
for name in frontend backend stt ollama mongod; do
  f="$RUN/$name.pid"; [ -f "$f" ] || continue
  pid=$(cat "$f")
  if kill -0 "$pid" 2>/dev/null; then
    tree=$(descendants "$pid")                                    # gradle -> java, npm -> node: stop the children too
    kill -TERM -- "-$pid" 2>/dev/null; kill -TERM $pid $tree 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -KILL -- "-$pid" 2>/dev/null; kill -KILL $pid $tree 2>/dev/null
    echo "  Stopped $name."
  fi
  rm -f "$f"
done
if [ -f "$RUN/mongo-docker" ]; then docker stop "$(cat "$RUN/mongo-docker")" >/dev/null && echo "  Stopped the MongoDB Docker container (data kept in the prowosma-mongo volume)."; rm -f "$RUN/mongo-docker"; fi
echo "  Done."; echo
