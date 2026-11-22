import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { StoreCatalogGateway } from './store-catalog.gateway';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'STORE_COMMAND_SERVICE',
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.getOrThrow<string>('PRODUCT_AMQP_URL')],
            queue: config.getOrThrow<string>('AMQP_STORE_SRV_COMMAND_QUEUE'),
            queueOptions: { durable: true },
          },
        }),
      },
    ]),
  ],
  providers: [StoreCatalogGateway],
  exports: [StoreCatalogGateway],
})
export class StoreCatalogModule {}
