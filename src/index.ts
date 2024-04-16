import express, { Express, Request, Response } from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import bodyParser from "body-parser";
import cors from "cors";
import cron from "node-cron";
import raffleRoutes from "./routes/raffleRoutes";
import {
  chooseRaffleWinner,
  checkTxStatus,
} from "./controller/raffleController";
import {
  fetchGoblinHolders,
  fetchAllowInscriptions,
} from "./controller/fetchInfoController";

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 6000;

app.use(
  cors({
    credentials: true,
    origin: true,
  })
);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

mongoose
  .connect(process.env.MONGO_URI as string)
  .then(async () => {
    console.log("Connected to the database! ❤️");
    app.listen(port, async () => {
      console.log(`Server running on port ${port}`);
      await fetchGoblinHolders();
      fetchAllowInscriptions();
    });
  })
  .catch((err) => {
    console.log("Cannot connect to the database! 😭", err);
    process.exit();
  });

app.get("/", (req: Request, res: Response) => {
  res.send("<h3>Raffle API is up and running.</h3>");
});

app.use("/api/raffle", raffleRoutes);

let cnt = 0;
cron.schedule("*/5 * * * *", () => {
  console.log("Update Raffles Every 5 mins");
  chooseRaffleWinner();
  checkTxStatus();
  if (cnt === 3600 / 5) {
    fetchGoblinHolders();
    cnt = 0;
  }
  cnt++;
});
