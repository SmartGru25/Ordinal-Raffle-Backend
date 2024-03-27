import * as Bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { Request, Response } from "express";
import axios from "axios";
import raffleModel from "../model/raffleModel";
import {
  combinePsbt,
  generateSendBTCPSBT,
  generateSendOrdinalPSBT,
  finalizePsbtInput,
} from "../service/psbt.service";
import { LocalWallet } from "../service/localWallet";
import {
  testVersion,
  WalletTypes,
  OPENAPI_UNISAT_TOKEN,
  OPENAPI_UNISAT_URL,
  RaffleStatus,
} from "../config/config";
import { chooseWinner } from "../service/utils.service";
import { sendInscription } from "../service/unisat.service";
import { TRaffleTypes } from "../propTypes";

Bitcoin.initEccLib(ecc);

const key = process.env.ADMIN_PRIVATE_KEY;
if (typeof key !== "string" || key === "") {
  throw new Error(
    "Environment variable PRIVATE_KEY must be set and be a valid string."
  );
}
const adminWallet = new LocalWallet(key, testVersion ? 1 : 0);

export const getRaffles = async (req: Request, res: Response) => {
  try {
    const raffles = await raffleModel.find({ status: RaffleStatus.START });
    return res.status(200).json({ success: true, raffles });
  } catch (error) {
    console.log("Get Raffles Error : ", error);
    return res.status(500).json({ success: false });
  }
};

export const getRaffleHistory = async (req: Request, res: Response) => {
  try {
    const { ordinalAddress } = req.params;
    const raffles = await raffleModel.find({
      status: RaffleStatus.END,
      ticketList: ordinalAddress,
    });
    return res.status(200).json({ success: true, raffles });
  } catch (error) {
    console.log("Get Raffle History Error : ", error);
    return res.status(500).json({ success: false });
  }
};

export const sendOrdinal = async (req: Request, res: Response) => {
  try {
    const {
      walletType,
      ordinalInscription,
      creatorPaymentAddress,
      creatorOrdinalPubkey,
    } = req.body;

    const { psbt, buyerPaymentsignIndexes } = await generateSendOrdinalPSBT(
      walletType,
      WalletTypes.UNISAT,
      ordinalInscription,
      adminWallet.pubkey,
      adminWallet.address,
      adminWallet.pubkey,
      creatorPaymentAddress,
      creatorOrdinalPubkey,
      0
    );

    console.log("buyer payment sign indexes", buyerPaymentsignIndexes);

    return res.status(200).json({
      success: true,
      psbtHex: psbt.toHex(),
      psbtBase64: psbt.toBase64(),
      buyerPaymentsignIndexes: buyerPaymentsignIndexes,
    });
  } catch (error) {
    console.log("Send Ordinal PSBT Error : ", error);
    return res.status(500).json({ success: false });
  }
};

export const sendOrdinalCombineAndPush = async (
  req: Request,
  res: Response
) => {
  try {
    const {
      walletType,
      ticketPrice,
      ticketAmounts,
      ordinalInscription,
      endTime,
      creatorOrdinalAddress,
      creatorPaymentAddress,
      psbt,
      signedPSBT,
    } = req.body;

    let sellerSignPSBT;
    if (walletType === WalletTypes.XVERSE) {
      sellerSignPSBT = Bitcoin.Psbt.fromBase64(signedPSBT);
      sellerSignPSBT = await finalizePsbtInput(sellerSignPSBT.toHex(), [0]);
    } else if (walletType === WalletTypes.HIRO) {
      sellerSignPSBT = await finalizePsbtInput(signedPSBT, [0]);
    } else {
      sellerSignPSBT = signedPSBT;
    }

    const userSignedPSBT = Bitcoin.Psbt.fromHex(sellerSignPSBT);
    const signedPSBT1 = await adminWallet.signPsbt(userSignedPSBT);

    const txID = await combinePsbt(
      psbt,
      userSignedPSBT.toHex(),
      signedPSBT1.toHex()
    );
    console.log(txID);

    const currentDate = new Date().getTime();

    const newRaffle = new raffleModel({
      ticketPrice,
      ordinalInscription,
      ticketAmounts,
      createTime: currentDate,
      endTimePeriod: endTime,
      winner: "",
      creatorOrdinalAddress,
      creatorPaymentAddress,
      walletType,
      createRaffleTx: txID,
    });

    await newRaffle.save();

    return res.status(200).json({ success: true });
  } catch (error) {
    console.log("Send Ordinal and Combine PSBT Error : ", error);
    return res.status(500).json({ success: false });
  }
};

