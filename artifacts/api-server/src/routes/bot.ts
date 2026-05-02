import { Router } from "express";

const router = Router();

router.get("/bot/status", (_req, res) => {
  res.json({ status: "running", message: "Telegram bot is active" });
});

export default router;
