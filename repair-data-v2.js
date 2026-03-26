import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const Message = mongoose.models.Message || mongoose.model('Message', new mongoose.Schema({ 
  user_id: mongoose.Schema.Types.ObjectId, 
  conversation_id: mongoose.Schema.Types.ObjectId,
  contact_id: mongoose.Schema.Types.ObjectId,
  phone_number: String,
  from: String,
  to: String,
  direction: String,
  content: String,
  text: String
}, { strict: false })); // Use strict: false to access all fields

const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', new mongoose.Schema({
  user_id: mongoose.Schema.Types.ObjectId,
  contact_id: mongoose.Schema.Types.ObjectId,
  phone_number: String,
  last_message: String,
  last_message_at: { type: Date, default: Date.now }
}));

const Contact = mongoose.models.Contact || mongoose.model('Contact', new mongoose.Schema({
  user_id: mongoose.Schema.Types.ObjectId,
  phone_number: String,
  name: String
}));

const WhatsAppAccount = mongoose.models.WhatsAppAccount || mongoose.model('WhatsAppAccount', new mongoose.Schema({
  user_id: mongoose.Schema.Types.ObjectId
}));

async function repair() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('--- ADVANCED REPAIR START ---');
    
    // Get default user if not clear
    const defaultAccount = await WhatsAppAccount.findOne({});
    const defaultUserId = defaultAccount?.user_id;

    const messages = await Message.find({ conversation_id: { $exists: false } });
    console.log(`Found ${messages.length} orphaned messages.`);
    
    for (const msg of messages) {
      const direction = msg.direction || 'inbound';
      // In old format, phone is in 'from' (inbound) or 'to' (outbound)
      const phone = msg.phone_number || (direction === 'inbound' ? msg.from : msg.to);
      const userId = msg.user_id || defaultUserId;

      if (!phone || !userId) {
        console.log(`Skipping msg ${msg._id}: No phone or user found.`);
        continue;
      }
      
      let contact = await Contact.findOne({ user_id: userId, phone_number: phone });
      if (!contact) {
        contact = await Contact.create({ user_id: userId, phone_number: phone, name: phone });
      }
      
      let conv = await Conversation.findOne({ user_id: userId, contact_id: contact._id });
      if (!conv) {
        conv = await Conversation.create({ 
          user_id: userId, 
          contact_id: contact._id, 
          phone_number: phone,
          last_message: msg.content || msg.text || '[Media]',
          last_message_at: msg.createdAt || msg.timestamp || new Date()
        });
      }
      
      await Message.findByIdAndUpdate(msg._id, { 
        user_id: userId,
        conversation_id: conv._id, 
        contact_id: contact._id,
        phone_number: phone,
        content: msg.content || msg.text,
        message_type: msg.message_type || 'text'
      });
      console.log(`Linked msg ${msg._id} to conv ${conv._id} for phone ${phone}`);
    }
    
    console.log('Advanced Repair complete!');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
repair();
