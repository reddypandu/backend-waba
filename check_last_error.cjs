const mongoose = require('mongoose');
require('dotenv').config({ path: 'e:/downloads/whatsapp tool/wazpp-sai/waba-tool/backend-waba/.env' });

const Message = mongoose.model('Message', new mongoose.Schema({ status: String, error_details: String, template_name: String }));

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const msg = await Message.findOne({ status: 'failed' }).sort({ createdAt: -1 });
  console.log('Last Failed Message Error Details:', msg?.error_details);
  mongoose.connection.close();
}
run();
