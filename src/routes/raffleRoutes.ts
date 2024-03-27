import express from "express";
import {
  sendOrdinal,
  sendOrdinalCombineAndPush,
  buyTickets,
  buyTicketsCombineAndPush,
  getRaffles,
  getRaffleHistory,
} from "../controller/raffleController";

const router = express.Router();

// Middleware for logging requests to this router
router.use((req, res, next) => {
  console.log(`Raffle request received: ${req.method} ${req.originalUrl}`);
  next();
});

router.get("/get-raffles", async (req, res, next) => {
  try {
    await getRaffles(req, res);
  } catch (error) {
    next(error);
  }
});

router.get("/get-raffle-history/:ordinalAddress", async (req, res, next) => {
  try {
    await getRaffleHistory(req, res);
  } catch (error) {
    next(error);
  }
});

router.post("/send-ordinal", async (req, res, next) => {
  try {
    await sendOrdinal(req, res);
  } catch (error) {
    next(error);
  }
});

router.post("/send-ordinal-combine-push", async (req, res, next) => {
  try {
    await sendOrdinalCombineAndPush(req, res);
  } catch (error) {
    next(error);
  }
});

router.post("/buy-tickets", async (req, res, next) => {
  try {
    await buyTickets(req, res);
  } catch (error) {
    next(error);
  }
});

router.post("/buy-tickets-combine-push", async (req, res, next) => {
  try {
    await buyTicketsCombineAndPush(req, res);
  } catch (error) {
    next(error);
  }
});

export default router;
