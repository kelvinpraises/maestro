#!/usr/bin/env bash
# Post-deploy on-chain verification for the drips contract.
#
# Usage:
#   VERIFY_NETWORK=sepolia VERIFY_ACCOUNT=<sncast profile> \
#   DRIPS_TOKEN_ADDRESS=0x... \
#   ./scripts/verify.sh [--dry-run]
#
# Runs a tiny end-to-end stream (101 raw units, 1/sec, 7:3 split) and asserts
# exact on-chain outcomes: per-slice claims incl. last-claimer sweep, then slot
# auto-free. Every step prints PASS/FAIL with actual values.
set -euo pipefail

cd "$(dirname "$0")/.." # apps/contracts

NETWORK="${VERIFY_NETWORK:-}"
PROFILE="${VERIFY_ACCOUNT:-}"
TOKEN="${DRIPS_TOKEN_ADDRESS:-}"
DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

die() {
	echo "FAIL: $*" >&2
	exit 1
}

pass() {
	echo "PASS: $*"
}

[[ -n "$NETWORK" ]] || die "VERIFY_NETWORK unset (sepolia|mainnet)"
case "$NETWORK" in
sepolia | mainnet) ;;
*) die "VERIFY_NETWORK must be 'sepolia' or 'mainnet', got '$NETWORK'" ;;
esac
[[ -n "$PROFILE" ]] || die "VERIFY_ACCOUNT unset (sncast profile name from your snfoundry.toml)"
[[ -n "$TOKEN" ]] || die "DRIPS_TOKEN_ADDRESS unset"

ENV_FILE="deployments.${NETWORK}.env"
[[ -f "$ENV_FILE" ]] || die "$ENV_FILE missing — run deploy.sh against $NETWORK first"
# shellcheck source=/dev/null
source "$ENV_FILE"
[[ -n "${DRIPS_ADDRESS:-}" ]] || die "DRIPS_ADDRESS unset in $ENV_FILE — deploy first"

R1="${VERIFY_RECIPIENT_1:-$(printf '0x51b%048d' 1)}" # arbitrary felt, no keys needed
R2="${VERIFY_RECIPIENT_2:-$(printf '0x51b%048d' 2)}"
AMOUNT=101    # raw units; STRK has 18 decimals so this is ~free
RATE=1        # raw units per second → duration = 101s
SHARE1=7
SHARE2=3
WPS=$((SHARE1 + SHARE2))
ENT1=$(((AMOUNT * SHARE1) / WPS))                       # 70
ENT2=$(((AMOUNT * SHARE2) / WPS))                       # 30
SWEEP=$((AMOUNT - ENT1 - ENT2))                         # 1, paid to last claimer
DURATION=$((AMOUNT / RATE))                             # 101
ZERO_HI=0                                               # high limb of u256 amounts

SNCAST=(sncast -p "$PROFILE" -j --wait)

# sncast call <addr> <fn> [felts...] → space-joined response felts
call_fn() {
	local addr="$1" fn="$2"
	shift 2
	"${SNCAST[@]}" call --contract-address "$addr" --function "$fn" "$@"
}

# u256 balance from sncast call JSON response ([low, high] limbs); low-limb only,
# since every amount this harness uses fits 64 bits.
balance_of() {
	local who="$1"
	call_fn "$TOKEN" balance_of "$who" |
		python3 -c 'import json,sys; r=json.load(sys.stdin)["response"]; print(int(r[0],16))' ||
		die "token balance_of($who) failed"
}
# NOTE: u256 limbs are 128-bit; bash arithmetic is 64-bit. We only compare the
# low limb here — fine because every amount in this harness fits 64 bits.

echo "== drips post-deploy verification ($NETWORK) =="
echo "drips     : $DRIPS_ADDRESS"
echo "token     : $TOKEN"
echo "recipients: $R1 (+$ENT1), $R2 (+$((ENT2 + SWEEP)) incl. sweep)"


if $DRY_RUN; then
	echo ""
	for cmd in \
		"sncast invoke approve spender=$DRIPS_ADDRESS amount=$AMOUNT" \
		"sncast invoke open_stream_split recipients=[$R1:$SHARE1,$R2:$SHARE2] rate=$RATE amount=$AMOUNT" \
		"sleep $((DURATION + 10))" \
		"sncast invoke claim_as who=$R1  → expect +$ENT1" \
		"sncast invoke claim_as who=$R2  → expect +$((ENT2 + SWEEP)) (incl. sweep)" \
		"sncast invoke claim_as who=$R1  → expect revert 'no active stream'"; do
		echo "+ $cmd"
	done
	echo "(dry-run: nothing was sent to the network)"
	exit 0
