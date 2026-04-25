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
import { listActivity, createActivity } from '../controllers/businessActivityController';
import {
  getBusinessCommunications,
  patchBusinessCommunications,
  requestOutboundEmailVerification,
} from '../controllers/communicationsController';
import { getBilling, patchBilling, postChangePlan, postPayInvoice } from '../controllers/billingController';
import {
  listKbCategories,
  listKbArticles,
  getKbArticle,
  createTicket,
  listTickets,
  patchTicket,
  createCallRequest,
} from '../controllers/supportController';
import {
  listCrmPipelines,
  createCrmPipeline,
  patchCrmPipeline,
  deleteCrmPipeline,
  putCrmPipelineStages,
} from '../controllers/crmPipelineController';
import {
  listCrmLeads,
  getCrmLeadsFilterMeta,
  getCrmLead,
  createCrmLead,
  patchCrmLead,
  deleteCrmLead,
} from '../controllers/crmLeadsController';
import {
  listCrmLeadActivities,
  createCrmLeadActivity,
  patchCrmLeadActivity,
  deleteCrmLeadActivity,
  listCrmLeadConversations,
  createCrmLeadConversation,
} from '../controllers/crmLeadThreadController';
import { protect } from '../middlewares/authMiddleware';
import { requireBusinessMembership, requireTeamAdmin } from '../middlewares/membershipMiddleware';

const router = express.Router();

// Protected Routes (Requires a valid JWT token)
router.use(protect);
router.use(requireBusinessMembership);

// Company Activity (read/write for any workspace member)
router.get('/activity', listActivity);
router.post('/activity', createActivity);

// Communications (outbound email verification via Resend, SMS display)
router.get('/communications', getBusinessCommunications);
router.patch('/communications', patchBusinessCommunications);
router.post('/communications/request-email-verification', requestOutboundEmailVerification);

// Billing ledger (read: any member; writes: owner/admin)
router.get('/billing', getBilling);
router.patch('/billing', requireTeamAdmin, patchBilling);
router.post('/billing/change-plan', requireTeamAdmin, postChangePlan);
router.post('/billing/pay-invoice', requireTeamAdmin, postPayInvoice);

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

// CRM — pipelines & stages (Phase 1)
router.get('/crm/pipelines', listCrmPipelines);
router.post('/crm/pipelines', createCrmPipeline);
router.patch('/crm/pipelines/:pipelineId', patchCrmPipeline);
router.delete('/crm/pipelines/:pipelineId', deleteCrmPipeline);
router.put('/crm/pipelines/:pipelineId/stages', putCrmPipelineStages);

// CRM — leads (static paths before :leadId)
router.get('/crm/leads/filters', getCrmLeadsFilterMeta);
router.get('/crm/leads', listCrmLeads);
router.get('/crm/leads/:leadId', getCrmLead);
router.post('/crm/leads', createCrmLead);
router.patch('/crm/leads/:leadId', patchCrmLead);
router.delete('/crm/leads/:leadId', deleteCrmLead);
router.get('/crm/leads/:leadId/activities', listCrmLeadActivities);
router.post('/crm/leads/:leadId/activities', createCrmLeadActivity);
router.patch('/crm/leads/:leadId/activities/:activityId', patchCrmLeadActivity);
router.delete('/crm/leads/:leadId/activities/:activityId', deleteCrmLeadActivity);
router.get('/crm/leads/:leadId/conversations', listCrmLeadConversations);
router.post('/crm/leads/:leadId/conversations', createCrmLeadConversation);

// Support: KB (read), tickets, call requests (no live chat API)
router.get('/support/kb/categories', listKbCategories);
router.get('/support/kb/articles', listKbArticles);
router.get('/support/kb/articles/:slug', getKbArticle);
router.post('/support/tickets', createTicket);
router.get('/support/tickets', listTickets);
router.patch('/support/tickets/:id', requireTeamAdmin, patchTicket);
router.post('/support/call-requests', createCallRequest);

export default router;
