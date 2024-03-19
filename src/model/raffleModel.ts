import { default as mongoose, Schema } from "mongoose";

const RaffleSchema = new Schema(
  {
    ticketPrice: Number,
    ordinalInscription: String,
    ticketList: Array,
    ticketAmounts: Number,
    createTime: Number,
    endTime: Number,
    winner: String,
    creatorOrdinalAddress: String,
    creatorPaymentAddress: String,
    status: Number,
    walletType: String,
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  }
);

export default mongoose.model("RaffleSchema", RaffleSchema);
