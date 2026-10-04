import {it,expect} from 'vitest';
import {sourceRetellingText} from '../src/domain/sourceText.ts';
it('displays the source headline and retelling without JSON labels',()=>expect(sourceRetellingText('{"headline":"Заголовок","summary":"Исходный пересказ"}')).toBe('Заголовок\nИсходный пересказ'));
it('preserves plain text and unrecognized source structures without inventing content',()=>{expect(sourceRetellingText('Исходный пересказ')).toBe('Исходный пересказ');expect(sourceRetellingText('{"other":"value"}')).toBe('{"other":"value"}');});
