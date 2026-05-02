import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import botRouter from "./bot.js";
import uploadRouter from "./upload.js";
import dashboardRouter from "./dashboard.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botRouter);
router.use(uploadRouter);
router.use(dashboardRouter);

export default router;
