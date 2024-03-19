import * as Bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { Request, Response } from "express";
import axios from "axios";
import raffleModel from "../model/raffleModel";
import {
  combinePsbt,
  generateSendBTCPSBT,
  generateSendOrdinalPSBT,
} from "../service/psbt.service";
import { LocalWallet } from "../service/localWallet";
import {
  testVersion,
  WalletTypes,
  OPENAPI_UNISAT_TOKEN,
  OPENAPI_UNISAT_URL,
} from "../config/config";
import { chooseWinner } from "../service/utils.service";
import { sendInscription } from "../service/unisat.service";

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
    const raffles = await raffleModel.find({ status: 0 });
    return res.status(200).json({ success: true, raffles });
  } catch (error) {
    console.log("Get Raffles Error : ", error);
    return res.status(500).json({ success: false });
  }
};

export const sendOrdinal = async (req: Request, res: Response) => {
  try {
    const { walletType, ordinalInscription, creatorPaymentAddress } = req.body;

    const { psbt, buyerPaymentsignIndexes } = await generateSendOrdinalPSBT(
      walletType,
      ordinalInscription,
      adminWallet.pubkey,
      adminWallet.address,
      adminWallet.pubkey,
      creatorPaymentAddress,
      0
    );

    return res.status(200).json({
      success: true,
      psbt: psbt,
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

    const userSignedPSBT = Bitcoin.Psbt.fromHex(signedPSBT);
    const signedPSBT1 = await adminWallet.signPsbt(userSignedPSBT);

    const txID = await combinePsbt(psbt, signedPSBT, signedPSBT1.toHex());
    console.log(txID);

    const currentDate = new Date().getTime();

    const newRaffle = new raffleModel({
      ticketPrice,
      ordinalInscription,
      ticketAmounts,
      ticketList: [],
      createTime: currentDate,
      endTime: currentDate + endTime * 1000,
      winner: "",
      creatorOrdinalAddress,
      creatorPaymentAddress,
      status: 0,
      walletType,
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

    return res
      .status(200)
      .json({ success: true, psbt, buyerPaymentsignIndexes });
  } catch (error) {
    console.log("Generate Buy Tickets PSBT Error : ", error);
    return res.status(500).json({ success: false });
  }
};

export const buyTicketsCombineAndPush = async (req: Request, res: Response) => {
  try {
    const { _id, buyerOrdinalAddress, psbt, signedPSBT, ticketCounts } =
      req.body;

    const txID = await combinePsbt(psbt, signedPSBT);
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
      status: 0,
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
      raffle.status = 1;
      await raffle.save();
      console.log(`${raffle._id} completed : ${txID}`);
    }
  } catch (error) {
    console.log("Choose Raffle Error : ", error);
    return false;
  }
};
