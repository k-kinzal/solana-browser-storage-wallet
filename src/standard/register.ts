import { Commitment, Connection, ConnectionConfig, clusterApiUrl } from "@solana/web3.js";
import { Wallet } from "@wallet-standard/base";
import { registerWallet as registerStandardWallet } from "@wallet-standard/wallet";
import { BrowserWallet, BrowserWalletKeyStore } from "../core";
import { BrowserStorageStandardWallet } from "./wallet";

/**
 * Options for registering the browser storage wallet.
 * @property endpoint - The Solana RPC endpoint to connect to. Defaults to mainnet-beta.
 * @property commitmentOrConfig - The connection commitment or configuration.
 * @property storage - The Storage implementation to use for key storage. Defaults to localStorage.
 */
export interface RegisterWalletOptions {
  /**
   * TThe Solana RPC endpoint to connect to. Defaults to mainnet-beta.
   */
  endpoint?: string;

  /**
   * The connection commitment or configuration.
   */
  commitmentOrConfig?: Commitment | ConnectionConfig;

  /**
   * The Storage implementation to use for key storage. Defaults to localStorage.
   */
  storage?: Storage;
}

/**
 * Registers a browser storage-backed Solana wallet with the Wallet Standard interface.
 *
 * This function creates a new Solana connection and a browser wallet instance using the provided options.
 * It then wraps the wallet in a Wallet Standard-compatible adapter and registers it globally.
 *
 * @param options - Configuration options for the wallet registration.
 *   - endpoint: The Solana RPC endpoint to use (default: mainnet-beta).
 *   - commitmentOrConfig: The connection commitment or configuration.
 *   - storage: The Storage implementation for key storage (default: localStorage).
 * @throws If no storage is provided and localStorage is not available.
 */
export function registerWallet({ endpoint, commitmentOrConfig, storage }: RegisterWalletOptions = {}): BrowserWallet {
  if (!storage && typeof localStorage === "undefined") {
    throw new Error("No storage provided and localStorage is not available. Please provide a storage option.");
  }
  const conn: Connection = new Connection(endpoint || clusterApiUrl("mainnet-beta"), commitmentOrConfig);
  const core = new BrowserWallet(new BrowserWalletKeyStore(storage || localStorage));
  const wallet: Wallet = new BrowserStorageStandardWallet(conn, core);

  registerStandardWallet(wallet);

  return core;
}