export const buyTickets = async (req: Request, res: Response) => {
  try {
    const {
      buyerPayPubkey,
      buyerOrdinalAddress,
      buyerOrdinalPubkey,
      ticketCounts,
      _id,
      walletType,
    } = req.body;
    const raffles: any = await raffleModel.findById(_id);
    if (
      raffles.ticketAmounts <
      raffles.ticketList.length + Number(ticketCounts)
    )
      return res
        .status(500)
        .json({ success: false, msg: "All of Tickets are sold" });

    const { psbt, buyerPaymentsignIndexes } = await generateSendBTCPSBT(
      walletType,
      buyerPayPubkey,
      buyerOrdinalAddress,
      buyerOrdinalPubkey,
      raffles.creatorPaymentAddress,
      raffles.ticketPrice * ticketCounts
    );

    return res.status(200).json({
      success: true,
      psbtHex: psbt.toHex(),
      psbtBase64: psbt.toBase64(),
      buyerPaymentsignIndexes,
    });
  } catch (error) {
    console.log("Generate Buy Tickets PSBT Error : ", error);
    return res.status(500).json({ success: false });
  }
};

export const buyTicketsCombineAndPush = async (req: Request, res: Response) => {
  try {
    const {
      _id,
      buyerOrdinalAddress,
      psbt,
      signedPSBT,
      ticketCounts,
      walletType,
    } = req.body;

    let sellerSignPSBT;
    if (walletType === WalletTypes.XVERSE) {
      sellerSignPSBT = Bitcoin.Psbt.fromBase64(signedPSBT);
      sellerSignPSBT = await finalizePsbtInput(sellerSignPSBT.toHex(), [0]);
    } else if (walletType === WalletTypes.HIRO) {
      sellerSignPSBT = await finalizePsbtInput(signedPSBT, [0]);
    } else {
      sellerSignPSBT = signedPSBT;
    }

    const txID = await combinePsbt(psbt, sellerSignPSBT);
    console.log(txID);
    const raffleUser: any = await raffleModel.findById(_id);
    const newArray = Array(Number(ticketCounts)).fill(buyerOrdinalAddress);
    raffleUser.ticketList = [...raffleUser.ticketList, ...newArray];
    await raffleUser.save();

    return res
      .status(200)
      .json({ success: true, msg: `${ticketCounts} tickets purchased` });
  } catch (error) {
    console.log("Buy Ticket and Combine PSBT Error : ", error);
    return res.status(500).json({ success: false });
  }
};

export const chooseRaffleWinner = async () => {
  try {
    const raffles = await raffleModel.find({
      status: RaffleStatus.START,
      endTime: { $lt: new Date().getTime() },
    });
    for (const raffle of raffles) {
      const selectedWinner =
        raffle.ticketList.length === 0
          ? raffle.creatorOrdinalAddress
          : await chooseWinner(raffle.ticketList);

      const res = await axios.get(
        `${OPENAPI_UNISAT_URL}/v1/indexer/inscription/info/${raffle.ordinalInscription}`,
        {
          headers: {
            Authorization: `Bearer ${OPENAPI_UNISAT_TOKEN}`,
          },
        }
      );

      const txID = await sendInscription(
        selectedWinner as string,
        raffle.ordinalInscription as string,
        100,
        res.data.data.utxo.satoshi
      );

      raffle.winner = selectedWinner;
      raffle.status = RaffleStatus.END;
      await raffle.save();
      console.log(`${raffle._id} completed : ${txID}`);
    }
  } catch (error) {
    console.log("Choose Raffle Error : ", error);
    return false;
  }
};

export const checkTxStatus = async () => {
  try {
    let _cnt = 0;
    const currentDate = new Date().getTime();
    const raffles: TRaffleTypes[] = await raffleModel.find({
      status: RaffleStatus.PENDING,
    });
    const completedRaffles = await Promise.all(
      raffles.map((raffle) =>
        axios.get(
          `https://mempool.space/${testVersion && "testnet/"}api/tx/${
            raffle.createRaffleTx
          }/status`
        )
      )
    );
    for (const indRaffleStatus of completedRaffles) {
      console.log(raffles[_cnt].createRaffleTx);
      if (indRaffleStatus.data.confirmed) {
        await raffleModel.findOneAndUpdate(
          {
            createRaffleTx: raffles[_cnt].createRaffleTx,
          },
          {
            createTime: currentDate,
            endTime: currentDate + raffles[_cnt].endTimePeriod * 1000,
            status: RaffleStatus.START,
          }
        );
      }
      _cnt++;
    }
  } catch (error) {
    console.log("Check Raffle Status : ", error);
    return false;
  }
};
