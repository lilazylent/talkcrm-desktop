/** Source retellings sometimes serialize their own headline/summary inside a text chunk. */
export function sourceRetellingText(text:string):string {
  try {const value:unknown=JSON.parse(text);if(typeof value==='string')return value;if(value&&typeof value==='object'&&!Array.isArray(value)){const r=value as Record<string,unknown>;const parts=[r.headline,r.summary].filter((v):v is string=>typeof v==='string');if(parts.length)return parts.join('\n');}}
  catch { /* Plain source text is already the display value. */ }
  return text;
}
