const mongoose = require('mongoose');
require('dotenv').config({ path: 'e:/downloads/whatsapp tool/wazpp-sai/waba-tool/backend-waba/.env' });

const Message = mongoose.model('Message', new mongoose.Schema({ 
  phone_number: String,
  status: String, 
  error_details: String,
  message_type: String,
  createdAt: Date
}));

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  // Find recent template failures
  const msgs = await Message.find({ 
    message_type: 'template',
    status: 'failed'
  }).sort({ createdAt: -1 }).limit(5);
  
  console.log(`Found ${msgs.length} failed templates:`);
  msgs.forEach(m => {
    console.log(` - Phone: ${m.phone_number}, Error: ${m.error_details}, Time: ${m.createdAt}`);
  });
  mongoose.connection.close();
}
run();
