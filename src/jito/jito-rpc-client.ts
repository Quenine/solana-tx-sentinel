import type { JitoRpcClientOptions, JsonRpcRequest, JsonRpcResponse, SendBundleResult } from "./types.js";

const bundlesPath = "/api/v1/bundles";

function normalizeBundlesUrl(blockEngineUrl: string): string {
  const url = new URL(blockEngineUrl);
  const path = url.pathname.replace(/\/+$/, "");

  url.pathname = path.endsWith(bundlesPath) ? path : `${path}${bundlesPath}`;
  url.search = "";
  url.hash = "";

  return url.toString();
}

function isJsonRpcFailure<T>(response: JsonRpcResponse<T>): response is Extract<JsonRpcResponse<T>, { error: unknown }> {
  return "error" in response;
}

export class JitoRpcClient {
  private nextRequestId = 1;
  readonly bundlesUrl: string;

  constructor(options: JitoRpcClientOptions) {
    this.bundlesUrl = normalizeBundlesUrl(options.blockEngineUrl);
  }

  async getTipAccounts(): Promise<string[]> {
    return this.request<string[]>("getTipAccounts");
  }

  async getBundleStatuses(bundleIds: string[]): Promise<unknown> {
    return this.request("getBundleStatuses", [bundleIds]);
  }

  async getInflightBundleStatuses(bundleIds: string[]): Promise<unknown> {
    return this.request("getInflightBundleStatuses", [bundleIds]);
  }

  async sendBundle(base64Transactions: string[]): Promise<SendBundleResult> {
    if (base64Transactions.length === 0) {
      throw new Error("sendBundle requires at least one serialized transaction.");
    }

    const params = [base64Transactions, { encoding: "base64" }] satisfies [string[], { encoding: "base64" }];
    const result = await this.request<unknown>("sendBundle", params);

    if (typeof result !== "string" || result.length === 0) {
      throw new Error("Jito JSON-RPC sendBundle returned an invalid bundle id.");
    }

    return {
      bundle_id: result,
      raw: result
    };
  }

  private async request<T>(method: string, params?: unknown[]): Promise<T> {
    const body: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: this.nextRequestId,
      method,
      params: params ?? []
    };
    this.nextRequestId += 1;

    const response = await fetch(this.bundlesUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Jito JSON-RPC ${method} failed with HTTP ${response.status}: ${text.slice(0, 300)}`);
    }

    let parsed: JsonRpcResponse<T>;

    try {
      parsed = JSON.parse(text) as JsonRpcResponse<T>;
    } catch {
      throw new Error(`Jito JSON-RPC ${method} returned invalid JSON.`);
    }

    if (isJsonRpcFailure(parsed)) {
      throw new Error(`Jito JSON-RPC ${method} error ${parsed.error.code}: ${parsed.error.message}`);
    }

    return parsed.result;
  }
}
