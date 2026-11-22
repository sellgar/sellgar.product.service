import { ProductModel } from '../product.model';

export function sortProductRelations(product: ProductModel): void {
  const byCode = (left: { propertyCode: string }, right: { propertyCode: string }) =>
    left.propertyCode.localeCompare(right.propertyCode);
  const byPosition = (left: { position: number }, right: { position: number }) => left.position - right.position;
  const byField = (
    left: { sortOrder: number; propertyCode: string },
    right: { sortOrder: number; propertyCode: string },
  ) => left.sortOrder - right.sortOrder || byCode(left, right);

  product.productType.productFields.sort(byField);
  product.productType.variantFields.sort(byField);
  product.properties.sort(byCode);
  for (const property of product.properties) property.values.sort(byPosition);
  product.variants.sort((left, right) => left.uuid.localeCompare(right.uuid));
  for (const variant of product.variants) {
    variant.properties.sort(byCode);
    for (const property of variant.properties) property.values.sort(byPosition);
    variant.images.sort(
      (left, right) => left.sortOrder - right.sortOrder || left.imageUuid.localeCompare(right.imageUuid),
    );
  }
}
