import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WebsitePaymentsController } from './payments.controller.js';
import { WebsitePaymentsService } from './payments.service.js';
import { StripeModule } from '../common/stripe/stripe.module.js';
import { OrdersModule } from '../orders/orders.module.js';

@Module({
  imports: [ConfigModule, StripeModule, OrdersModule],
  controllers: [WebsitePaymentsController],
  providers: [WebsitePaymentsService],
})
export class PaymentModule {}
