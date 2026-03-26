import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MessageSchema = new mongoose.Schema({ user_id: mongoose.Schema.Types.ObjectId, conversation_id: mongoose.Schema.Types.ObjectId, content: String, phone_number: String });
const Message = mongoose.models.Message || mongoose.model('Message', MessageSchema);
const WhatsAppAccountSchema = new mongoose.Schema({ user_id: mongoose.Schema.Types.ObjectId, waba_id: String });
const WhatsAppAccount = mongoose.models.WhatsAppAccount || mongoose.model('WhatsAppAccount', WhatsAppAccountSchema);

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const ms = await Message.find({}).limit(10);
  console.log('Sample Messages:', JSON.stringify(ms, null, 2));
  const wa = await WhatsAppAccount.find({});
  console.log('WhatsApp Accounts:', JSON.stringify(wa, null, 2));
  process.exit(0);
}
check();
