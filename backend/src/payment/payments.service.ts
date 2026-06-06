import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StripeService } from '../common/stripe/stripe.service.js';
import { OrdersService } from '../orders/orders.service.js';

@Injectable()
export class WebsitePaymentsService {
  private readonly logger = new Logger(WebsitePaymentsService.name);

  constructor(
    private readonly ordersService: OrdersService,
    private readonly stripeService: StripeService,
    private readonly config: ConfigService,
  ) { }

  async createCheckoutSession(orderId: string) {
    const order = await this.ordersService.findOne(orderId);

    const websiteUrl = this.config.get<string>('WEBSITE_URL') ?? 'http://localhost:3000';

    const amountInCents = Math.round(Number(order.total) * 100);

    const session = await this.stripeService.stripe.checkout.sessions.create({
      ui_mode: 'elements',
      mode: 'payment',
      payment_method_types: ['card', 'klarna'],
      line_items: [
        {
          price_data: {
            currency: order.currency.toLowerCase() || 'usd',
            product_data: {
              name: `Order #${order.orderNumber}`,
              description: `Payment for Order #${order.orderNumber}`,
            },
            unit_amount: amountInCents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        orderId: order.id,
      },
      payment_intent_data: {
        metadata: {
          orderId: order.id,
        },
      },
      return_url: `${websiteUrl}/success.html?session_id={CHECKOUT_SESSION_ID}&order_id=${order.id}`,
    });

    return {
      clientSecret: session.client_secret,
      sessionId: session.id
    };
  }

  async handleStripeWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) {
      this.logger.error('STRIPE_WEBHOOK_SECRET is not configured');
      throw new BadRequestException('STRIPE_WEBHOOK_SECRET is not configured');
    }
    let event: any;
    try {
      event = this.stripeService.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret
      );
    } catch (err) {
      this.logger.error(`Failed to construct Stripe webhook event: ${(err as Error).message}`);
      throw new BadRequestException(`Invalid Stripe signature: ${(err as Error).message}`);
    }

