import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Template from './src/models/Template.js';

dotenv.config();

async function checkAllTemplates() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const templates = await Template.find({});
    console.log(`Found ${templates.length} total templates:`);
    templates.forEach(t => {
      console.log(`- ${t.name} (Status: ${t.status}): Local URL = ${t.local_url || 'None'}`);
    });
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkAllTemplates();
