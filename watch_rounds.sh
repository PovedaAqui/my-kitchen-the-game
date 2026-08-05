#!/usr/bin/env bash
# Watch ONE room across several auto-looped rounds and record the ingredient
# order each round, to prove it re-randomizes every round (not just per room).
BASE="https://my-kitchen-the-game.vercel.app"
ROUNDS_TO_CAPTURE=4

C=$(curl -s -X POST "$BASE/api/create" | grep -o '"code":"[^"]*"' | cut -d'"' -f4)
P=$(curl -s -X POST "$BASE/api/join" -H "Content-Type: application/json" -d "{\"code\":\"$C\",\"name\":\"Watcher\"}" | grep -o '"playerId":"[^"]*"' | cut -d'"' -f4)
echo "room=$C player=$P"

captured=0
lastorder=""
declare -a orders
end=$((SECONDS + 300))   # 5 min safety cap

while [ $captured -lt $ROUNDS_TO_CAPTURE ] && [ $SECONDS -lt $end ]; do
  S=$(curl -s "$BASE/api/state?code=$C&playerId=$P")   # poll doubles as heartbeat
  PH=$(echo "$S" | grep -o '"phase":"[^"]*"' | cut -d'"' -f4)
  ORD=$(echo "$S" | grep -o '"order":\[[0-9,]*\]')

  if [ "$PH" = "playing" ]; then
    if [ "$ORD" != "$lastorder" ] && [ -n "$ORD" ]; then
      captured=$((captured+1))
      orders[$captured]="$ORD"
      echo "round $captured: $ORD"
      lastorder="$ORD"
    fi
    # Auto-cook all steps in this round's order to end the round fast.
    IDS=$(echo "$ORD" | grep -o '[0-9]\+')
    for s in $IDS; do
      curl -s -X POST "$BASE/api/tap" -H "Content-Type: application/json" -d "{\"code\":\"$C\",\"playerId\":\"$P\",\"stepId\":$s}" >/dev/null
    done
  fi
  sleep 2
done

echo "--- RESULT ---"
uniq_count=$(printf "%s\n" "${orders[@]:1}" | sort -u | wc -l)
echo "captured $captured rounds, $uniq_count distinct orders"
if [ "$captured" -ge 2 ] && [ "$uniq_count" -ge 2 ]; then
  echo "PASS: order is randomized each round"
else
  echo "FAIL: orders did not vary across rounds"
fi