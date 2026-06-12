import { describe, expect, it } from "vitest";

import { parseEnv } from "../src/config/env.js";

const validEnv = {
  SOLANA_RPC_URL: "https://api.devnet.solana.com",
  SOLANA_WS_URL: "wss://api.devnet.solana.com",
  YELLOWSTONE_GRPC_ENDPOINT: "https://grpc.example.com",
  YELLOWSTONE_GRPC_TOKEN: "test-token",
  JITO_BLOCK_ENGINE_URL: "https://block-engine.example.com",
  WALLET_KEYPAIR_PATH: "./wallet.json",
  NETWORK: "devnet",
  LOG_LEVEL: "info",
  ENABLE_AI_AGENT: "false",
  OPENAI_API_KEY: ""
};

describe("parseEnv", () => {
  it("parses a valid environment", () => {
    const env = parseEnv(validEnv);

    expect(env.NETWORK).toBe("devnet");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.ENABLE_AI_AGENT).toBe(false);
  });

  it("coerces ENABLE_AI_AGENT when enabled", () => {
    const env = parseEnv({
      ...validEnv,
      ENABLE_AI_AGENT: "true"
    });

    expect(env.ENABLE_AI_AGENT).toBe(true);
  });

  it("rejects invalid urls", () => {
    expect(() =>
      parseEnv({
        ...validEnv,
        SOLANA_RPC_URL: "not-a-url"
      })
    ).toThrow("Invalid environment configuration");
  });
});
