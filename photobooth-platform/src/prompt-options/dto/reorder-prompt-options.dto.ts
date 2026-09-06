import { IsArray, IsString, ArrayMinSize } from 'class-validator';

// A real DTO (unlike the assets module's reorder routes, which take an
// untyped inline `@Body() body: { orderedIds: string[] }` that bypasses the
// global ValidationPipe entirely) — new code shouldn't repeat that gap.
export class ReorderPromptOptionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids: string[];
}
