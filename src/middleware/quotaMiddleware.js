import User from '../models/User.js';

const normalizePlan = (plan) => {
  if (!plan) return 'free';
  if (plan === 'pro') return 'professional';
  return plan;
};

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

      const limits = {
        free: 100,
        starter: 1000,
        growth: 10000,
        professional: 100000,
      };

      const plan = normalizePlan(user.subscription?.plan || 'free');
      const limit = limits[plan] ?? limits.free;
      const used = user.subscription?.messages_used || 0;

      if (used + requiredAmount > limit) {
        return res.status(402).json({
          error: 'Payment Required: Quota exceeded. Please upgrade your plan.',
        });
      }

      next();
    } catch (error) {
      console.error('checkQuota error:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  };
};
