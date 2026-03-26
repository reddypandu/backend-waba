import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

// Define models if not registered
const TemplateSchema = new mongoose.Schema({ user_id: mongoose.Schema.Types.ObjectId, name: String, status: String });
const ConversationSchema = new mongoose.Schema({ user_id: mongoose.Schema.Types.ObjectId, phone_number: String, last_message: String });
const MessageSchema = new mongoose.Schema({ user_id: mongoose.Schema.Types.ObjectId, conversation_id: mongoose.Schema.Types.ObjectId, content: String });

const Template = mongoose.models.Template || mongoose.model('Template', TemplateSchema);
const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', ConversationSchema);
const Message = mongoose.models.Message || mongoose.model('Message', MessageSchema);

async function check() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('--- DB CHECK ---');
    const tCount = await Template.countDocuments({});
    console.log('Templates Count:', tCount);
    const ts = await Template.find({}).limit(5);
    console.log('Sample Templates:', JSON.stringify(ts, null, 2));

    const cCount = await Conversation.countDocuments({});
    console.log('Conversations Count:', cCount);
    const cs = await Conversation.find({}).limit(5);
    console.log('Sample Conversations:', JSON.stringify(cs, null, 2));

    const mCount = await Message.countDocuments({});
    console.log('Messages Count:', mCount);
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
check();
