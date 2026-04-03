const mongoose = require('mongoose');
require('dotenv').config({ path: 'e:/downloads/whatsapp tool/wazpp-sai/waba-tool/backend-waba/.env' });

const WhatsAppAccountSchema = new mongoose.Schema({
  user_id: mongoose.Schema.Types.ObjectId,
  phone_number_id: String,
  waba_id: String,
  webhook_verified: Boolean
});

const WhatsAppAccount = mongoose.model('WhatsAppAccount', WhatsAppAccountSchema);

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('DB Connected');
    
    const account = await WhatsAppAccount.findOne({});
    if (account) {
      console.log('Account Details:');
      console.log(' - PNID:', account.phone_number_id);
      console.log(' - WABA ID:', account.waba_id);
      console.log(' - Webhook Verified:', account.webhook_verified);
    } else {
      console.log('No WhatsApp account found in DB.');
    }
  } catch (e) {
    console.error(e);
  } finally {
    mongoose.connection.close();
  }
}

run();
