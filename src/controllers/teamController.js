import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import WhatsAppAccount from '../models/WhatsAppAccount.js';

export class TeamController {
  
  static async getTeamMembers(req, res) {
    try {
      // In a real SaaS, we would group by company_id. 
      // For now, if the current user is 'admin', they see all users (or we can just show users sharing the same WABA account).
      // Assuming 'admin' is a top-level role for the whole platform for now, or if they are a 'manager' for a specific account.
      // Let's just list all users if admin.
      if (req.user.role !== 'admin' && req.user.role !== 'manager') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const members = await User.find({}, '-password').sort({ createdAt: -1 });
      res.json({ members });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async inviteAgent(req, res) {
    try {
      const { email, full_name, password, role } = req.body;
      
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ error: 'User already exists' });
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      const newUser = await User.create({
        email,
        full_name,
        password: hashedPassword,
        role: role || 'user'
      });

      res.status(201).json({ success: true, message: 'Agent invited successfully', user: { id: newUser._id, email: newUser.email, role: newUser.role } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async updateRole(req, res) {
    try {
      const { role } = req.body;
      const { id } = req.params;

      const user = await User.findByIdAndUpdate(id, { role }, { new: true, select: '-password' });
      if (!user) return res.status(404).json({ error: 'User not found' });

      res.json({ success: true, user });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
}
