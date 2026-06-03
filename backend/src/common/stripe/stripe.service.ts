import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { default as StripeClient } from 'stripe';
import { Stripe } from 'stripe';

@Injectable()
export class StripeService {
  public readonly stripe: Stripe;

  constructor(private readonly configService: ConfigService) {
    this.stripe = new StripeClient(
      this.configService.get('STRIPE_SECRET_KEY')!,
      {
        apiVersion: this.configService.get('STRIPE_API_VERSION') as any,
      },
    );
  }
}
