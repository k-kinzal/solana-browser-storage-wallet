import {
  BaseMessageSignerWalletAdapter,
  type SendTransactionOptions,
  type TransactionOrVersionedTransaction,
  WalletConnectionError,
  WalletName,
  WalletNotConnectedError,
  WalletReadyState,
} from "@solana/wallet-adapter-base";
import { Connection, PublicKey, Transaction, TransactionSignature, VersionedTransaction } from "@solana/web3.js";
import { BrowserWallet } from "../core";

/**
 * A Wallet Adapter interface implementation that wraps the BrowserStorageStandardWallet.
 * Provides compatibility with applications using the Solana Wallet Adapter interface.
 *
 * This adapter bridges between the Wallet Adapter interface and the browser storage wallet,
 * enabling the wallet to be used in applications that rely on the standard wallet adapter pattern.
 */
export class BrowserStorageStandardWalletAdapter extends BaseMessageSignerWalletAdapter {
  readonly name = "BrowserStorage" as WalletName<"BrowserStorage">;
  readonly url = "https://github.com/k-kinzal/solana-browser-storage-wallet";
  readonly icon =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjwvc3ZnPg==";
  readonly readyState = WalletReadyState.Loadable;
  readonly supportedTransactionVersions = new Set(["legacy", 0] as const);

  #wallet: BrowserWallet;
  #publicKey: PublicKey | null = null;
  #connecting = false;

  /**
   * Creates a new BrowserStorageStandardWalletAdapter instance.
   * @param wallet - The underlying browser storage wallet instance
   */
  constructor(wallet: BrowserWallet) {
    super();
    this.#wallet = wallet;
    this.#setupEventListeners();
  }

  /**
   * @inheritDoc
   */
  get publicKey(): PublicKey | null {
    return this.#publicKey;
  }

  /**
   * @inheritDoc
   */
  get connecting(): boolean {
    return this.#connecting;
  }

  /**
   * @inheritDoc
   */
  get connected(): boolean {
    return this.#publicKey !== null;
  }

  /**
   * Sets up event listeners to bridge core wallet events to adapter events.
   */
  #setupEventListeners(): void {
    this.#wallet.on("connected", (account) => {
      this.#publicKey = account.publicKey;
      this.#connecting = false;
      this.emit("connect", account.publicKey);
    });

    this.#wallet.on("disconnected", () => {
      const wasConnected = this.#publicKey !== null;
      this.#publicKey = null;
      this.#connecting = false;
      if (wasConnected) {
        this.emit("disconnect");
      }
    });
  }

  /**
   * @inheritDoc
   */
  async connect(): Promise<void> {
    if (this.connected || this.connecting) return;

    this.#connecting = true;
    try {
      await this.#wallet.connect();
    } catch (error) {
      this.#connecting = false;
      this.emit("error", new WalletConnectionError((error as Error).message, error));
      throw error;
    }
  }

  /**
   * @inheritDoc
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;

    await this.#wallet.disconnect();
  }

  /**
   * @inheritDoc
   */
  async sendTransaction(
    transaction: TransactionOrVersionedTransaction<this["supportedTransactionVersions"]>,
    connection: Connection,
    options: SendTransactionOptions = {},
  ): Promise<TransactionSignature> {
    if (!this.connected) {
      throw new WalletNotConnectedError("Wallet not connected");
    }

    let signed: Transaction | VersionedTransaction;

    // If transaction has signers, sign with them first
    if (options.signers?.length) {
      if ((transaction as any) instanceof VersionedTransaction) {
        // For versioned transactions, create a copy and sign with additional signers
        signed = VersionedTransaction.deserialize(transaction.serialize());
        signed.sign(options.signers);
      } else {
        // For legacy transactions, create a copy and sign with additional signers
        signed = Transaction.from(transaction.serialize({ requireAllSignatures: false }));
        signed.partialSign(...options.signers);
      }
    } else {
      signed = transaction;
    }

    // Sign with the wallet
    const serialized = signed.serialize({ requireAllSignatures: false });
    const walletSigned = await this.#wallet.signTransaction(serialized);

    // Send the transaction
    return connection.sendRawTransaction(walletSigned.signedTransaction, {
      skipPreflight: options.skipPreflight,
      preflightCommitment: options.preflightCommitment,
      maxRetries: options.maxRetries,
    });
  }

  /**
   * @inheritDoc
   */
  async signTransaction<T extends TransactionOrVersionedTransaction<this["supportedTransactionVersions"]>>(
    transaction: T,
  ): Promise<T> {
    if (!this.connected) {
      throw new WalletNotConnectedError("Wallet not connected");
    }

    const serialized = transaction.serialize({ requireAllSignatures: false });
    const signed = await this.#wallet.signTransaction(serialized);

    // Deserialize and return the same type as input
    if ((transaction as any) instanceof VersionedTransaction) {
      return VersionedTransaction.deserialize(signed.signedTransaction) as T;
    } else {
      return Transaction.from(signed.signedTransaction) as T;
    }
  }

  /**
   * @inheritDoc
   */
  async signAllTransactions<T extends TransactionOrVersionedTransaction<this["supportedTransactionVersions"]>>(
    transactions: T[],
  ): Promise<T[]> {
    if (!this.connected) {
      throw new WalletNotConnectedError("Wallet not connected");
    }

    const serializedTransactions = transactions.map((tx) => tx.serialize({ requireAllSignatures: false }));

    const signed = await this.#wallet.signAllTransactions(serializedTransactions);

    // Deserialize and return the same types as input
    return signed.signedTransactions.map((signedTx, index) => {
      const original = transactions[index];
      if ((original as any) instanceof VersionedTransaction) {
        return VersionedTransaction.deserialize(signedTx) as T;
      } else {
        return Transaction.from(signedTx) as T;
      }
    });
  }

  /**
   * @inheritDoc
   */
  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!this.connected) {
      throw new WalletNotConnectedError("Wallet not connected");
    }

    const signed = await this.#wallet.signMessage(message);
    return signed.signature;
  }
}
