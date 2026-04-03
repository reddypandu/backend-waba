const mongoose = require('mongoose');
require('dotenv').config({ path: 'e:/downloads/whatsapp tool/wazpp-sai/waba-tool/backend-waba/.env' });

const Message = mongoose.model('Message', new mongoose.Schema({ 
  phone_number: String,
  status: String, 
  error_details: String,
  createdAt: Date
}));

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const msg = await Message.findOne({ phone_number: '918008457750' }).sort({ createdAt: -1 });
  console.log('Target Message found:', !!msg);
  if (msg) {
    console.log('Status:', msg.status);
    console.log('Error Details:', msg.error_details);
    console.log('Raw Msg:', JSON.stringify(msg));
  }
  mongoose.connection.close();
}
run();
