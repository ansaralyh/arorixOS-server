import express from 'express';
import { updateBusinessInfo } from '../controllers/businessController';
import { updateBusinessModeSettings } from '../controllers/businessModeController';
import { listFormationRequests } from '../controllers/formationController';
import { protect } from '../middlewares/authMiddleware';

const router = express.Router();

// Protected Routes (Requires a valid JWT token)
router.use(protect);

// Formation / partner pipeline (read-only v1)
router.get('/formation-requests', listFormationRequests);

// Update business info
router.put('/info', updateBusinessInfo);

// CRM / dashboard terminology (per-tenant)
router.put('/mode-settings', updateBusinessModeSettings);

export default router;
