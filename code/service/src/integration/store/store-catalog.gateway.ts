import { BadGatewayException, Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { ProductEntity } from '../../catalog/product/entity/product.entity';

@Injectable()
export class StoreCatalogGateway {
  constructor(@Inject('STORE_COMMAND_SERVICE') private readonly client: ClientProxy) {}

  archiveImpact(productUuid: string, variantUuid?: string) {
    return this.request('store.catalog.archiveImpact', { productUuid, variantUuid });
  }

  synchronize(product: ProductEntity) {
    return this.request('store.catalog.synchronizeSnapshot', product);
  }

  private async request(cmd: string, payload: object) {
    try {
      return await firstValueFrom(this.client.send({ cmd }, payload).pipe(timeout(10000)));
    } catch {
      throw new BadGatewayException('Не удалось подтвердить состояние связанных продаж. Повторите запрос.');
    }
  }
}
