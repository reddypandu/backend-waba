import mongoose from 'mongoose';

const WalletTransactionSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['credit', 'debit', 'recharge'], required: true },
  amount: { type: Number, required: true },
  balance_after: { type: Number },
  description: { type: String },
  reference_id: { type: String },
  status: { type: String, default: 'completed' },
}, { timestamps: true });

export default mongoose.model('WalletTransaction', WalletTransactionSchema);
