import { Router } from 'express';
import subscriptionRoutes from './subscription.js';

const router = Router();

// Alias /verify to /verify-payment on subscription routes
router.use('/verify', (req, res, next) => {
  req.url = '/verify-payment';
  next();
}, subscriptionRoutes);

export default router;
