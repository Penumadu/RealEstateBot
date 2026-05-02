import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import botRouter from "./bot.js";
import uploadRouter from "./upload.js";
import dashboardRouter from "./dashboard.js";
import fieldsRouter from "./fields.js";
import mapperRouter from "./mapper.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botRouter);
router.use(uploadRouter);
router.use(dashboardRouter);
router.use(fieldsRouter);
router.use(mapperRouter);

export default router;
