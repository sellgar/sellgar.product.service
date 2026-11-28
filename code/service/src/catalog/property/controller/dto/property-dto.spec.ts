import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';

import { CreatePropertyDto } from './create-property.dto';
import { GetAllPropertiesDto } from './get-all-properties.dto';
import { UpdatePropertyOptionDto } from './update-property-option.dto';

describe('Property DTO', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true });

  it('accepts and normalizes a property search query', async () => {
    const dto = await pipe.transform(
      { search: ' материал ', limit: 20 },
      { type: 'body', metatype: GetAllPropertiesDto },
    );
    expect(dto.search).toBe('материал');
  });

  it.each([123, ['материал'], 'а'.repeat(257)])('rejects invalid property search: %j', async (search) => {
    await expect(pipe.transform({ search }, { type: 'body', metatype: GetAllPropertiesDto })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('transforms a nested OPTIONS definition without changing business codes', async () => {
    const dto = await pipe.transform(
      {
        code: ' color ',
        name: ' Цвет ',
        kind: 'OPTIONS',
        options: [
          {
            code: 'red',
            name: 'Красный',
            extras: [{ type: 'COLOR', valueColor: '#ff0000' }],
          },
        ],
      },
      { type: 'body', metatype: CreatePropertyDto },
    );

    expect(dto).toMatchObject({
      code: 'color',
      name: 'Цвет',
      kind: 'OPTIONS',
      options: [{ code: 'red', extras: [{ type: 'COLOR', valueColor: '#ff0000' }] }],
    });
  });

  it.each([
    { code: '', name: 'Цвет', kind: 'OPTIONS' },
    { code: 'color', name: '', kind: 'OPTIONS' },
    { code: 'color', name: 'Цвет', kind: 'UNKNOWN' },
    {
      code: 'color',
      name: 'Цвет',
      kind: 'OPTIONS',
      options: [{ code: 'red', name: 'Красный', extras: [{ type: 'COLOR', valueColor: 'red' }] }],
    },
    {
      code: 'color',
      name: 'Цвет',
      kind: 'OPTIONS',
      options: [{ code: 'red', name: 'Красный', extras: [{ type: 'IMAGE', imageUuid: 'invalid' }] }],
    },
  ])('rejects an invalid definition: %j', async (payload) => {
    await expect(pipe.transform(payload, { type: 'body', metatype: CreatePropertyDto })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('does not expose code or kind changes in the option update contract', async () => {
    const dto = await pipe.transform(
      {
        code: 'color',
        optionCode: 'red',
        version: 2,
        name: 'Алый',
        kind: 'TEXT',
        newCode: 'scarlet',
      },
      { type: 'body', metatype: UpdatePropertyOptionDto },
    );
    expect(dto).toEqual({ code: 'color', optionCode: 'red', version: 2, name: 'Алый' });
  });
});
