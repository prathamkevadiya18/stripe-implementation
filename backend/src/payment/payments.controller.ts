import { Controller, Post, Body, BadRequestException, Get, Param, Headers, Req } from '@nestjs/common';
import { WebsitePaymentsService } from './payments.service.js';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

@Controller('payments')
export class WebsitePaymentsController {
  constructor(
    private readonly WebpaymentsService: WebsitePaymentsService,
  ) { }

  @Post('create-session')
  async createSession(@Body() dto: { orderId: string }) {
    if (!dto.orderId) {
      throw new BadRequestException('orderId is required');
    }
    return this.WebpaymentsService.createCheckoutSession(dto.orderId);
  }

  @Post('webhook')
  async handleWebhook( @Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature: string,) {
    if (!req.rawBody) {
      throw new BadRequestException('Missing raw body');
    }
    await this.WebpaymentsService.handleStripeWebhook(req.rawBody, signature);
    return { received: true };
  }

  @Get('session/:id')
  async getSession(@Param('id') sessionId: string) {
    return this.WebpaymentsService.getSession(sessionId);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.WebpaymentsService.listById(id);
  }
}
