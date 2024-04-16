import { default as mongoose, Schema } from "mongoose";

const UserInfoSchema = new Schema(
  {
    exist: { type: Number, default: 1 },
    goblinHoldersWalletList: { type: Array, default: [] },
    whiteListInscriptions: { type: Array, default: [] },
  },
  {
    timestamps: {
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  }
);

export default mongoose.model("UserInfoSchema", UserInfoSchema);
