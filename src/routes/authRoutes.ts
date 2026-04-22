import { Router } from 'express';
import { register, login } from '../controllers/authController';
import { getMe } from '../controllers/userController';
import { protect } from '../middlewares/authMiddleware';

const router = Router();

// Public Routes
router.post('/register', register);
router.post('/login', login);

// Protected Routes (Requires a valid JWT token)
router.use(protect); // Applies the auth middleware to all routes below this line
router.get('/me', getMe);

export default router;
