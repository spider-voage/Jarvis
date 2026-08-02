// routes/v1/subscriptions.js
const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { auditLog } = require('../../middleware/security');
const subscriptionService = require('../../services/subscription');
const { getProvider, getAvailableProviders } = require('../../services/payments');

const router = express.Router();
router.use(requireAuth);

// GET /api/v1/subscriptions/plans
router.get('/plans', async (req, res) => {
  try {
    const plans = await subscriptionService.getAllPlans();
    res.json({ plans });
  } catch (err) {
    console.error('[subscriptions/plans]', err);
    res.status(500).json({ error: 'Failed to load plans' });
  }
});

// GET /api/v1/subscriptions/me
router.get('/me', async (req, res) => {
  try {
    const sub = await subscriptionService.getUserSubscription(req.userId);
    res.json({ subscription: sub });
  } catch (err) {
    console.error('[subscriptions/me]', err);
    res.status(500).json({ error: 'Failed to load subscription' });
  }
});

// GET /api/v1/subscriptions/dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const stats = await subscriptionService.getDashboardStats(req.userId);
    res.json(stats);
  } catch (err) {
    console.error('[subscriptions/dashboard]', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// GET /api/v1/subscriptions/payments
router.get('/payments', async (req, res) => {
  try {
    const payments = await subscriptionService.getPaymentHistory(req.userId);
    res.json({ payments });
  } catch (err) {
    console.error('[subscriptions/payments]', err);
    res.status(500).json({ error: 'Failed to load payment history' });
  }
});

// GET /api/v1/subscriptions/invoices
router.get('/invoices', async (req, res) => {
  try {
    const invoices = await subscriptionService.getInvoices(req.userId);
    res.json({ invoices });
  } catch (err) {
    console.error('[subscriptions/invoices]', err);
    res.status(500).json({ error: 'Failed to load invoices' });
  }
});

// POST /api/v1/subscriptions/checkout
router.post('/checkout', auditLog('subscription.checkout'), async (req, res) => {
  try {
    const { planSlug, provider: providerName } = req.body || {};
    if (!planSlug) return res.status(400).json({ error: 'planSlug is required' });

    const plan = await subscriptionService.getPlan(planSlug);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const provider = getProvider(providerName || 'stripe');
    const userResult = await require('../../db/init').db.execute({
      sql: 'SELECT email, name FROM users WHERE id = ?',
      args: [req.userId],
    });
    const user = userResult.rows[0];

    const successUrl = `${process.env.APP_URL || 'http://localhost:3000'}/billing/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${process.env.APP_URL || 'http://localhost:3000'}/billing/cancel`;

    const checkout = await provider.createSubscription(plan, {
      userId: req.userId,
      email: user.email,
      name: user.name,
    }, successUrl, cancelUrl);

    res.json({ checkoutUrl: checkout.checkoutUrl, provider: provider.name });
  } catch (err) {
    console.error('[subscriptions/checkout]', err);
    res.status(500).json({ error: err.message || 'Checkout failed' });
  }
});

// POST /api/v1/subscriptions/cancel
router.post('/cancel', auditLog('subscription.cancel'), async (req, res) => {
  try {
    const { atPeriodEnd = true } = req.body || {};
    const sub = await subscriptionService.cancelSubscription(req.userId, atPeriodEnd);
    res.json({ subscription: sub });
  } catch (err) {
    console.error('[subscriptions/cancel]', err);
    res.status(500).json({ error: err.message || 'Cancellation failed' });
  }
});

// GET /api/v1/subscriptions/providers
router.get('/providers', async (req, res) => {
  try {
    const providers = getAvailableProviders();
    res.json({ providers });
  } catch (err) {
    console.error('[subscriptions/providers]', err);
    res.status(500).json({ error: 'Failed to load providers' });
  }
});

module.exports = router;
