import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Template from './src/models/Template.js';

dotenv.config();

async function checkTemplates() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const templates = await Template.find({ local_url: { $exists: true, $ne: null } });
    console.log(`Checking ${templates.length} templates with local_url:`);
    templates.forEach(t => {
      console.log(`- ${t.name}: ${t.local_url}`);
    });
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkTemplates();
