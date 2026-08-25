import { z } from 'zod';
import { resolveTaskInputSchema } from './resolver';

export const compileTargets = ['CODEX', 'CLAUDE_CODE'] as const;
export const compileTargetSchema = z.enum(compileTargets);
export type CompileTarget = z.infer<typeof compileTargetSchema>;

export const compileInputSchema = resolveTaskInputSchema.extend({
  target: compileTargetSchema,
});
export type CompileRequestInput = z.infer<typeof compileInputSchema>;

export interface CompiledFile {
  path: string;
  content: string;
}

export interface CompiledHarness {
  files: CompiledFile[];
  metadata: {
    target: CompileTarget;
    generatedAt: string;
    manifestTraceId: string;
  };
}
