import { EventEmitter } from "@solana/wallet-adapter-base";
import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { sign } from "tweetnacl";
import { BrowserWalletKeyStore } from "./key-store";

/**
 * Base error class for BrowserWallet errors.
 */
export class BrowserWalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserWalletError";
  }
}

/**
 * Error thrown when no 'connect:request' event listener is registered.
 */
export class NoConnectRequestListenerError extends BrowserWalletError {
  constructor() {
    super("No 'connect:request' event listener registered. Please register a listener before calling connect.");
    this.name = "NoConnectRequestListenerError";
  }
}

/**
 * Error thrown when no account is found in browser storage.
 */
export class NoAccountInStorageError extends BrowserWalletError {
  constructor() {
    super("No account found in storage");
    this.name = "NoAccountInStorageError";
  }
}

/**
 * Error thrown when the user rejects the connection request.
 */
export class ConnectionRejectedError extends BrowserWalletError {
  constructor() {
    super("Connection rejected by user");
    this.name = "ConnectionRejectedError";
  }
}

/**
 * Error thrown when a wallet operation is attempted without a connected wallet.
 */
export class WalletNotConnectedError extends BrowserWalletError {
  constructor(operation: string) {
    super(`Wallet not connected. Please connect the wallet before ${operation}.`);
    this.name = "WalletNotConnectedError";
  }
}

/**
 * Represents a Solana account with its address and public key.
 */
export type Account = {
  address: string;
  publicKey: PublicKey;
};

/**
 * Interface for the browser wallet event types.
 */
export interface BrowserWalletEventTypes {
  /**
   * Emitted when a connection request is made.
   * The app should listen for this event to initiate the connection process.
   */
  "connect:request": [];

  /**
   * Emitted when the connection is approved by the user.
   * The app should listen for this event to finalize the connection.
   */
  "connect:approved": [];

  /**
   * Emitted when the connection is rejected by the user.
   * The app should listen for this event to handle the rejection.
   */
  "connect:rejected": [];

  /**
   * Emitted when the wallet is successfully connected and the account is available.
   * The app should listen for this event to know when the wallet is ready to use.
   */
  connected: [Account];

  /**
   * Emitted when the wallet is disconnected and the session is cleared.
   * The app should listen for this event to handle the disconnection.
   */
  disconnected: [];
}

/**
 * BrowserWallet provides a Solana wallet implementation that manages keypairs using browser storage.
 * It handles account creation, persistent key management, session state, and cryptographic signing operations.
 * Events are emitted for connection lifecycle and session state changes.
 */
export class BrowserWallet extends EventEmitter<BrowserWalletEventTypes> {
  /**
   * The keypair used for signing transactions and messages.
   * Loaded from browser storage or generated when a new account is created.
   */
  #keypair?: Keypair;

  /**
   * The account associated with the wallet, containing the address and public key.
   * Set after a successful connection.
   */
  #account?: Account;

  /**
   * A promise that tracks the current connection attempt, preventing concurrent connections.
   */
  #connecting?: Promise<Account>;

  /**
   * The key store used for saving and loading keypairs from browser storage.
   * This is an instance of BrowserWalletKeyStore that handles the actual storage operations.
   */
  #store: BrowserWalletKeyStore;

  /**
   * Constructs a new BrowserWallet instance with the provided key store for persistent storage.
   * @param store - The key store implementation for saving and loading keypairs from browser storage.
   */
  constructor(store: BrowserWalletKeyStore) {
    super();

    this.#store = store;
  }

  /**
   * Generates a new Solana keypair, saves it to browser storage, and returns the corresponding account.
   *
   * Note: This method only creates and stores the account. It does NOT connect the wallet.
   * You must explicitly call connect() after creating an account to establish a wallet session.
   *
   * @returns The newly created account with address and public key.
   */
  createAccount(): Account {
    const bytes = this.#store.load();
    if (bytes) {
      const keypair = Keypair.fromSecretKey(bytes);
      return {
        address: keypair.publicKey.toBase58(),
        publicKey: keypair.publicKey,
      };
    }
    const keypair = Keypair.generate();
    this.#store.save(Uint8Array.from(keypair.secretKey));

    return {
      address: keypair.publicKey.toBase58(),
      publicKey: keypair.publicKey,
    };
  }

