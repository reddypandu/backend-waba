import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const Workflow = (await import('./src/models/Automation.js')).Workflow;
  const wfs = await Workflow.find({ is_active: true }).sort({ createdAt: 1 });
  let text = "Scheduled meeting";
  let matched = null;
  for (const wf of wfs) {
      if (wf.trigger_type === "message_received") {
          matched = wf;
          break;
      } else if (wf.trigger_type === "keyword_match" && wf.trigger_value) {
          const trigger = String(wf.trigger_value).trim().toLowerCase();
          if (text.toLowerCase() === trigger || text.toLowerCase().includes(trigger)) {
              matched = wf;
              break;
          }
      }
  }
  console.log("Matched workflow:", matched.name);
  process.exit(0);
});