fi

echo "== step 1: approve deposit =="
OUT="$(sncast -p "$PROFILE" -j --wait invoke --contract-address "$TOKEN" \
	--function approve --calldata "$DRIPS_ADDRESS" "$AMOUNT" "$ZERO_HI" 2>&1)" ||
	die "approve rejected: $OUT"
pass "approve($AMOUNT raw)"

echo "== step 2: open_stream_split =="
OUT="$(sncast -p "$PROFILE" -j --wait invoke --contract-address "$DRIPS_ADDRESS" \
	--function open_stream_split \
	--calldata 2 "$R1" "$SHARE1" "$R2" "$SHARE2" "$RATE" "$ZERO_HI" "$AMOUNT" "$ZERO_HI" 2>&1)" ||
	die "open_stream_split rejected: $OUT"
OPEN_TX="$(grep -Eo '"transaction_hash": "[^"]+"' <<<"$OUT" | sed 's/.*: "//;s/"//' | head -1)"
pass "stream opened (tx $OPEN_TX), dry in ${DURATION}s"

NOW="$(date +%s)"
END_AT="$((NOW + DURATION + 10))"
echo "== step 3: waiting for dry-out ≈ ${DURATION}s =="
sleep "$((END_AT - NOW))"

echo "== step 4: claims =="
OUT="$(sncast -p "$PROFILE" -j --wait invoke --contract-address "$DRIPS_ADDRESS" \
	--function claim_as --calldata "$R1" 2>&1)" || die "claim_as(r1) reverted: $OUT"
pass "claim_as(r1)"

OUT="$(sncast -p "$PROFILE" -j --wait invoke --contract-address "$DRIPS_ADDRESS" \
	--function claim_as --calldata "$R2" 2>&1)" || die "claim_as(r2) reverted: $OUT"
pass "claim_as(r2) (last settled — swept remainder)"

echo "== step 5: balance assertions =="
B1_R1="$(balance_of "$R1")"
B1_R2="$(balance_of "$R2")"
DELTA1=$((B1_R1 - B0_R1))
DELTA2=$((B1_R2 - B0_R2))

FAILED=0
if [[ "$DELTA1" == "$ENT1" ]]; then
	pass "r1 delta = $DELTA1 (expected $ENT1)"
else
	echo "FAIL: r1 delta = $DELTA1, expected $ENT1 (V3: check permissionless third-party claims / decimals)"
	FAILED=1
fi

B0_DRIPS="$(balance_of "$DRIPS_ADDRESS")"
B0_R1="$(balance_of "$R1")"
B0_R2="$(balance_of "$R2")"
echo "pre-flight: drips holds $B0_DRIPS, r1=$B0_R1, r2=$B0_R2 (raw units)"

if [[ "$B0_DRIPS" != "0" ]]; then
	echo "NOTE: drips contract already holds funds (prior run?) — deltas still assert exactly"
fi

SENDER_ADDR="$(call_fn "$DRIPS_ADDRESS" sender |
	python3 -c 'import json,sys; print(json.load(sys.stdin)["response"][0])')" ||
	die "could not read sender from drips contract"
echo "sender    : $SENDER_ADDR (the verify account must be funded with tokens+gas)"

if [[ "$DELTA2" == "$((ENT2 + SWEEP))" ]]; then
	pass "r2 delta = $DELTA2 (expected $((ENT2 + SWEEP)) incl. sweep)"
else
	echo "FAIL: r2 delta = $DELTA2, expected $((ENT2 + SWEEP)) incl. sweep"
	FAILED=1
fi

echo "== step 6: slot freed =="
set +e
OUT="$(sncast -p "$PROFILE" -j --wait invoke --contract-address "$DRIPS_ADDRESS" \
	--function claim_as --calldata "$R1" 2>&1)"
CLAIM_RC=$?
set -e
if [[ "$CLAIM_RC" -eq 0 ]]; then
	echo "FAIL: claim_as succeeded after full drain — slot NOT freed"
	FAILED=1
elif grep -qiE 'no active stream|reverted' <<<"$OUT"; then
	pass "post-drain claim reverts ('no active stream') — slot freed"
else
	echo "FAIL: unexpected error after drain: $OUT"
	FAILED=1
fi

echo ""
if [[ "$FAILED" == "0" ]]; then
	echo "== VERIFICATION PASSED =="
	exit 0
fi
echo "== VERIFICATION FAILED (see FAIL lines above) =="
exit 1
