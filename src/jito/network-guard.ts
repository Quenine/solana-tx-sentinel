import type { Network } from "../config/env.js";

export type JitoExpectedAlignment =
  | "devnet-not-supported-by-jito-testnet"
  | "testnet"
  | "mainnet-beta"
  | "unknown";

export type JitoNetworkAlignment = {
  network: Network;
  jito_block_engine_url: string;
  expected_alignment: JitoExpectedAlignment;
  warning?: string;
};

export function inspectJitoNetworkAlignment(network: Network, jitoBlockEngineUrl: string): JitoNetworkAlignment {
  const normalizedUrl = jitoBlockEngineUrl.toLowerCase();

  if (network === "devnet" && normalizedUrl.includes("testnet.block-engine")) {
    return {
      network,
      jito_block_engine_url: jitoBlockEngineUrl,
      expected_alignment: "devnet-not-supported-by-jito-testnet",
      warning:
        "Configured Solana network is devnet but Jito Block Engine URL looks like testnet. A devnet blockhash submitted to Jito testnet is likely to return Invalid."
    };
  }

  if (network === "testnet" && normalizedUrl.includes("testnet.block-engine")) {
    return {
      network,
      jito_block_engine_url: jitoBlockEngineUrl,
      expected_alignment: "testnet"
    };
  }

  if (network === "mainnet-beta" && normalizedUrl.includes("mainnet.block-engine")) {
    return {
      network,
      jito_block_engine_url: jitoBlockEngineUrl,
      expected_alignment: "mainnet-beta"
    };
  }

  return {
    network,
    jito_block_engine_url: jitoBlockEngineUrl,
    expected_alignment: "unknown",
    warning: "Could not confirm Solana network and Jito Block Engine URL alignment. Verify RPC and Block Engine cluster before submitting bundles."
  };
}
