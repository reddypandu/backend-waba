import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const Workflow = (await import('./src/models/Automation.js')).Workflow;
  const workflows = await Workflow.find({});
  workflows.forEach(w => {
    console.log(`- ID: ${w._id}, Name: "${w.name}", Active: ${w.is_active}, TriggerType: ${w.trigger_type}, TriggerValue: "${w.trigger_value}"`);
  });
  process.exit(0);
});
