import { Wallet, WalletAccount, WalletIcon, WalletVersion } from "@wallet-standard/base";
import {
  SolanaSignAndSendTransaction,
  SolanaSignAndSendTransactionFeature,
  SolanaSignAndSendTransactionMethod,
  SolanaSignMessage,
  SolanaSignMessageFeature,
  SolanaSignMessageMethod,
  SolanaSignTransaction,
  SolanaSignTransactionFeature,
  SolanaSignTransactionMethod,
} from "@solana/wallet-standard-features";
import {
  StandardConnect,
  StandardConnectFeature,
  StandardConnectMethod,
  StandardDisconnect,
  StandardDisconnectFeature,
  StandardDisconnectMethod,
  StandardEventsFeature,
  StandardEvents,
  StandardEventsOnMethod,
} from "@wallet-standard/features";
import { SOLANA_CHAINS } from "@solana/wallet-standard";
import { BrowserWallet } from "../core";
import { EventEmitter } from "@solana/wallet-adapter-base";
import { type SolanaTransactionCommitment } from "@solana/wallet-standard-features/src/signTransaction";
import { Connection } from "@solana/web3.js";
import { SolanaSignAndSendTransactionOutput } from "@solana/wallet-standard-features/src/signAndSendTransaction";

/**
 * Features supported by the BrowserStorageStandardWallet.
 */
type BrowserStorageWalletFeatures = StandardConnectFeature &
  StandardDisconnectFeature &
  StandardEventsFeature &
  SolanaSignAndSendTransactionFeature &
  SolanaSignTransactionFeature &
  SolanaSignMessageFeature;

/**
 * A Wallet Standard-compliant implementation that uses browser storage as the backing store for key management and signing.
 * Provides Solana transaction and message signing, connection, and event features.
 *
 * This wallet is intended for use in browser environments where private keys are managed in local storage or similar browser storage mechanisms.
 */
export class BrowserStorageStandardWallet extends EventEmitter implements Wallet {
  /**
   * @inheritDoc
   */
  readonly accounts: WalletAccount[] = [];

  /**
   * @inheritDoc
   */
  readonly icon: WalletIcon =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjwvc3ZnPg==";

  /**
   * @inheritDoc
   */
  readonly name: string = "BrowserStorage";

  /**
   * @inheritDoc
   */
  readonly version: WalletVersion = "1.0.0";

  /**
   * The Solana RPC connection client.
   */
  #client: Connection;

  /**
   * The underlying browser storage wallet instance for key management and signing.
   */
  #wallet: BrowserWallet;

  /**
   * Creates a new BrowserStorageStandardWallet instance.
   * @param client - The Solana RPC connection client
   * @param wallet - The underlying browser storage wallet instance
   */
  constructor(client: Connection, wallet: BrowserWallet) {
    super();
    this.#client = client;
    this.#wallet = wallet;
  }

  /**
   * @inheritDoc
   */
  get chains() {
    return SOLANA_CHAINS.slice();
  }

  /**
   * @inheritDoc
   */
  get features(): BrowserStorageWalletFeatures {
    return {
      [StandardConnect]: {
        version: "1.0.0",
        connect: this.#connect,
      },
      [StandardDisconnect]: {
        version: "1.0.0",
        disconnect: this.#disconnect,
      },
      [StandardEvents]: {
        version: "1.0.0",
        on: this.#on,
      },
      [SolanaSignAndSendTransaction]: {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signAndSendTransaction: this.#signAndSendTransaction,
      },
      [SolanaSignTransaction]: {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signTransaction: this.#signTransaction,
      },
      [SolanaSignMessage]: {
        version: "1.1.0",
        signMessage: this.#signMessage,
      },
    };
  }

  /**
   * @see {@link StandardConnectMethod}
   */
  #connect: StandardConnectMethod = async ({ silent } = {}) => {
    if (this.accounts.length > 0) {
      return {
        accounts: this.accounts,
      };
    }
    const account = await this.#wallet.connect({ silent });
    const walletAccount: WalletAccount = {
      address: account.address,
      publicKey: account.publicKey.toBytes(),
      chains: this.chains,
      features: [SolanaSignAndSendTransaction, SolanaSignTransaction, SolanaSignMessage],
      icon: this.icon,
    };

    this.accounts.push(walletAccount);
    this.emit("change", {
      chains: this.chains,
      features: this.features,
      accounts: this.accounts,
    });

    return {
      accounts: [walletAccount],
    };
  };

  /**
   * @see {@link StandardDisconnectMethod}
   */
  #disconnect: StandardDisconnectMethod = async () => {
    if (this.accounts.length === 0) {
      return;
    }
    await this.#wallet.disconnect();
    this.accounts.pop();
    this.emit("change", {
      accounts: this.accounts,
    });
  };

  /**
   * @see {@link StandardEventsOnMethod}
   */
  #on: StandardEventsOnMethod = (event, listener) => {
    this.on(event, listener);
    return (): void => {
      this.off(event, listener);
    };
  };

  /**
   * @see {@link SolanaSignAndSendTransactionMethod}
   */
  #signAndSendTransaction: SolanaSignAndSendTransactionMethod = async (...inputs) => {
    const promises = inputs.map(async ({ transaction, chain, options }) => {
      if ((this.chains as string[]).indexOf(chain) === -1) {
        throw new Error(`Unsupported chain: ${chain}`);
      }
      const { commitment, skipPreflight, maxRetries } = options || {};
      const output = await this.#wallet.signTransaction(transaction);
      const result = await this.#client.sendRawTransaction(output.signedTransaction, {
        skipPreflight: skipPreflight ?? false,
        maxRetries: maxRetries ?? 3,
        preflightCommitment: (commitment as SolanaTransactionCommitment) || "confirmed",
      });
      return {
        signature: Uint8Array.from(result),
      } as SolanaSignAndSendTransactionOutput;
    });
    return Promise.all(promises);
  };

  /**
   * @see {@link SolanaSignTransactionMethod}
   */
  #signTransaction: SolanaSignTransactionMethod = async (...inputs) => {
    const promises = inputs.map(async ({ transaction, account }) => {
      if ((this.chains as string[]).indexOf(account.chains[0]) === -1) {
        throw new Error(`Unsupported chain: ${account.chains[0]}`);
      }
      return await this.#wallet.signTransaction(transaction);
    });
    return Promise.all(promises);
  };

  /**
   * @see {@link SolanaSignMessageMethod}
   */
  #signMessage: SolanaSignMessageMethod = async (...inputs) => {
    const promises = inputs.map(async ({ message, account }) => {
      if ((this.chains as string[]).indexOf(account.chains[0]) === -1) {
        throw new Error(`Unsupported chain: ${account.chains[0]}`);
      }
      return await this.#wallet.signMessage(message);
    });
    return Promise.all(promises);
  };
}
