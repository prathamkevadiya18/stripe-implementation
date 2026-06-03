import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface Order {
  id: string;
  total: number;
  currency: string;
  orderNumber: string;
  status: string; // 'pending' | 'paid' | 'cancelled' | 'refunded'
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class OrdersService {
  private readonly filePath = path.resolve(process.cwd(), 'orders.json');

  private async readOrders(): Promise<Order[]> {
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(data) as Order[];
    } catch (error: any) {
      // If file doesn't exist, return empty array
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async writeOrders(orders: Order[]): Promise<void> {
    await fs.writeFile(this.filePath, JSON.stringify(orders, null, 2), 'utf-8');
  }

  async create(dto: { total: number; currency: string }) {
    const orders = await this.readOrders();
    const id = Math.random().toString(36).substring(2, 15);
    const orderNumber = `ORD-${1000 + orders.length + 1}`;
    
    const order: Order = {
      id,
      total: dto.total,
      currency: dto.currency || 'USD',
      orderNumber,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    orders.push(order);
    await this.writeOrders(orders);
    return order;
  }

  async findOne(id: string): Promise<Order> {
    const orders = await this.readOrders();
    const order = orders.find((o) => o.id === id);
    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }
    return order;
  }

  async updateStatus(id: string, status: string): Promise<Order> {
    const orders = await this.readOrders();
    const orderIndex = orders.findIndex((o) => o.id === id);
    if (orderIndex === -1) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }
    
    orders[orderIndex].status = status;
    orders[orderIndex].updatedAt = new Date().toISOString();
    
    await this.writeOrders(orders);
    return orders[orderIndex];
  }

  async findAll() {
    return this.readOrders();
  }
}
