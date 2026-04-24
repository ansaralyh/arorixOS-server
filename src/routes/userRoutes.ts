import express from 'express';
import { updateProfile, changePassword, patchUserPreferences } from '../controllers/userController';
import { protect } from '../middlewares/authMiddleware';

const router = express.Router();

// Protected Routes (Requires a valid JWT token)
router.use(protect);

router.put('/profile', updateProfile);
router.put('/password', changePassword);
router.patch('/preferences', patchUserPreferences);

export default router;