    this.logger.log(`Received Stripe webhook event: type=${event.type}, id=${event.id}`);

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object as any;
        this.logger.log(`Processing payment_intent.succeeded (paymentIntentId: ${pi.id}, orderId: ${pi.metadata?.orderId})`);
        await this.onPaymentIntentSucceeded(pi);
        break;
      }
      case 'payment_intent.payment_failed': {
        const pi = event.data.object as any;
        this.logger.log(`Processing payment_intent.payment_failed (paymentIntentId: ${pi.id}, orderId: ${pi.metadata?.orderId})`);
        await this.onPaymentIntentFailed(pi);
        break;
      }
      case 'charge.refunded': {
        const charge = event.data.object as any;
        this.logger.log(`Processing charge.refunded (chargeId: ${charge.id}, orderId: ${charge.metadata?.orderId})`);
        await this.onChargeRefunded(charge);
        break;
      }
      case 'charge.dispute.created': {
        const dispute = event.data.object as any;
        this.logger.log(`Processing charge.dispute.created (disputeId: ${dispute.id}, paymentIntentId: ${dispute.payment_intent})`);
        await this.onDisputeCreated(dispute);
        break;
      }
      case 'charge.dispute.closed': {
        const dispute = event.data.object as any;
        this.logger.log(`Processing charge.dispute.closed (disputeId: ${dispute.id}, status: ${dispute.status}, paymentIntentId: ${dispute.payment_intent})`);
        await this.onDisputeClosed(dispute);
        break;
      }
      default:
        this.logger.warn(`Unhandled stripe webhook event type: ${event.type}`);
    }
  }

  private async onPaymentIntentSucceeded(pi: any): Promise<void> {
    const orderId = pi.metadata?.orderId;
    if (!orderId) {
      this.logger.warn(`Payment intent succeeded but orderId metadata is missing (paymentIntentId: ${pi.id})`);
      return;
    }

    const expandedPi = await this.stripeService.stripe.paymentIntents.retrieve(pi.id, {
      expand: ['payment_method'],
    });

    const pm = expandedPi.payment_method as any;
    const card = pm?.card;
    const method = this.resolvePaymentMethod(card?.funding ?? '');

    // Database operations commented out since payments and orders tables do not exist
    /*
    const [existingPayment] = await this.drizzle.db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.providerTxnId, pi.id))
      .limit(1);

    if (existingPayment) {
      await this.drizzle.db
        .update(payments)
        .set({ status: 'captured', processedAt: new Date() })
        .where(eq(payments.id, existingPayment.id));
      this.logger.log(`Updated existing payment record status to captured for orderId: ${orderId}, paymentIntentId: ${pi.id}`);
    } else {
      await this.drizzle.db.insert(payments).values({
        orderId,
        method,
        provider: 'stripe',
        providerTxnId: pi.id,
        amount: pi.amount / 100,
        currency: pi.currency.toUpperCase(),
        status: 'captured',
        last4: card?.last4 ?? null,
        cardBrand: card?.brand ?? null,
        processedAt: new Date(),
      });
      this.logger.log(`Created captured payment record inside onPaymentIntentSucceeded for orderId: ${orderId}, paymentIntentId: ${pi.id}`);
    }

    await this.drizzle.db
      .update(orders)
      .set({ status: 'paid', updatedAt: new Date() })
      .where(eq(orders.id, orderId));
    */

    // Update order status in the local JSON file
    try {
      await this.ordersService.updateStatus(orderId, 'paid');
      this.logger.log(`Updated order status to paid for orderId: ${orderId}`);
    } catch (err: any) {
      this.logger.error(`Failed to update order status to paid: ${err.message}`);
    }
  }

  private async onPaymentIntentFailed(pi: any): Promise<void> {
    const orderId = pi.metadata?.orderId;
    if (!orderId) {
      this.logger.warn(`Payment intent failed but orderId metadata is missing (paymentIntentId: ${pi.id})`);
      return;
    }

    const expandedPi = await this.stripeService.stripe.paymentIntents.retrieve(pi.id, {
      expand: ['payment_method'],
    });

    const pm = expandedPi.payment_method as any;
    const card = pm?.card;
    const method = this.resolvePaymentMethod(card?.funding ?? '');

    // Database operations commented out since payments and orders tables do not exist
    /*
    const [existingPayment] = await this.drizzle.db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.providerTxnId, pi.id))
      .limit(1);

    if (existingPayment) {
      await this.drizzle.db
        .update(payments)
        .set({ status: 'failed', processedAt: new Date() })
        .where(eq(payments.id, existingPayment.id));
    } else {
      await this.drizzle.db.insert(payments).values({
        orderId,
        method,
        provider: 'stripe',
        providerTxnId: pi.id,
        amount: pi.amount / 100,
        currency: pi.currency.toUpperCase(),
        status: 'failed', 
        last4: card?.last4 ?? null,
        cardBrand: card?.brand ?? null,
        processedAt: new Date(),
      });
    }

    await this.drizzle.db
      .update(orders)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(orders.id, orderId));
    */

    // Update order status in the local JSON file
    try {
      await this.ordersService.updateStatus(orderId, 'cancelled');
      this.logger.log(`Updated order status to cancelled for orderId: ${orderId}`);
    } catch (err: any) {
      this.logger.error(`Failed to update order status to cancelled: ${err.message}`);
    }
  }

  private async onChargeRefunded(charge: any): Promise<void> {
    const piId = typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id;

    if (!piId) {
      this.logger.warn(`Skipping charge refunded: paymentIntentId is missing`);
      return;
    }

    const isPartial = charge.amount_refunded < charge.amount;
    const pymtStatus = isPartial ? 'partially_refunded' : 'refunded';

    // Database operations commented out since payments and orders tables do not exist
    /*
    await this.drizzle.db
      .update(payments)
      .set({ status: pymtStatus, processedAt: new Date() })
      .where(eq(payments.providerTxnId, piId));
    */

    this.logger.log(`[DB Commented Out] Updated payment status to ${pymtStatus} for paymentIntentId: ${piId}`);

    if (!isPartial) {
      const orderId = charge.metadata?.orderId;
      if (orderId) {
        // Database operations commented out since payments and orders tables do not exist
        /*
        await this.drizzle.db
          .update(orders)
          .set({ status: 'refunded', updatedAt: new Date() })
          .where(eq(orders.id, orderId));
        */

        // Update order status in the local JSON file
        try {
          await this.ordersService.updateStatus(orderId, 'refunded');
          this.logger.log(`Updated order status to refunded for orderId: ${orderId}`);
        } catch (err: any) {
          this.logger.error(`Failed to update order status to refunded: ${err.message}`);
        }
      }
    }
  }

  private resolvePaymentMethod(funding: string): 'credit_card(stripe)' | 'debit_card(stripe)' {
    return funding === 'debit'
      ? 'debit_card(stripe)'
      : 'credit_card(stripe)';
  }

  private async onDisputeCreated(dispute: any): Promise<void> {
    // Database operations commented out since payments and orders tables do not exist
    /*
    const [payment] = await this.drizzle.db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.providerTxnId, dispute.payment_intent as string))
      .limit(1);
    if (!payment) {
      this.logger.warn(`Dispute created but matching payment record not found for paymentIntentId: ${dispute.payment_intent}`);
      return;
    }
    await this.drizzle.db
      .update(payments)
      .set({ status: 'authorized' })
      .where(eq(payments.id, payment.id));
    this.logger.log(`Updated payment status to authorized due to dispute creation for paymentId: ${payment.id}`);
    */
    this.logger.log(`[DB Commented Out] Dispute created (disputeId: ${dispute.id}, paymentIntentId: ${dispute.payment_intent})`);
  }

  private async onDisputeClosed(dispute: any): Promise<void> {
    // Database operations commented out since payments and orders tables do not exist
    /*
    const [payment] = await this.drizzle.db
      .select({ id: payments.id, orderId: payments.orderId })
      .from(payments)
      .where(eq(payments.providerTxnId, dispute.payment_intent as string))
      .limit(1);
    if (!payment) {
      this.logger.warn(`Dispute closed but matching payment record not found for paymentIntentId: ${dispute.payment_intent}`);
      return;
    }
    const won = dispute.status === 'won';
    await this.drizzle.db
      .update(payments)
      .set({ status: won ? 'captured' : 'refunded' })
      .where(eq(payments.id, payment.id));
    this.logger.log(`Updated payment status to ${won ? 'captured' : 'refunded'} (dispute won: ${won}) for paymentId: ${payment.id}`);
    if (!won) {
      await this.drizzle.db
        .update(orders)
        .set({ status: 'refunded', updatedAt: new Date() })
        .where(eq(orders.id, payment.orderId));
      this.logger.log(`Updated order status to refunded due to lost dispute for orderId: ${payment.orderId}`);
    }
    */
    const won = dispute.status === 'won';
    this.logger.log(`[DB Commented Out] Dispute closed (disputeId: ${dispute.id}, status: ${dispute.status}, won: ${won})`);
  }

  async listById(id: string) {
    // Database operations commented out since payments and orders tables do not exist
    /*
    const [list] = await this.drizzle.db.select().from(payments).where(eq(payments.id, id))
    return list;
    */
    this.logger.log(`listById called for id: ${id} (database commented out)`);
    return { id, message: 'Database payments table is not available' };
  }

  async getSession(sessionId: string) {
    // Commented out the old Stripe retrieve code since we do not want to query Stripe using session_id
    /*
    const session = await this.stripeService.stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent'],
    });

    const paymentIntent = session.payment_intent as any;
    let refunds: any[] = [];

    if (paymentIntent) {
      const refundList = await this.stripeService.stripe.refunds.list({
        payment_intent: paymentIntent.id,
      });
      refunds = refundList.data.map((r) => ({
        id: r.id,
        amount: r.amount,
        status: r.status,
        currency: r.currency,
        createdAt: r.created,
      }));
    }

    return {
      sessionId: session.id,
      status: session.status,
      paymentStatus: session.payment_status,
      amountTotal: session.amount_total,
      currency: session.currency,
      paymentIntentId: paymentIntent ? paymentIntent.id : null,
      refunds,
    };
    */

    // Returning mock session data directly (data already input/preset)
    this.logger.log(`getSession called for sessionId: ${sessionId} (Stripe retrieve commented out)`);
    return {
      sessionId,
      status: 'complete',
      paymentStatus: 'paid',
      amountTotal: 10000,
      currency: 'usd',
      paymentIntentId: 'pi_mock_123456789',
      refunds: [],
    };
  }
}
