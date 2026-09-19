import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { configSchema, definePeriodTools } from "./adapters/openclaw/tools.js";

export default defineToolPlugin({
  id: "period-tracker",
  name: "Period Tracker",
  description:
    "Personal menstrual cycle tracking: record period start and end dates, review history, and predict the next period from recent cycles.",
  configSchema,
  tools: definePeriodTools,
});
