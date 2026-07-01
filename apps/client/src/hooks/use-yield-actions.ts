// use-yield-actions.ts — mutation hooks for YieldManager operations via ERC-4337 UserOps

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { encodeFunctionData } from "viem";
import { useStealthWallet } from "@/providers/stealth-wallet-provider";
import { useChain } from "@/providers/chain-provider";
import { usePrivy } from "@privy-io/react-auth";
import { config } from "@/config";
import { erc20Abi } from "@/utils/streams";
import { toast } from "sonner";

// Minimal ABI for YieldManager write functions
const yieldManagerAbi = [
  {
    name: "ownerDeposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "senderAccountId", type: "uint256" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "positionOpen",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "senderAccountId", type: "uint256" },
      { name: "token", type: "address" },
      { name: "strategy", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "strategyData", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "positionClose",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "senderAccountId", type: "uint256" },
      { name: "token", type: "address" },
      { name: "strategy", type: "address" },
      { name: "strategyData", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "yieldClaim",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "senderAccountId", type: "uint256" },
      { name: "token", type: "address" },
      { name: "recipient", type: "address" },
    ],
    outputs: [],
  },
] as const;

// --- useInvestPosition ---

export function useInvestPosition() {
  const queryClient = useQueryClient();
  const { sendTransaction, waitForUserOp } = useStealthWallet();
  const { chainConfig } = useChain();

  return useMutation({
    mutationFn: async ({
      senderAccountId,
      tokenAddress,
      strategyAddress,
      amount,
    }: {
      senderAccountId: bigint;
      tokenAddress: `0x${string}`;
      strategyAddress: `0x${string}`;
      amount: bigint;
    }) => {
      const ymAddress = chainConfig.contracts.yieldManager;
      // strategyData for MoreMarkets is just abi.encode(token)
      const encodedToken = `0x${tokenAddress.slice(2).padStart(64, "0")}` as `0x${string}`;

      // Batched UserOp: approve + ownerDeposit + positionOpen
      const txs = [
        {
          to: tokenAddress,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [ymAddress, amount],
          }),
        },
        {
          to: ymAddress,
          data: encodeFunctionData({
            abi: yieldManagerAbi,
            functionName: "ownerDeposit",
            args: [senderAccountId, tokenAddress, amount],
          }),
        },
        {
          to: ymAddress,
          data: encodeFunctionData({
            abi: yieldManagerAbi,
            functionName: "positionOpen",
            args: [senderAccountId, tokenAddress, strategyAddress, amount, encodedToken],
          }),
        },
      ];

      const result = await sendTransaction(txs);
      if (result.hash) {
        await waitForUserOp(result.hash as string);
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["yieldBalances"] });
      queryClient.invalidateQueries({ queryKey: ["yieldPosition"] });
      queryClient.invalidateQueries({ queryKey: ["yieldSummary"] });
      queryClient.invalidateQueries({ queryKey: ["tokenBalance"] });
    },
  });
}

// --- useClosePosition ---

export function useClosePosition() {
  const queryClient = useQueryClient();
  const { sendTransaction, waitForUserOp } = useStealthWallet();
  const { chainConfig } = useChain();

  return useMutation({
    mutationFn: async ({
      senderAccountId,
      tokenAddress,
      strategyAddress,
    }: {
      senderAccountId: bigint;
      tokenAddress: `0x${string}`;
      strategyAddress: `0x${string}`;
    }) => {
      const ymAddress = chainConfig.contracts.yieldManager;
      const result = await sendTransaction({
        to: ymAddress,
        data: encodeFunctionData({
          abi: yieldManagerAbi,
          functionName: "positionClose",
          args: [senderAccountId, tokenAddress, strategyAddress, "0x"],
        }),
      });
      if (result.hash) {
        await waitForUserOp(result.hash as string);
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["yieldBalances"] });
      queryClient.invalidateQueries({ queryKey: ["yieldPosition"] });
      queryClient.invalidateQueries({ queryKey: ["yieldSummary"] });
      queryClient.invalidateQueries({ queryKey: ["tokenBalance"] });
    },
  });
}

// --- useClaimYield ---

export function useClaimYield() {
  const queryClient = useQueryClient();
  const { sendTransaction, waitForUserOp, stealthAddress } = useStealthWallet();
  const { chainConfig } = useChain();

  return useMutation({
    mutationFn: async ({
      senderAccountId,
      tokenAddress,
    }: {
      senderAccountId: bigint;
      tokenAddress: `0x${string}`;
    }) => {
      const ymAddress = chainConfig.contracts.yieldManager;
      const result = await sendTransaction({
        to: ymAddress,
        data: encodeFunctionData({
          abi: yieldManagerAbi,
          functionName: "yieldClaim",
          args: [senderAccountId, tokenAddress, stealthAddress as `0x${string}`],
        }),
      });
      if (result.hash) {
        await waitForUserOp(result.hash as string);
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["yieldBalances"] });
      queryClient.invalidateQueries({ queryKey: ["yieldAmount"] });
      queryClient.invalidateQueries({ queryKey: ["yieldSummary"] });
      queryClient.invalidateQueries({ queryKey: ["tokenBalance"] });
    },
  });
}

// --- useRequestCallerApproval ---

export function useRequestCallerApproval() {
  const queryClient = useQueryClient();
  const { getAccessToken } = usePrivy();
  const { chainConfig } = useChain();

  return useMutation({
    mutationFn: async ({ callerAddress }: { callerAddress: string }) => {
      const token = await getAccessToken();
      const res = await fetch(`${config.API_URL}/yield/approve-caller`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          callerAddress,
          chainName: chainConfig.chain.name === "Flow EVM Testnet" ? "flow-testnet" : chainConfig.chain.name.toLowerCase(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed: ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvedCaller"] });
      toast.success("Caller approved for manual yield management");
    },
  });
}
