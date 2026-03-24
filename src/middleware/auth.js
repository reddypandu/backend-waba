import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');

    const user = await User.findById(decoded.id).select('-password');
    if (!user) return res.status(401).json({ error: 'Unauthorized: User not found' });

    req.user = { id: user._id, email: user.email, full_name: user.full_name, role: user.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}
