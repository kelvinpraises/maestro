import { Router } from "express";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { requireAuth } from "../middleware/auth.js";
import { chains, loadDeployOutput } from "../../../config/deploy-output.js";

const yieldManagerAbi = [
  {
    name: "approveCaller",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "caller", type: "address" }],
    outputs: [],
  },
] as const;

function getChainRpc(chainName: string): string | null {
  const chain = chains.find((c) => c.name === chainName);
  return chain?.rpc ?? null;
}

export function createYieldRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // POST /yield/approve-caller
  // Body: { callerAddress: string, chainName: string }
  // Server uses operator key (YieldManager OWNER) to call approveCaller on-chain
  router.post("/approve-caller", async (req, res) => {
    try {
      const { callerAddress, chainName } = req.body;

      if (!callerAddress || !chainName) {
        res.status(400).json({ error: "callerAddress and chainName are required" });
        return;
      }

      const operatorKey = process.env.OPERATOR_KEY;
      if (!operatorKey) {
        res.status(500).json({ error: "Server operator key not configured" });
        return;
      }

      const rpc = getChainRpc(chainName);
      if (!rpc) {
        res.status(400).json({ error: `Unsupported chain: ${chainName}` });
        return;
      }

      const deployOutput = loadDeployOutput(chainName);
      const yieldManagerAddr = deployOutput?.scopes.streaming?.contracts?.yieldManager;
      if (!yieldManagerAddr) {
        res.status(400).json({ error: `No YieldManager deployed on ${chainName}` });
        return;
      }

      const account = privateKeyToAccount(operatorKey as Hex);
      const client = createPublicClient({ transport: http(rpc) });
      const walletClient = createWalletClient({
        account,
        transport: http(rpc),
      });

      const hash = await walletClient.writeContract({
        chain: null,
        address: yieldManagerAddr as `0x${string}`,
        abi: yieldManagerAbi,
        functionName: "approveCaller",
        args: [callerAddress as `0x${string}`],
      });

      await client.waitForTransactionReceipt({ hash });

      res.json({ success: true, txHash: hash });
    } catch (err: any) {
      console.error("[yield] approve-caller failed:", err);
      res.status(500).json({ error: err?.message ?? "Failed to approve caller" });
    }
  });

  return router;
}
