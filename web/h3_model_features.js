export function h3TextEncoderItems(textEncoders) {
  const h3Items = textEncoders.filter(name => /qwen3vl_32b_minimax_h3/i.test(name || ""));
  return h3Items.length ? h3Items : textEncoders;
}