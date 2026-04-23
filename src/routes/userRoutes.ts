import express from 'express';
import { updateProfile } from '../controllers/userController';
import { protect } from '../middlewares/authMiddleware';

const router = express.Router();

// Protected Routes (Requires a valid JWT token)
router.use(protect);

// Update user profile
router.put('/profile', updateProfile);

export default router;
