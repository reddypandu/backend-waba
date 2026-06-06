import mongoose from 'mongoose';

const ConversationSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  contact_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
  phone_number: { type: String },
  status: { type: String, enum: ['open', 'resolved', 'pending'], default: 'open' },
  last_message: { type: String },
  last_message_at: { type: Date, default: Date.now },
  unread_count: { type: Number, default: 0 },
  workflow_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Workflow' },
  workflow_step_id: { type: String },
  workflow_data: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

export default mongoose.model('Conversation', ConversationSchema);
