import mongoose from "mongoose";
import crypto from "crypto";

const apiKeySchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  key: { type: String, unique: true },
  is_active: { type: Boolean, default: true },
  last_used_at: Date,
  createdAt: { type: Date, default: Date.now }
});

// Auto generate key before save
apiKeySchema.pre("save", function() {
  if (!this.key) {
    this.key = "yt_" + crypto.randomBytes(32).toString("hex");
  }
});

export default mongoose.model("ApiKey", apiKeySchema);