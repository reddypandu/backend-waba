import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

mongoose.connect(process.env.MONGODB_URI || "mongodb+srv://yestick:sLqE6tC0wWixh6mU@cluster0.z2h2e.mongodb.net/yestick?retryWrites=true&w=majority")
  .then(async () => {
    const { Workflow } = await import('./src/models/Automation.js');
    const workflows = await Workflow.find({});
    console.log(JSON.stringify(workflows, null, 2));
    process.exit(0);
  });
