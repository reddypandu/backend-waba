import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

// Direct access to models via mongoose.model to avoid registration issues
const Message = mongoose.models.Message || mongoose.model('Message', new mongoose.Schema({ 
  user_id: mongoose.Schema.Types.ObjectId, 
  conversation_id: mongoose.Schema.Types.ObjectId,
  contact_id: mongoose.Schema.Types.ObjectId,
  phone_number: String,
  content: String
}));

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

async function repair() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('--- REPAIRING DATA ---');
    
    const messages = await Message.find({ conversation_id: null });
    console.log(`Found ${messages.length} orphaned messages.`);
    
    for (const msg of messages) {
      if (!msg.phone_number) continue;
      
      let contact = await Contact.findOne({ user_id: msg.user_id, phone_number: msg.phone_number });
      if (!contact) {
        contact = await Contact.create({ user_id: msg.user_id, phone_number: msg.phone_number, name: msg.phone_number });
      }
      
      let conv = await Conversation.findOne({ user_id: msg.user_id, contact_id: contact._id });
      if (!conv) {
        conv = await Conversation.create({ 
          user_id: msg.user_id, 
          contact_id: contact._id, 
          phone_number: msg.phone_number,
          last_message: msg.content || '[Media]',
          last_message_at: msg.createdAt || new Date()
        });
      }
      
      await Message.findByIdAndUpdate(msg._id, { conversation_id: conv._id, contact_id: contact._id });
      console.log(`Linked message ${msg._id} to conversation ${conv._id}`);
    }
    
    console.log('Repair complete!');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
repair();
