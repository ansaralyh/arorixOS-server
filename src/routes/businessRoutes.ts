import express from 'express';
import { updateBusinessInfo } from '../controllers/businessController';
import { protect } from '../middlewares/authMiddleware';

const router = express.Router();

// Protected Routes (Requires a valid JWT token)
router.use(protect);

// Update business info
router.put('/info', updateBusinessInfo);

export default router;
