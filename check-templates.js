import mongoose from 'mongoose';
import Template from './src/models/Template.js';
import dotenv from 'dotenv';
dotenv.config();

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const count = await Template.countDocuments({});
  console.log('Total templates:', count);
  const all = await Template.find({});
  console.log('Templates:', JSON.stringify(all, null, 2));
  process.exit(0);
}
check();
