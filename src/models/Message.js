import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  conversation_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
  contact_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
  campaign_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign' },
  direction: { type: String, enum: ['inbound', 'outbound'], required: true },
  message_type: { type: String, enum: ['text', 'image', 'video', 'document', 'template', 'audio'], default: 'text' },
  content: { type: String },
  media_url: { type: String },
  template_name: { type: String },
  phone_number: { type: String },
  whatsapp_message_id: { type: String, unique: true, sparse: true },
  status: { type: String, enum: ['queued', 'sent', 'delivered', 'read', 'failed', 'replied'], default: 'queued' },
  error_details: { type: String },
}, { timestamps: true });

export default mongoose.model('Message', MessageSchema);
