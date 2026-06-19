import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const TemplateSchema = new mongoose.Schema({}, { strict: false });
const Template = mongoose.models.Template || mongoose.model('Template', TemplateSchema);

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const templates = await Template.find({
    name: { $in: ['registration_success', 'upgrade_success'] }
  }).select('name language status category');
  console.log("Found templates:");
  console.log(JSON.stringify(templates, null, 2));
  process.exit(0);
}
run();
