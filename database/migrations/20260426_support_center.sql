-- Knowledge base (global, read-only for all workspace members), tickets & call requests (per business).

CREATE TABLE IF NOT EXISTS support_kb_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(64) NOT NULL UNIQUE,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS support_kb_articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES support_kb_categories(id) ON DELETE CASCADE,
    slug VARCHAR(128) NOT NULL UNIQUE,
    title VARCHAR(300) NOT NULL,
    excerpt TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    published BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_kb_articles_category ON support_kb_articles (category_id);
CREATE INDEX IF NOT EXISTS idx_support_kb_articles_published ON support_kb_articles (published) WHERE published;

CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject VARCHAR(500) NOT NULL,
    body TEXT NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_business_created ON support_tickets (business_id, created_at DESC);

DROP TRIGGER IF EXISTS update_support_tickets_modtime ON support_tickets;
CREATE TRIGGER update_support_tickets_modtime
    BEFORE UPDATE ON support_tickets
    FOR EACH ROW EXECUTE FUNCTION update_modified_column();

CREATE TABLE IF NOT EXISTS support_call_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    call_type VARCHAR(32) NOT NULL
        CHECK (call_type IN ('strategy', 'support', 'general')),
    preferred_on DATE NOT NULL,
    preferred_time_slot VARCHAR(32) NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    status VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_call_requests_business ON support_call_requests (business_id, created_at DESC);

-- Seed categories
INSERT INTO support_kb_categories (slug, title, description, sort_order) VALUES
('billing', 'Billing & Payments', 'Questions about invoices, payments, and package changes', 1),
('account-setup', 'Account Setup', 'Getting started with your dashboard and initial configuration', 2),
('business-formation', 'Business Formation', 'Help with business registration and legal documents', 3),
('security', 'Security & Privacy', 'Data protection, security settings, and privacy controls', 4),
('tutorials', 'Feature Tutorials', 'Step-by-step guides for using platform features', 5),
('best-practices', 'Best Practices', 'Tips and strategies for growing your business', 6)
ON CONFLICT (slug) DO NOTHING;

-- Seed articles (short bodies; searchable via ILIKE)
INSERT INTO support_kb_articles (category_id, slug, title, excerpt, body, sort_order)
SELECT c.id, 'understanding-your-invoice', 'Understanding your Arorix OS invoice',
'How subscription charges appear and what each line means.',
'Your Arorix OS subscription is billed per workspace. Invoices list the plan name, billing period, and amount due. You can download receipts from Billing & Subscription after payment. If a charge looks wrong, open a support ticket with the invoice date and last four digits of the payment reference.',
1 FROM support_kb_categories c WHERE c.slug = 'billing'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO support_kb_articles (category_id, slug, title, excerpt, body, sort_order)
SELECT c.id, 'change-plan-or-seats', 'Changing your plan or team size',
'Upgrade or downgrade and how seat limits work.',
'Owners and admins can change plans under Pricing or Billing & Subscription. Each plan includes a maximum number of workspace seats; pending invitations count toward the limit. To add more people, upgrade the plan or revoke unused invites.',
2 FROM support_kb_categories c WHERE c.slug = 'billing'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO support_kb_articles (category_id, slug, title, excerpt, body, sort_order)
SELECT c.id, 'first-login-checklist', 'First login checklist',
'Configure your workspace after signing in.',
'Complete your business profile under Business Info, invite teammates under Teammates, and verify outbound email under Communications if you send customer messages. Set your role permissions under Roles if you need custom access.',
1 FROM support_kb_categories c WHERE c.slug = 'account-setup'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO support_kb_articles (category_id, slug, title, excerpt, body, sort_order)
SELECT c.id, 'connect-email-resend', 'Connect email for invites and verification',
'Using Resend for transactional email.',
'The server sends workspace invites and email verification links through Resend when RESEND_API_KEY is set. Without it, the app may show a token you can copy manually. Set EMAIL_FROM to a verified domain in production.',
2 FROM support_kb_categories c WHERE c.slug = 'account-setup'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO support_kb_articles (category_id, slug, title, excerpt, body, sort_order)
SELECT c.id, 'formation-status-tracking', 'Tracking formation requests',
'Where to see LLC or entity filing status.',
'Formation requests linked to your workspace appear on the dashboard and under Formation when enabled. Statuses move from submission to processing to completed. Contact support if a request is stuck longer than the SLA you were given.',
1 FROM support_kb_categories c WHERE c.slug = 'business-formation'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO support_kb_articles (category_id, slug, title, excerpt, body, sort_order)
SELECT c.id, 'ein-and-compliance-fields', 'EIN and compliance fields',
'Storing EIN and annual report dates in Business Info.',
'You can record EIN, formation date, and annual report due dates in Business Info for your records. This does not replace legal or tax advice. Export or share only with trusted advisors.',
2 FROM support_kb_categories c WHERE c.slug = 'business-formation'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO support_kb_articles (category_id, slug, title, excerpt, body, sort_order)
SELECT c.id, 'password-and-2fa', 'Passwords and sign-in security',
'Keeping your owner and admin accounts safe.',
'Use a strong unique password for your Arorix OS account. Two-factor enrollment in the app is a preference flag today; treat your email inbox as sensitive because password resets go there.',
1 FROM support_kb_categories c WHERE c.slug = 'security'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO support_kb_articles (category_id, slug, title, excerpt, body, sort_order)
SELECT c.id, 'roles-and-permissions', 'Roles and permissions overview',
'How OWNER, ADMIN, MANAGER, and MEMBER differ.',
'Owners and admins can manage billing, invites, and many workspace settings. Managers and members have narrower access based on the permission matrix. Adjust defaults under Roles & Permissions as an admin.',
1 FROM support_kb_categories c WHERE c.slug = 'tutorials'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO support_kb_articles (category_id, slug, title, excerpt, body, sort_order)
SELECT c.id, 'crm-pipelines-intro', 'CRM pipelines and leads',
'Getting started with the CRM module.',
'Pipelines represent your sales stages. Leads move between stages as you work deals. Use consistent naming so reports stay meaningful. Sync teammates from the Teammates page for assignee pickers.',
2 FROM support_kb_categories c WHERE c.slug = 'tutorials'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO support_kb_articles (category_id, slug, title, excerpt, body, sort_order)
SELECT c.id, 'seat-planning', 'Planning team growth with your plan',
'Match hiring to your subscription tier.',
'Review your plan seat limit on the Teammates page before large hiring pushes. Upgrading early avoids blocking invites when someone is mid-onboarding.',
1 FROM support_kb_categories c WHERE c.slug = 'best-practices'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO support_kb_articles (category_id, slug, title, excerpt, body, sort_order)
SELECT c.id, 'support-tickets-when-to-use', 'When to open a support ticket',
'Billing bugs, access issues, and data questions.',
'Use Submit a Ticket for issues that need a human response. Include steps to reproduce, workspace name, and screenshots if relevant. Owners see all tickets in the workspace; other roles see their own submissions.',
2 FROM support_kb_categories c WHERE c.slug = 'best-practices'
ON CONFLICT (slug) DO NOTHING;
