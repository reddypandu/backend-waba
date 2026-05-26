import User from '../models/User.js';

export const checkQuota = (requiredAmount = 1) => {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Basic tier limits
      const limits = {
        free: 100,
        starter: 1000,
        pro: 10000,
      };

      const plan = user.subscription?.plan || 'free';
      const limit = limits[plan];
      const used = user.subscription?.messages_used || 0;

      if (used + requiredAmount > limit) {
        return res.status(402).json({ 
          error: 'Payment Required: Quota exceeded. Please upgrade your plan.' 
        });
      }

      next();
    } catch (error) {
      console.error('checkQuota error:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  };
};
