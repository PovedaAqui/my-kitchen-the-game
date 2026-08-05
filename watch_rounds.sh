#!/usr/bin/env bash
# Watch ONE room across several auto-looped rounds and record the ingredient
# DISPLAY LAYOUT each round, to prove tile placement re-randomizes every round
# (play order is fixed 0..9; only the on-screen layout shuffles).
BASE="https://my-kitchen-the-game.vercel.app"
ROUNDS_TO_CAPTURE=4

C=$(curl -s -X POST "$BASE/api/create" | grep -o '"code":"[^"]*"' | cut -d'"' -f4)
P=$(curl -s -X POST "$BASE/api/join" -H "Content-Type: application/json" -d "{\"code\":\"$C\",\"name\":\"Watcher\"}" | grep -o '"playerId":"[^"]*"' | cut -d'"' -f4)
echo "room=$C player=$P"

captured=0
lastlayout=""
declare -a layouts
end=$((SECONDS + 300))   # 5 min safety cap

while [ $captured -lt $ROUNDS_TO_CAPTURE ] && [ $SECONDS -lt $end ]; do
  S=$(curl -s "$BASE/api/state?code=$C&playerId=$P")   # poll doubles as heartbeat
  PH=$(echo "$S" | grep -o '"phase":"[^"]*"' | cut -d'"' -f4)
  LAY=$(echo "$S" | grep -o '"layout":\[[0-9,]*\]')

  if [ "$PH" = "playing" ]; then
    if [ "$LAY" != "$lastlayout" ] && [ -n "$LAY" ]; then
      captured=$((captured+1))
      layouts[$captured]="$LAY"
      echo "round $captured layout: $LAY"
      lastlayout="$LAY"
    fi
    # Cook in the FIXED canonical order 0..9 to end the round fast.
    for s in 0 1 2 3 4 5 6 7 8 9; do
      curl -s -X POST "$BASE/api/tap" -H "Content-Type: application/json" -d "{\"code\":\"$C\",\"playerId\":\"$P\",\"stepId\":$s}" >/dev/null
    done
  fi
  sleep 2
done

echo "--- RESULT ---"
uniq_count=$(printf "%s\n" "${layouts[@]:1}" | sort -u | wc -l)
echo "captured $captured rounds, $uniq_count distinct layouts"
if [ "$captured" -ge 2 ] && [ "$uniq_count" -ge 2 ]; then
  echo "PASS: display layout is randomized each round"
else
  echo "FAIL: layouts did not vary across rounds"
fi