import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { z, type ZodType } from 'zod';

/**
 * 요청 본문을 도메인 zod 스키마로 검증한다.
 * api와 web이 같은 스키마를 쓰게 해 계약이 갈라지지 않도록 한다.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({
        message: '요청 값이 올바르지 않습니다',
        issues: z.treeifyError(parsed.error),
      });
    }
    return parsed.data;
  }
}
