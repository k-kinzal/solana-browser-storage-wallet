import { Keypair } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2";
import bs58 from "bs58";

const META_KEY = "bsw_current";
const PREFIX = "bsw_";

/**
 * BrowserWalletKeyStore provides a persistent key storage mechanism for Solana wallets using browser storage APIs.
 *
 * This class is responsible for securely saving, loading, and clearing a Solana account's secret key in the browser's Storage (e.g., localStorage or sessionStorage).
 *
 * - The secret key is stored under a unique key derived from the public key's hash, encoded in base58, to avoid collisions and allow for future extensibility.
 * - A meta key is used to track the currently active account, enabling quick retrieval and session management.
 * - All data is serialized as JSON arrays for compatibility and safety.
 *
 * This class does not perform any cryptographic operations itself, but is designed to work with Solana Keypair objects and related cryptography libraries.
 * It is intended to be used as a backend for wallet implementations that require persistent, browser-based key management.
 */
export class BrowserWalletKeyStore {
  /**
   * The storage interface used for saving and loading keys.
   */
  #storage: Storage;

  constructor(storage: Storage) {
    this.#storage = storage;
  }

  /**
   * Loads the secret key for the current account from browser storage.
   *
   * @returns The secret key as a Uint8Array if found, or null if no account is stored.
   */
  load(): Uint8Array | null {
    const dataKey = this.#storage.getItem(META_KEY);
    if (!dataKey) {
      return null;
    }

    const raw = this.#storage.getItem(dataKey);
    return raw ? Uint8Array.from(JSON.parse(raw)) : null;
  }

  /**
   * Saves the provided secret key to browser storage under a unique key derived from the public key.
   *
   * @param secret - The secret key to store as a Uint8Array.
   */
  save(secret: Uint8Array): void {
    const pubBytes = Keypair.fromSecretKey(secret).publicKey.toBytes();
    const hash = sha256(pubBytes).slice(0, 20);
    const dataKey = PREFIX + bs58.encode(hash);

    this.#storage.setItem(dataKey, JSON.stringify([...secret]));
    this.#storage.setItem(META_KEY, dataKey);
  }

  /**
   * Clears the current account's secret key and meta information from browser storage.
   */
  clear(): void {
    const dataKey = this.#storage.getItem(META_KEY);
    if (dataKey) this.#storage.removeItem(dataKey);
    this.#storage.removeItem(META_KEY);
  }
}