  /**
   * Deletes the current account by clearing the stored keypair from browser storage.
   */
  deleteAccount(): void {
    this.#store.clear();
  }

  /**
   * Connects the wallet by loading the keypair from browser storage and initializing the session.
   * Emits connection events based on user approval or rejection.
   *
   * @param input - Optional input to control connection behavior.
   *   - silent: If true, attempts to connect immediately without user confirmation (succeeds only if an account exists in storage).
   *   - silent: If false or omitted, emits a 'connect:request' event and waits for user approval or rejection.
   * @returns A promise that resolves to the connected account.
   * @throws If no event listener is registered for 'connect:request'.
   */
  async connect(input?: { silent?: boolean }): Promise<Account> {
    if (this.listeners("connect:request").length === 0) {
      throw new NoConnectRequestListenerError();
    }
    if (this.#account) {
      return this.#account;
    }
    if (this.#connecting) {
      return this.#connecting;
    }

    this.#connecting = new Promise<{ address: string; publicKey: PublicKey }>((resolve, reject) => {
      this.once("connect:approved", () => {
        const bytes = this.#store.load();
        if (!bytes) {
          reject(new NoAccountInStorageError());
          return;
        }
        this.#keypair = Keypair.fromSecretKey(bytes);
        this.#account = {
          address: this.#keypair.publicKey.toBase58(),
          publicKey: this.#keypair.publicKey,
        };
        resolve(this.#account);
        this.emit("connected", this.#account);
      });
      this.once("connect:rejected", () => {
        reject(new ConnectionRejectedError());
      });
      if (input?.silent) {
        this.emit("connect:approved");
      } else {
        this.emit("connect:request");
      }
    }).finally(() => (this.#connecting = undefined));

    return this.#connecting;
  }

  /**
   * Disconnects the wallet by clearing the keypair and account from memory and ending the session.
   * Emits a 'disconnected' event.
   */
  async disconnect(): Promise<void> {
    this.#keypair = undefined;
    this.#account = undefined;
    this.emit("disconnected");
  }

  /**
   * Signs an arbitrary message using the wallet's private key.
   * @param message The message to sign as a Uint8Array.
   * @returns An object containing the original message and its signature.
   * @throws If the wallet is not connected.
   */
  async signMessage(message: Uint8Array): Promise<{ signedMessage: Uint8Array; signature: Uint8Array }> {
    if (!this.#keypair) {
      throw new WalletNotConnectedError("signing a message");
    }
    return {
      signedMessage: message,
      signature: sign.detached(message, this.#keypair.secretKey),
    };
  }

  /**
   * Signs a Solana transaction (legacy or versioned) using the wallet's private key.
   * @param transaction The serialized transaction as a Uint8Array.
   * @returns An object containing the signed transaction as a Uint8Array.
   * @throws If the wallet is not connected.
   */
  async signTransaction(transaction: Uint8Array): Promise<{ signedTransaction: Uint8Array }> {
    if (!this.#keypair) {
      throw new WalletNotConnectedError("signing a transaction");
    }
    let parsedTransaction: Transaction | VersionedTransaction;
    if ((transaction[0] & 0x80) !== 0) {
      parsedTransaction = VersionedTransaction.deserialize(transaction);
      parsedTransaction.sign([this.#keypair]);
    } else {
      parsedTransaction = Transaction.from(transaction);
      parsedTransaction.partialSign(this.#keypair);
    }
    return {
      signedTransaction: parsedTransaction.serialize({ requireAllSignatures: false }),
    };
  }

  /**
   * Signs multiple Solana transactions using the wallet's private key.
   * @param transactions An array of serialized transactions as Uint8Array.
   * @returns An object containing an array of signed transactions as Uint8Array.
   * @throws If the wallet is not connected.
   */
  async signAllTransactions(transactions: Uint8Array[]): Promise<{ signedTransactions: Uint8Array[] }> {
    if (!this.#keypair) {
      throw new WalletNotConnectedError("signing transactions");
    }
    const promises = transactions.map(this.signTransaction.bind(this));
    return {
      signedTransactions: await Promise.all(promises).then((outputs) =>
        outputs.map((output) => output.signedTransaction),
      ),
    };
  }
}
