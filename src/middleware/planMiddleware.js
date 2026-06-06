import User from '../models/User.js';

export const normalizePlan = (plan) => {
  if (!plan) return 'starter';
  if (plan === 'pro') return 'professional';
  return plan;
};

export const requirePlan = (allowedPlans = []) => {
  return async (req, res, next) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      if (['admin', 'manager'].includes(req.user.role)) {
        return next();
      }

      const user = await User.findById(req.user.id).select('subscription.plan');
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const userPlan = normalizePlan(user.subscription?.plan);
      if (!allowedPlans.includes(userPlan)) {
        return res.status(403).json({ error: 'Upgrade required to access this feature' });
      }

      next();
    } catch (err) {
      console.error('requirePlan error:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  };
};
