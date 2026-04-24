import express from 'express';
import { updateBusinessInfo } from '../controllers/businessController';
import { updateBusinessModeSettings } from '../controllers/businessModeController';
import { protect } from '../middlewares/authMiddleware';

const router = express.Router();

// Protected Routes (Requires a valid JWT token)
router.use(protect);

// Update business info
router.put('/info', updateBusinessInfo);

// CRM / dashboard terminology (per-tenant)
router.put('/mode-settings', updateBusinessModeSettings);

export default router;
