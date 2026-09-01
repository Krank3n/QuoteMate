/**
 * Pull the assistant's text out of an Anthropic Messages response.
 *
 * `content` is a LIST of blocks, and the text is not reliably first. With
 * extended thinking on, the model emits a thinking block ahead of its answer,
 * so the long-standing `data.content[0].text` shorthand reads `undefined` the
 * moment thinking is enabled on a call that previously ran without it.
 *
 * That failure is quiet in the worst way: the caller throws on `.trim()` of
 * undefined, the handler treats it as a provider outage, and every request
 * lands on the fallback model while still paying the primary's latency. It is
 * indistinguishable from an API incident unless you read the fallback log.
 */
export function claudeText(data: any): string {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  return blocks
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('');
}
