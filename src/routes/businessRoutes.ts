import express from 'express';
import { updateBusinessInfo } from '../controllers/businessController';
import { updateBusinessModeSettings } from '../controllers/businessModeController';
import { listFormationRequests } from '../controllers/formationController';
import {
  listMembers,
  listPendingInvitations,
  createInvitation,
  resendInvitation,
  revokeInvitation,
  updateMemberRole,
  removeMember,
} from '../controllers/teamController';
import { getRolePermissions, patchRolePermissions } from '../controllers/rolePermissionsController';
import { protect } from '../middlewares/authMiddleware';
import { requireBusinessMembership, requireTeamAdmin } from '../middlewares/membershipMiddleware';

const router = express.Router();

// Protected Routes (Requires a valid JWT token)
router.use(protect);
router.use(requireBusinessMembership);

// Teammates
router.get('/members', listMembers);
router.get('/invitations', listPendingInvitations);
router.post('/invitations', requireTeamAdmin, createInvitation);
router.post('/invitations/:id/resend', requireTeamAdmin, resendInvitation);
router.delete('/invitations/:id', requireTeamAdmin, revokeInvitation);
router.patch('/members/:membershipId', requireTeamAdmin, updateMemberRole);
router.delete('/members/:membershipId', requireTeamAdmin, removeMember);

// Formation / partner pipeline (read-only v1)
router.get('/formation-requests', listFormationRequests);

// Update business info
router.put('/info', updateBusinessInfo);

// CRM / dashboard terminology (per-tenant)
router.put('/mode-settings', updateBusinessModeSettings);

// Workspace permission matrix (merged defaults + DB overrides)
router.get('/role-permissions', requireTeamAdmin, getRolePermissions);
router.patch('/role-permissions', requireTeamAdmin, patchRolePermissions);

export default router;
