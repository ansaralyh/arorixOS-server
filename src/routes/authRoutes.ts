import { Router } from 'express';
import { register, login, funnelCheckout } from '../controllers/authController';
import { getMe } from '../controllers/userController';
import { protect } from '../middlewares/authMiddleware';

const router = Router();

// Public Routes
router.post('/register', register);
router.post('/login', login);
router.post('/funnel-checkout', funnelCheckout);

// Protected Routes (Requires a valid JWT token)
router.use(protect); // Applies the auth middleware to all routes below this line
router.get('/me', getMe);

export default router;
