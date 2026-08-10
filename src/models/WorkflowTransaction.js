import mongoose from 'mongoose';

const WorkflowTransactionSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  workflow_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Workflow', required: true },
  contact_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact' },
  conversation_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
  
  customer_name: { type: String },
  phone_number: { type: String, required: true },
  email: { type: String },
  
  service_name: { type: String },
  meeting_date: { type: Date },
  meeting_time: { type: String },
  meeting_id: { type: String },
  
  payment_amount: { type: Number },
  payment_currency: { type: String, default: 'INR' },
  payment_status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  transaction_id: { type: String }, // Razorpay Payment ID or Order ID
  upi_id: { type: String }, // Target UPI ID for the payment
  
  status: { type: String, enum: ['in_progress', 'completed', 'cancelled'], default: 'in_progress' },
}, { timestamps: true });

export const WorkflowTransaction = mongoose.model('WorkflowTransaction', WorkflowTransactionSchema);
