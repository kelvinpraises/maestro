#!/usr/bin/env bash
# One-command operator pass for a maestro network:
#   1. deploy.sh   (idempotent — skips if artifact unchanged + address recorded)
#   2. verify.sh   (on-chain end-to-end proof)
#   3. manual client-side checklist (printed, with exact routes and success criteria)
#
# Usage:
#   DEPLOY_NETWORK=sepolia DEPLOY_ACCOUNT=<profile> DRIPS_TOKEN_ADDRESS=0x... \
#     ./scripts/e2e.sh [--from-step N]
#
# --from-step N resumes at step N (1=deploy, 2=verify, 3=manual checklist).
# Steps 1–2 are idempotent, so resuming forward never replays paid txs.
set -euo pipefail

cd "$(dirname "$0")/.." # apps/contracts

NETWORK="${DEPLOY_NETWORK:-}"
PROFILE="${DEPLOY_ACCOUNT:-}"
TOKEN="${DRIPS_TOKEN_ADDRESS:-}"
FROM_STEP=1

while [[ $# -gt 0 ]]; do
	case "$1" in
	--from-step)
		FROM_STEP="$2"
		shift 2
		;;
	*) die "unknown argument: $1 (supported: --from-step N)" ;;
	esac
done

die() {
	echo "error: $*" >&2
	exit 1
}

[[ -n "$NETWORK" ]] || die "DEPLOY_NETWORK unset (sepolia|mainnet)"
case "$NETWORK" in
sepolia | mainnet) ;;
*) die "DEPLOY_NETWORK must be 'sepolia' or 'mainnet', got '$NETWORK'" ;;
esac
[[ "$FROM_STEP" =~ ^[1-3]$ ]] || die "--from-step must be 1, 2 or 3"

echo "== maestro e2e pass: $NETWORK =="

if [[ "$FROM_STEP" -le 1 ]]; then
	echo ""
	echo "== [step 1/3] deploy =="
	[[ -n "$PROFILE" ]] || die "DEPLOY_ACCOUNT unset (needed for deploy)"
	[[ -n "$TOKEN" ]] || die "DRIPS_TOKEN_ADDRESS unset (needed for deploy)"
	./scripts/deploy.sh
else
	echo "[skip] step 1 (deploy) — resuming from $FROM_STEP"
fi

if [[ "$FROM_STEP" -le 2 ]]; then
	echo ""
	echo "== [step 2/3] verify =="
	[[ -n "$PROFILE" ]] || die "DEPLOY_ACCOUNT unset (needed for verify)"
	VERIFY_NETWORK="$NETWORK" VERIFY_ACCOUNT="$PROFILE" DRIPS_TOKEN_ADDRESS="$TOKEN" \
		./scripts/verify.sh
else
	echo "[skip] step 2 (verify) — resuming from $FROM_STEP"
fi

CHAIN_TAG="$(echo "$NETWORK" | tr '[:lower:]' '[:upper:]')"
ADDR_LINE="$(grep -E "^DRIPS_ADDRESS=" "deployments.${NETWORK}.env" 2>/dev/null || true)"
RECORDED_ADDR="${ADDR_LINE#DRIPS_ADDRESS=}"

echo ""
echo "== [step 3/3] MANUAL client-side steps (cannot be scripted) =="
cat <<MANUAL

Prerequisites once per machine:
  cd apps/server && npm install
  cd apps/client && npm install
  echo 'VITE_ENABLE_DEV_MONEY=1' >> apps/client/.env.local
  # point the client at THIS deployment:
  echo "VITE_DRIPS_ADDRESS_${CHAIN_TAG}=${RECORDED_ADDR:-<run step 1 first>}" >> apps/client/.env.local

Run the app:
  terminal A: cd apps/server && npm run dev        → board relay on http://localhost:8787
  terminal B: cd apps/client && npm run dev       → app on http://localhost:5173

Manual steps, in order — success criteria for each:

  M1. Fund the parent wallet
      Where: your browser wallet (ArgentX/Braavos) on ${NETWORK}
      Do:    send a little ${NETWORK} STRK for gas + some STRK to shield
      Done:  wallet shows nonzero balance on the connected account

  M2. Shield funds into private notes (/dev/money)
      Where: http://localhost:5173/dev/money   (requires VITE_ENABLE_DEV_MONEY=1)
      Do:    connect parent wallet → shield a small STRK amount
      Done:  UI shows the shielded/private balance increased; unshield round-trip optional

  M3. Set up the family board (/dev/board)
      Where: http://localhost:5173/dev/board
      Do:    create family, add kids (import kid key)
      Done:  kids listed on the board with their own addresses

  M4. Chore → pot payout (/chores)
      Where: http://localhost:5173/chores
      Do:    add a chore with reward → mark done as kid → approve as parent
      Done:  chore shows approved; pot screen pays the kid from the shielded
             balance ("approved" state saved WITH tx hash — no stranded paying state)

  M5. Open a drip stream (/allowance)
      Where: http://localhost:5173/allowance
      Do:    pick kid(s), amount + days → open stream (uses VITE_DRIPS_ADDRESS_${CHAIN_TAG})
      Done:  "stream opened ✓ tx <hash>" logged in the page

  M6. Kid scoops accrued drips (/stash)
      Where: http://localhost:5173/stash
      Do:    connect kid wallet → scoop
      Done:  "scoop pays everything not yet scooped" — kid balance increases by the
             exact accrued amount shown

If any manual step fails while scripted steps passed, the contract is fine —
debug that UI step alone. Re-run './scripts/e2e.sh --from-step 3' to reprint
this checklist without touching the chain.
MANUAL

echo ""
echo "== e2e pass complete (scripted parts) — finish the manual steps above =="
