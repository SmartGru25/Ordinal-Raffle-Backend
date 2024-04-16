import * as Bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import axios from "axios";
import {
  testVersion,
  OPENAPI_UNISAT_URL,
  OPENAPI_UNISAT_TOKEN,
  SIGNATURE_SIZE,
  SERVICE_FEE_PERCENT,
  ADMIN_PAYMENT_ADDRESS,
} from "../config/config";
import { WalletTypes } from "../config/config";
import { IUtxo } from "../types/types";

Bitcoin.initEccLib(ecc);
const network = testVersion
  ? Bitcoin.networks.testnet
  : Bitcoin.networks.bitcoin;

// Get Inscription UTXO
const getInscriptionWithUtxo = async (inscriptionId: string) => {
  try {
    const url = `${OPENAPI_UNISAT_URL}/v1/indexer/inscription/info/${inscriptionId}`;

    const config = {
      headers: {
        Authorization: `Bearer ${OPENAPI_UNISAT_TOKEN}`,
      },
    };

    const res = await axios.get(url, config);

    if (res.data.code === -1) throw "Invalid inscription id";

    return {
      address: res.data.data.address,
      contentType: res.data.data.contentType,
      inscriptionId: inscriptionId,
      inscriptionNumber: res.data.data.inscriptionNumber,
      txid: res.data.data.utxo.txid,
      value: res.data.data.utxo.satoshi,
      vout: res.data.data.utxo.vout,
      scriptpubkey: res.data.data.utxo.scriptPk,
    };
  } catch (error) {
    console.log(
      `Ordinal api is not working now, please try again later Or invalid inscription id ${inscriptionId}`
    );
    throw "Invalid inscription id";
  }
};

// Get BTC UTXO
const getBtcUtxoByAddress = async (address: string) => {
  const url = `${OPENAPI_UNISAT_URL}/v1/indexer/address/${address}/utxo-data`;

  const config = {
    headers: {
      Authorization: `Bearer ${OPENAPI_UNISAT_TOKEN}`,
    },
  };

  let cursor = 0;
  const size = 5000;
  const utxos: IUtxo[] = [];

  while (1) {
    const res = await axios.get(url, { ...config, params: { cursor, size } });

    if (res.data.code === -1) throw "Invalid Address";

    utxos.push(
      ...(res.data.data.utxo as any[]).map((utxo) => {
        return {
          scriptpubkey: utxo.scriptPk,
          txid: utxo.txid,
          value: utxo.satoshi,
          vout: utxo.vout,
        };
      })
    );

    cursor += res.data.data.utxo.length;

    if (cursor === res.data.data.total) break;
  }

  return utxos;
};

// Get Current Network Fee
const getFeeRate = async () => {
  try {
    const url = `https://mempool.space/${
      testVersion ? "testnet/" : ""
    }api/v1/fees/recommended`;

    const res = await axios.get(url);

    return res.data.fastestFee;
  } catch (error) {
    console.log("Ordinal api is not working now. Try again later");
    return -1;
  }
};

// Calc Tx Fee
const calculateTxFee = (psbt: Bitcoin.Psbt, feeRate: number) => {
  const tx = new Bitcoin.Transaction();

  for (let i = 0; i < psbt.txInputs.length; i++) {
    const txInput = psbt.txInputs[i];
    tx.addInput(txInput.hash, txInput.index, txInput.sequence);
    tx.setWitness(i, [Buffer.alloc(SIGNATURE_SIZE)]);
  }

  for (let txOutput of psbt.txOutputs) {
    tx.addOutput(txOutput.script, txOutput.value);
  }
  tx.addOutput(psbt.txOutputs[0].script, psbt.txOutputs[0].value);
  tx.addOutput(psbt.txOutputs[0].script, psbt.txOutputs[0].value);

  return tx.virtualSize() * feeRate;
};

const getTxHexById = async (txId: string) => {
  try {
    const { data } = await axios.get(
      `https://mempool.space/${testVersion ? "testnet/" : ""}api/tx/${txId}/hex`
    );

    return data as string;
  } catch (error) {
    console.log("Mempool api error. Can not get transaction hex");

    throw "Mempool api is not working now. Try again later";
  }
};

