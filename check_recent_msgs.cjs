const mongoose = require('mongoose');
require('dotenv').config({ path: 'e:/downloads/whatsapp tool/wazpp-sai/waba-tool/backend-waba/.env' });

const MessageSchema = new mongoose.Schema({
  template_name: String,
  status: String,
  error_details: String,
  media_url: String,
  createdAt: Date
});

const Message = mongoose.model('Message', MessageSchema);

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('DB Connected');
    
    // Check messages from the last 10 minutes
    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
    const msgs = await Message.find({ createdAt: { $gte: tenMinsAgo }, message_type: 'template' }).sort({ createdAt: -1 });
    
    console.log(`Found ${msgs.length} recent template messages:`);
    msgs.forEach(m => {
      console.log(` - Template: ${m.template_name}, Status: ${m.status}, Media: ${m.media_url}`);
      if (m.error_details) console.log(`   ❌ Error: ${m.error_details}`);
    });
  } catch (e) {
    console.error(e);
  } finally {
    mongoose.connection.close();
  }
}

run();
