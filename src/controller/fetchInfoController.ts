import axios from "axios";
import {
  GOBLIN_COLLECTIONS,
  ENABLE_COLLECTIONS,
  BIS_KEY,
  BIS_HOLDER_URL,
  BIS_INSCRIPTION_URL,
} from "../config/config";
import userInfoModel from "../model/userInfoModel";
import { THolderTypes, TInscriptionTypes } from "../propTypes";

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));
export const fetchGoblinHolders = async () => {
  try {
    const goblinHolders: string[] = [];
    for (const slug of GOBLIN_COLLECTIONS) {
      const res = await axios.get(`${BIS_HOLDER_URL}?slug=${slug}`, {
        headers: { "x-api-key": BIS_KEY },
      });
      res.data.data.map((users: THolderTypes) => {
        goblinHolders.push(users.wallet);
      });
    }

    const userModel = await userInfoModel.findOne({ exist: 1 });

    if (!userModel) {
      const newUserModel = new userInfoModel();
      newUserModel.goblinHoldersWalletList = goblinHolders;
      await newUserModel.save();
    } else {
      userModel.goblinHoldersWalletList = goblinHolders;
      await userModel.save();
    }
  } catch (error) {
    console.log(error);
  }
};

const fetchSlugInscriptions = async (slug: string) => {
  try {
    const inscriptionList: string[] = [];
    let offset = 0;

    while (1) {
      await delay(1000);
      const res = await axios.get(
        `${BIS_INSCRIPTION_URL}?slug=${slug}&sort_by=inscr_num&order=asc&offset=${offset}&count=100`,
        {
          headers: { "x-api-key": BIS_KEY },
        }
      );
      const inscriptions = res.data.data.map(
        (inscriptions: TInscriptionTypes) => inscriptions.inscription_id
      );
      inscriptionList.push(...inscriptions);
      if (res.data.data.length < 100) break;
      offset += 100;
    }
    return inscriptionList;
  } catch (error) {
    console.log(error);
    return [];
  }
};

export const fetchAllowInscriptions = async () => {
  try {
    const allowInscriptions: string[] = [];

    const userModel = await userInfoModel.findOne({ exist: 1 });

    if (userModel && userModel.whiteListInscriptions.length !== 0) {
      console.log("Update Aborted!");
      return;
    }

    for (const slug of ENABLE_COLLECTIONS) {
      const inscriptions = await fetchSlugInscriptions(slug);
      allowInscriptions.push(...inscriptions);
    }

    if (!userModel) {
      const newUserModel = new userInfoModel();
      newUserModel.whiteListInscriptions = allowInscriptions;
      await newUserModel.save();
    } else {
      userModel.whiteListInscriptions = allowInscriptions;
      await userModel.save();
    }

    console.log("fetch White List Inscriptions Updated");
  } catch (error) {
    console.log(error);
  }
};
