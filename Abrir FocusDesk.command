#!/bin/zsh

cd -- "$(dirname -- "$0")" || exit 1

if curl -fsS http://localhost:3000/ >/dev/null 2>&1; then
  open http://localhost:3000/
  exit 0
fi

npm run dev &
FOCUSDESK_PID=$!

for attempt in {1..30}; do
  if curl -fsS http://localhost:3000/ >/dev/null 2>&1; then
    open http://localhost:3000/
    wait "$FOCUSDESK_PID"
    exit $?
  fi
  sleep 1
done

echo "FocusDesk no pudo iniciarse. Puedes cerrar esta ventana e intentarlo de nuevo."
kill "$FOCUSDESK_PID" 2>/dev/null
exit 1