// Generate Send Ordinal PSBT
export const generateSendOrdinalPSBT = async (
  sellerWalletType: WalletTypes,
  buyerWalletType: WalletTypes,
  inscriptionId: string,
  buyerPaymentPubkey: string,
  buyerOrdinalAddress: string,
  buyerOrdinalPubkey: string,
  sellerPaymentAddress: string,
  sellerOrdinalPubkey: string,
  price: number
) => {
  console.log("inscription id", inscriptionId);
  const sellerInscriptionsWithUtxo = await getInscriptionWithUtxo(
    inscriptionId
  );
  const sellerScriptpubkey = Buffer.from(
    sellerInscriptionsWithUtxo.scriptpubkey,
    "hex"
  );
  const psbt = new Bitcoin.Psbt({ network: network });

  // Add Inscription Input
  psbt.addInput({
    hash: sellerInscriptionsWithUtxo.txid,
    index: sellerInscriptionsWithUtxo.vout,
    witnessUtxo: {
      value: sellerInscriptionsWithUtxo.value,
      script: sellerScriptpubkey,
    },
    tapInternalKey:
      sellerWalletType === WalletTypes.XVERSE ||
      sellerWalletType === WalletTypes.OKX
        ? Buffer.from(sellerOrdinalPubkey, "hex")
        : Buffer.from(sellerOrdinalPubkey, "hex").slice(1, 33),
  });

  // Add Inscription Output to buyer's address
  psbt.addOutput({
    address: buyerOrdinalAddress,
    value: sellerInscriptionsWithUtxo.value,
  });

  let paymentAddress, paymentoutput;

  if (buyerWalletType === WalletTypes.XVERSE) {
    const hexedPaymentPubkey = Buffer.from(buyerPaymentPubkey, "hex");
    const p2wpkh = Bitcoin.payments.p2wpkh({
      pubkey: hexedPaymentPubkey,
      network: network,
    });

    const { address, redeem } = Bitcoin.payments.p2sh({
      redeem: p2wpkh,
      network: network,
    });

    paymentAddress = address;
    paymentoutput = redeem?.output;
  } else if (
    buyerWalletType === WalletTypes.UNISAT ||
    buyerWalletType === WalletTypes.OKX
  ) {
    paymentAddress = buyerOrdinalAddress;
  }

  const btcUtxos = await getBtcUtxoByAddress(paymentAddress as string);
  const feeRate = await getFeeRate();

  let amount = 0;

  const buyerPaymentsignIndexes: number[] = [];

  for (const utxo of btcUtxos) {
    const fee = calculateTxFee(psbt, feeRate);

    if (amount < price + fee && utxo.value > 10000) {
      amount += utxo.value;

      buyerPaymentsignIndexes.push(psbt.inputCount);

      if (
        buyerWalletType === WalletTypes.UNISAT ||
        buyerWalletType === WalletTypes.OKX
      ) {
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            value: utxo.value,
            script: Buffer.from(utxo.scriptpubkey as string, "hex"),
          },
          tapInternalKey:
            buyerWalletType === WalletTypes.OKX
              ? Buffer.from(buyerOrdinalPubkey, "hex")
              : Buffer.from(buyerOrdinalPubkey, "hex").slice(1, 33),
          sighashType: Bitcoin.Transaction.SIGHASH_ALL,
        });
      } else if (buyerWalletType === WalletTypes.XVERSE) {
        const txHex = await getTxHexById(utxo.txid);

        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          redeemScript: paymentoutput,
          nonWitnessUtxo: Buffer.from(txHex, "hex"),
          sighashType: Bitcoin.Transaction.SIGHASH_ALL,
        });
      }
    }
  }

  const fee = calculateTxFee(psbt, feeRate);

  if (amount < price + fee)
    throw "You do not have enough bitcoin in your wallet";

  if (price > 0)
    psbt.addOutput({ address: sellerPaymentAddress, value: price });

  psbt.addOutput({
    address: paymentAddress as string,
    value: amount - price - fee,
  });

  return {
    psbt: psbt,
    buyerPaymentsignIndexes,
  };
};

