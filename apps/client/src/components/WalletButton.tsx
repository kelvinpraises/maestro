import { useEffect, useState } from 'react'
import { disconnect as gsDisconnect, connect as gsConnect } from 'get-starknet'
import { StarknetInjectedWallet } from '@starknet-io/get-starknet-wallet-standard-v6'
import { WalletAccountV6 } from 'starknet'
import { providerForChain, chainName, trimAddress } from '#/lib/starknet'

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
  }

  if (account) {
    return (
      <span className="inline-flex items-center gap-2 text-sm">
        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          {chainId ? chainName(chainId) : '…'}
        </span>
        <code>{trimAddress(account.address)}</code>
        <button
          onClick={disconnectWallet}
          className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Disconnect
        </button>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={connectWallet}
        disabled={connecting}
        className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
      >
        {connecting ? 'Connecting…' : 'Connect Wallet'}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </span>
  )
}
