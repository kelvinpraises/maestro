// use-yield-positions.ts — React Query hooks for reading on-chain YieldManager state

import { useQuery } from "@tanstack/react-query";
import { getPublicClient, calcAccountId } from "@/utils/streams";
import { useChain } from "@/providers/chain-provider";
import { useStealthWallet } from "@/providers/stealth-wallet-provider";
import { getSendableTokens } from "@/config/chains";

const DRIVER_ID = 2n;

// Minimal ABI for YieldManager reads
const yieldManagerAbi = [
  {
    name: "getBalances",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "senderAccountId", type: "uint256" },
      { name: "token", type: "address" },
    ],
    outputs: [
      { name: "principal", type: "uint128" },
      { name: "liquidBalance", type: "uint128" },
      { name: "investedBalance", type: "uint128" },
    ],
  },
  {
    name: "calculateYield",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "senderAccountId", type: "uint256" },
      { name: "token", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getPosition",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "senderAccountId", type: "uint256" },
      { name: "token", type: "address" },
      { name: "strategy", type: "address" },
    ],
    outputs: [
      { name: "strategyAddr", type: "address" },
      { name: "amount", type: "uint128" },
      { name: "positionData", type: "bytes" },
    ],
  },
  {
    name: "approvedCallers",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// --- useYieldBalances ---

export function useYieldBalances(
  senderAccountId: bigint | undefined,
  tokenAddress: `0x${string}` | undefined,
) {
  const { chainConfig, chainId } = useChain();
  const ymAddress = chainConfig.contracts.yieldManager;

  return useQuery({
    queryKey: ["yieldBalances", chainId, senderAccountId?.toString(), tokenAddress],
    queryFn: async () => {
      const client = getPublicClient(chainConfig.chain);
      const result = await client.readContract({
        address: ymAddress,
        abi: yieldManagerAbi,
        functionName: "getBalances",
        args: [senderAccountId!, tokenAddress!],
      });
      const [principal, liquidBalance, investedBalance] = result;
      return { principal, liquidBalance, investedBalance };
    },
    enabled: !!senderAccountId && !!tokenAddress && ymAddress !== "0x0000000000000000000000000000000000000000",
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

// --- useYieldAmount ---

export function useYieldAmount(
  senderAccountId: bigint | undefined,
  tokenAddress: `0x${string}` | undefined,
) {
  const { chainConfig, chainId } = useChain();
  const ymAddress = chainConfig.contracts.yieldManager;

  return useQuery({
    queryKey: ["yieldAmount", chainId, senderAccountId?.toString(), tokenAddress],
    queryFn: async () => {
      const client = getPublicClient(chainConfig.chain);
      return client.readContract({
        address: ymAddress,
        abi: yieldManagerAbi,
        functionName: "calculateYield",
        args: [senderAccountId!, tokenAddress!],
      });
    },
    enabled: !!senderAccountId && !!tokenAddress && ymAddress !== "0x0000000000000000000000000000000000000000",
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

// --- useYieldPosition ---

export function useYieldPosition(
  senderAccountId: bigint | undefined,
  tokenAddress: `0x${string}` | undefined,
  strategyAddress: `0x${string}` | undefined,
) {
  const { chainConfig, chainId } = useChain();
  const ymAddress = chainConfig.contracts.yieldManager;

  return useQuery({
    queryKey: ["yieldPosition", chainId, senderAccountId?.toString(), tokenAddress, strategyAddress],
    queryFn: async () => {
      const client = getPublicClient(chainConfig.chain);
      const result = await client.readContract({
        address: ymAddress,
        abi: yieldManagerAbi,
        functionName: "getPosition",
        args: [senderAccountId!, tokenAddress!, strategyAddress!],
      });
      const [strategy, amount, positionData] = result;
      return { strategy, amount, positionData };
    },
    enabled: !!senderAccountId && !!tokenAddress && !!strategyAddress && ymAddress !== "0x0000000000000000000000000000000000000000",
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

// --- useIsApprovedCaller ---

export function useIsApprovedCaller(callerAddress: `0x${string}` | undefined) {
  const { chainConfig, chainId } = useChain();
  const ymAddress = chainConfig.contracts.yieldManager;

  return useQuery({
    queryKey: ["approvedCaller", chainId, callerAddress],
    queryFn: async () => {
      const client = getPublicClient(chainConfig.chain);
      return client.readContract({
        address: ymAddress,
        abi: yieldManagerAbi,
        functionName: "approvedCallers",
        args: [callerAddress!],
      });
    },
    enabled: !!callerAddress && ymAddress !== "0x0000000000000000000000000000000000000000",
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// --- useYieldSummary ---

export function useYieldSummary() {
  const { chainConfig, chainId } = useChain();
  const { stealthAddress, isReady } = useStealthWallet();
  const ymAddress = chainConfig.contracts.yieldManager;
  const yieldConfig = chainConfig.yieldConfig;
  const tokens = getSendableTokens(chainConfig.contracts);

  const walletAddr = isReady && stealthAddress ? (stealthAddress as `0x${string}`) : undefined;
  const senderAccountId = walletAddr ? calcAccountId(DRIVER_ID, walletAddr) : undefined;
  const hasYieldManager = ymAddress !== "0x0000000000000000000000000000000000000000";

  // Query yield for the yield token (if configured) + sendable tokens
  const allTokenAddresses: `0x${string}`[] = [
    ...tokens.map((t) => t.address),
    ...(yieldConfig ? [yieldConfig.yieldToken.address] : []),
  ];

  return useQuery({
    queryKey: ["yieldSummary", chainId, senderAccountId?.toString()],
    queryFn: async () => {
      const client = getPublicClient(chainConfig.chain);

      let totalPrincipal = 0n;
      let totalYield = 0n;

      for (const tokenAddr of allTokenAddresses) {
        try {
          const [principal, liquidBalance, investedBalance] = await client.readContract({
            address: ymAddress,
            abi: yieldManagerAbi,
            functionName: "getBalances",
            args: [senderAccountId!, tokenAddr],
          });

          totalPrincipal += BigInt(principal);
          const total = BigInt(liquidBalance) + BigInt(investedBalance);
          if (total > BigInt(principal)) {
            totalYield += total - BigInt(principal);
          }
        } catch {
          // Token may not have any positions — skip
        }
      }

      return {
        totalPrincipal,
        totalYield,
        hasPositions: totalPrincipal > 0n,
      };
    },
    enabled: !!senderAccountId && hasYieldManager,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