// Generate Send BTC PSBT
export const generateSendBTCPSBT = async (
  walletType: WalletTypes,
  buyerPaymentPubkey: string,
  buyerOrdinalAddress: string,
  buyerOrdinalPubkey: string,
  sellerPaymentAddress: string,
  price: number,
  collectionOwner: boolean
) => {
  const psbt = new Bitcoin.Psbt({ network: network });

  // Add Inscription Input
  let paymentAddress, paymentoutput;

  if (walletType === WalletTypes.XVERSE) {
    const hexedPaymentPubkey = Buffer.from(buyerPaymentPubkey, "hex");
    const p2wpkh = Bitcoin.payments.p2wpkh({
      pubkey: hexedPaymentPubkey,
      network: network,
    });

    const { address, redeem } = Bitcoin.payments.p2sh({
      redeem: p2wpkh,
      network: network,
    });

    paymentAddress = address;
    paymentoutput = redeem?.output;
  } else if (
    walletType === WalletTypes.UNISAT ||
    walletType === WalletTypes.OKX
  ) {
    paymentAddress = buyerOrdinalAddress;
  } else if (walletType === WalletTypes.HIRO) {
    const hexedPaymentPubkey = Buffer.from(buyerPaymentPubkey, "hex");
    const { address, output } = Bitcoin.payments.p2wpkh({
      pubkey: hexedPaymentPubkey,
      network: network,
    });
    paymentAddress = address;
  }

  console.log(paymentAddress);
  const btcUtxos = await getBtcUtxoByAddress(paymentAddress as string);
  const feeRate = await getFeeRate();

  let amount = 0;

  const buyerPaymentsignIndexes: number[] = [];

  for (const utxo of btcUtxos) {
    if (amount < price && utxo.value > 10000) {
      amount += utxo.value;

      buyerPaymentsignIndexes.push(psbt.inputCount);

      if (walletType === WalletTypes.UNISAT || walletType === WalletTypes.OKX) {
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            value: utxo.value,
            script: Buffer.from(utxo.scriptpubkey as string, "hex"),
          },
          tapInternalKey:
            walletType === WalletTypes.OKX
              ? Buffer.from(buyerOrdinalPubkey, "hex")
              : Buffer.from(buyerOrdinalPubkey, "hex").slice(1, 33),
          sighashType: Bitcoin.Transaction.SIGHASH_ALL,
        });
      } else if (walletType === WalletTypes.HIRO) {
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            value: utxo.value,
            script: Buffer.from(utxo.scriptpubkey as string, "hex"),
          },
        });
      } else if (walletType === WalletTypes.XVERSE) {
        const txHex = await getTxHexById(utxo.txid);

        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          redeemScript: paymentoutput,
          nonWitnessUtxo: Buffer.from(txHex, "hex"),
          sighashType: Bitcoin.Transaction.SIGHASH_ALL,
        });
      }
    }
  }

  const serviceFee = collectionOwner ? 0 : SERVICE_FEE_PERCENT;

  if (price > 0) {
    psbt.addOutput({
      address: sellerPaymentAddress,
      value: parseInt(
        (((price * (100 - serviceFee)) / 100) * 10 ** 8).toString()
      ),
    });
    if (!collectionOwner)
      psbt.addOutput({
        address: ADMIN_PAYMENT_ADDRESS,
        value: parseInt((((price * serviceFee) / 100) * 10 ** 8).toString()),
      });
  }

  const fee = calculateTxFee(psbt, feeRate);

  if (amount < price + fee)
    throw "You do not have enough bitcoin in your wallet";

  psbt.addOutput({
    address: paymentAddress as string,
    value: amount - parseInt((price * 10 ** 8).toString()) - fee,
  });

  console.log(psbt.toBase64());

  return {
    psbt: psbt,
    buyerPaymentsignIndexes,
  };
};

export const combinePsbt = async (
  hexedPsbt: string,
  signedHexedPsbt1: string,
  signedHexedPsbt2?: string
) => {
  try {
    const psbt = Bitcoin.Psbt.fromHex(hexedPsbt);
    const signedPsbt1 = Bitcoin.Psbt.fromHex(signedHexedPsbt1);
    if (signedHexedPsbt2) {
      const signedPsbt2 = Bitcoin.Psbt.fromHex(signedHexedPsbt2);
      psbt.combine(signedPsbt1, signedPsbt2);
    } else {
      psbt.combine(signedPsbt1);
    }
    const tx = psbt.extractTransaction();
    const txHex = tx.toHex();

    const txId = await pushRawTx(txHex);
    return txId;
  } catch (error) {
    console.log(error);
    throw error;
  }
};

export const pushRawTx = async (rawTx: string) => {
  const txid = await postData(
    `https://mempool.space/${testVersion ? "testnet/" : ""}api/tx`,
    rawTx
  );
  console.log("pushed txid", txid);
  return txid;
};

const postData = async (
  url: string,
  json: any,
  content_type = "text/plain",
  apikey = ""
) => {
  while (1) {
    try {
      const headers: any = {};

      if (content_type) headers["Content-Type"] = content_type;

      if (apikey) headers["X-Api-Key"] = apikey;
      const res = await axios.post(url, json, {
        headers,
      });

      return res.data;
    } catch (err: any) {
      const axiosErr = err;
      console.log("push tx error", axiosErr.response?.data);

      if (
        !(axiosErr.response?.data).includes(
          'sendrawtransaction RPC error: {"code":-26,"message":"too-long-mempool-chain,'
        )
      )
        throw new Error("Got an err when push tx");
    }
  }
};

export const finalizePsbtInput = (hexedPsbt: string, inputs: number[]) => {
  const psbt = Bitcoin.Psbt.fromHex(hexedPsbt);
  inputs.forEach((input) => psbt.finalizeInput(input));
  return psbt.toHex();
};
