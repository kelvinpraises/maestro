import { useEffect, useState } from 'react'
import { disconnect as gsDisconnect, connect as gsConnect } from 'get-starknet'
import { StarknetInjectedWallet } from '@starknet-io/get-starknet-wallet-standard-v6'
import { WalletAccountV6 } from 'starknet'
import { providerForChain, chainName, trimAddress } from '#/lib/starknet'
import { setWallet } from '#/lib/walletStore'
// Connect button: detect Argent/Braavos via get-starknet, connect through
// WalletAccountV6, show trimmed address + chain-derived network badge.
export function WalletButton() {
  const [account, setAccount] = useState<WalletAccountV6 | null>(null)
  const [chainId, setChainId] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Future tx code fetches the chain-correct provider via providerForChain(chainId) —
  // the per-chain cache in lib/starknet.ts is warmed here at connect time.

  // get-starknet v4 and the wallet-standard v6 wrapper pin different @starknet-io/types-js
  // majors; same runtime shape, so one cast bridges them at this single point.
  const [swo, setSwo] = useState<Awaited<ReturnType<typeof gsConnect>>>(null)

  // Network badge is derived from the connected wallet's chainId — never assumed.
  useEffect(() => {
    if (!swo) return
    let cancelled = false
    swo.request({ type: 'wallet_requestChainId' })
      .then((id) => !cancelled && setChainId(id ?? null))
      .catch(() => !cancelled && setChainId(null))
    return () => {
      cancelled = true
    }
  }, [swo])

  async function connectWallet() {
    setConnecting(true)
    setError(null)
    try {
      const swo = await gsConnect({ modalMode: 'canAsk' })
      if (!swo) {
        setError('No Starknet wallet found — install Argent or Braavos, or connection was cancelled.')
        return
      }
      type SwoV6 = ConstructorParameters<typeof StarknetInjectedWallet>[0]
      const w = new StarknetInjectedWallet(swo as unknown as SwoV6)

      // Chain first: provider must target the WALLET's chain, not env's.
      const cid = await swo.request({ type: 'wallet_requestChainId' })
      setChainId(cid ?? null)
      const p = providerForChain(cid)
      // Verify the endpoint actually serves that chain — env misconfig surfaces
      // here as a visible error instead of a silent signature failure later.
      const rpcChain = await p.getChainId()
      if (rpcChain !== cid) {
        setError(`RPC for ${chainName(cid)} answered on ${chainName(rpcChain)} — fix VITE_RPC_URL_* in .env.local.`)
        return
      }

      const acct = await WalletAccountV6.connect(p, w)
      setAccount(acct)
      setSwo(swo)
      setWallet({ account: acct, chainId: cid ?? null })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setConnecting(false)
    }
  }

  async function disconnectWallet() {
    await gsDisconnect()
    setAccount(null)
    setSwo(null)
    setChainId(null)
    setWallet({ account: null, chainId: null })
  }

  if (account) {
    return (
      <div className="flex w-full flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-full border-2 border-[var(--m-ink)] bg-[var(--m-mint)] px-2.5 py-0.5 text-[11px] font-extrabold text-[var(--m-green-ink)]">
            {chainId ? chainName(chainId) : '…'}
          </span>
          <code className="field-pop px-2.5 py-1 text-xs font-bold">{trimAddress(account.address)}</code>
        </div>
        <button onClick={disconnectWallet} className="btn-pop w-full" style={{ background: 'var(--m-lavender)', color: 'var(--m-foreground)' }}>Disconnect</button>
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <button onClick={connectWallet} disabled={connecting} className="btn-pop w-full">
        {connecting ? 'Connecting…' : 'Connect wallet'}
      </button>
      {error && <p className="text-xs font-bold text-[var(--m-pink)]">{error}</p>}
    </div>
  )
}
