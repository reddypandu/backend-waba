import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const User = (await import('./src/models/User.js')).default;
  const Workflow = (await import('./src/models/Automation.js')).Workflow;
  
  const users = await User.find({});
  console.log("USERS IN DB:");
  users.forEach(u => console.log(`- User ID: ${u._id}, Email: ${u.email}`));
  
  const wfs = await Workflow.find({});
  console.log("\nWORKFLOWS IN DB:");
  wfs.forEach(w => console.log(`- Workflow ID: ${w._id}, UserID: ${w.user_id}, Name: "${w.name}", Active: ${w.is_active}, Type: ${w.workflow_type}`));
  
  process.exit(0);
});
